import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Annotater } from './annotate.js';
import { runWithLLPContext } from './context.js';
import {
	AlreadyClosedError,
	AlreadyConnectedError,
	type ErrorCode,
	NotAuthenticatedError,
	NotConnectedError,
	PlatformError,
	TimeoutError,
} from './errors.js';
import { PresenceMessage, TextMessage, type ToolCall } from './message.js';
import { ConnectionStatus, PresenceStatus } from './presence.js';
import { LLPSession } from './session.js';

export interface LLPClientConfig {
	readonly url?: string; // Default: wss://llphq.com/agent/websocket
	readonly connectTimeout?: number; // Default: 10000ms
	readonly responseTimeout?: number; // Default: 10000ms
	readonly maxQueueSize?: number; // Default: 32
}

// ---------------------------------------------------------------------------
// Legacy handler types (backward compat)
// ---------------------------------------------------------------------------

export type MessageHandler<TSessionData = unknown> = (
	session: LLPSession<TSessionData>,
	msg: TextMessage,
) => Promise<TextMessage>;
export type StartHandler<TSessionData = unknown> = (
	session: LLPSession<TSessionData>,
	msg: PresenceMessage,
) => TSessionData | undefined | Promise<TSessionData | undefined>;
export type PresenceHandler<TSessionData = unknown> = StartHandler<TSessionData>;

// ---------------------------------------------------------------------------
// New chainable API types
// ---------------------------------------------------------------------------

export type SessionFactory<T> = () => T | Promise<T>;
export type TypedMessageHandler<T> = (data: T, msg: TextMessage) => Promise<TextMessage>;
export type StopHandler<T> = (data: T) => void | Promise<void>;

/**
 * Typed interface returned by `onStart()` for chaining.
 * The generic `T` is inferred from the factory return type.
 */
export interface TypedLLPClient<T> {
	onMessage(handler: TypedMessageHandler<T>): TypedLLPClient<T>;
	onStop(handler: StopHandler<T>): TypedLLPClient<T>;
	connect(timeout?: number): Promise<void>;
	close(): Promise<void>;
	getStatus(): ConnectionStatus;
	getSessionId(): string | null;
	getPresence(): PresenceStatus;
	sendMessage(msg: TextMessage, timeout?: number): Promise<TextMessage>;
	sendAsyncMessage(msg: TextMessage): Promise<void>;
	annotateToolCall(toolCall: ToolCall): Promise<void>;
}

export class LLPClient<TSessionData = unknown> implements Annotater {
	private ws: WebSocket | null = null;
	private status: ConnectionStatus = ConnectionStatus.Disconnected;
	private sessionId: string | null = null;
	private presence: PresenceStatus = PresenceStatus.Unavailable;

	private readonly outboundQueue: Array<string> = [];
	private readonly pending = new Map<
		string,
		{
			resolve: (msg: TextMessage) => void;
			reject: (err: Error) => void;
		}
	>();
	private readonly sessions = new Map<string, LLPSession<TSessionData>>();

	// Legacy handlers
	private messageHandler: MessageHandler<TSessionData> | null = null;
	private startHandler: StartHandler<TSessionData> | null = null;

	// New API handlers
	private startFactory: SessionFactory<unknown> | null = null;
	private typedMessageHandler: TypedMessageHandler<unknown> | null = null;
	private stopHandler: StopHandler<unknown> | null = null;

	private authResolve: (() => void) | null = null;
	private authReject: ((err: Error) => void) | null = null;

	private isClosing = false;

	constructor(
		private readonly name: string,
		private readonly apiKey: string,
		private readonly config: LLPClientConfig = {},
	) {}

	// -------------------------------------------------------------------
	// New chainable API
	// -------------------------------------------------------------------

	/**
	 * Register a factory that creates session data for each new user session.
	 * The SDK calls this automatically when a user becomes available.
	 *
	 * Returns a typed client for chaining — the generic is inferred from
	 * the factory return type.
	 *
	 * ```ts
	 * new LLPClient(name, key, config)
	 *   .onStart(() => createAgent({ model, tools, middleware: [LLPAnnotationMiddleware] }))
	 *   .onMessage(async (agent, msg) => {
	 *     const result = await agent.invoke({ messages: [new HumanMessage(msg.prompt)] });
	 *     return msg.reply(extractText(result));
	 *   })
	 *   .connect();
	 * ```
	 */
	onStart<T>(factory: SessionFactory<T>): TypedLLPClient<T>;
	/** @deprecated Use the factory overload: `onStart(() => createAgent(...))` */
	onStart(handler: StartHandler<TSessionData>): void;
	onStart<T>(
		factoryOrHandler: SessionFactory<T> | StartHandler<TSessionData>,
	): TypedLLPClient<T> | undefined {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onStart callback before connecting');
		}

		// Distinguish by arity: factory is 0-arg, legacy handler is 2-arg
		if (factoryOrHandler.length === 0) {
			this.startFactory = factoryOrHandler as SessionFactory<unknown>;
			return this as unknown as TypedLLPClient<T>;
		}

		this.startHandler = factoryOrHandler as StartHandler<TSessionData>;
		return undefined;
	}

	/**
	 * Register a message handler (new API — called via chaining after onStart).
	 * The first argument is the session data created by the onStart factory.
	 */
	onMessage(handler: TypedMessageHandler<TSessionData>): TypedLLPClient<TSessionData>;
	/** @deprecated Use the new API: `onStart(...).onMessage((data, msg) => ...)` */
	onMessage(handler: MessageHandler<TSessionData>): void;
	onMessage(
		handler: TypedMessageHandler<TSessionData> | MessageHandler<TSessionData>,
	): TypedLLPClient<TSessionData> | undefined {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onMessage callback before connecting');
		}

		// If startFactory is set, we're in the new API path
		if (this.startFactory) {
			this.typedMessageHandler = handler as TypedMessageHandler<unknown>;
			return this as unknown as TypedLLPClient<TSessionData>;
		}

		this.messageHandler = handler as MessageHandler<TSessionData>;
		return undefined;
	}

	/**
	 * Register a cleanup handler called when a user session ends.
	 */
	onStop(handler: StopHandler<TSessionData>): TypedLLPClient<TSessionData> {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onStop callback before connecting');
		}
		this.stopHandler = handler as StopHandler<unknown>;
		return this as unknown as TypedLLPClient<TSessionData>;
	}

	onPresence(handler: PresenceHandler<TSessionData>): void {
		this.onStart(handler);
	}

	// -------------------------------------------------------------------
	// Connection lifecycle
	// -------------------------------------------------------------------

	async connect(timeout?: number): Promise<void> {
		const timeoutMs = timeout ?? this.config.connectTimeout ?? 10000;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.ws?.close();
				reject(new TimeoutError('Connection timed out'));
			}, timeoutMs);

			this.status = ConnectionStatus.Connecting;
			const url = this.config.url ?? 'wss://llphq.com/agent/websocket';
			this.ws = new WebSocket(url);

			this.ws.on('open', () => {
				this.status = ConnectionStatus.Connected;
				this.authenticate();
			});

			this.authResolve = () => {
				clearTimeout(timeoutId);
				this.setAvailable();
				this.status = ConnectionStatus.Authenticated;
				this.presence = PresenceStatus.Available;
				resolve();
			};

			this.authReject = (err) => {
				clearTimeout(timeoutId);
				this.status = ConnectionStatus.Disconnected;
				reject(err);
			};

			this.ws.on('message', (data) => this.handleRawMessage(data));
			this.ws.on('close', () => this.handleDisconnect());
			this.ws.on('error', (err) => this.handleError(err));
		});
	}

	async close(): Promise<void> {
		if (this.status === ConnectionStatus.Closed) {
			throw new AlreadyClosedError('Client is already closed');
		}

		this.isClosing = true;

		if (!this.ws) {
			this.status = ConnectionStatus.Closed;
			return;
		}

		// Close the WebSocket and wait for the close event
		return new Promise((resolve) => {
			const closeHandler = () => {
				this.status = ConnectionStatus.Closed;
				resolve();
			};

			this.ws?.once('close', closeHandler);
			this.ws?.close();
		});
	}

	// -------------------------------------------------------------------
	// Messaging
	// -------------------------------------------------------------------

	async sendMessage(msg: TextMessage, timeout?: number): Promise<TextMessage> {
		if (this.status !== ConnectionStatus.Authenticated) {
			throw new NotAuthenticatedError('Must be authenticated to send messages');
		}

		const timeoutMs = timeout ?? this.config.responseTimeout ?? 10000;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(msg.id);
				reject(new TimeoutError(`Message ${msg.id} timed out`));
			}, timeoutMs);

			this.pending.set(msg.id, {
				resolve: (response) => {
					clearTimeout(timeoutId);
					resolve(response);
				},
				reject: (err) => {
					clearTimeout(timeoutId);
					reject(err);
				},
			});

			this.enqueue(msg.encode());
		});
	}

	async annotateToolCall(toolCall: ToolCall): Promise<void> {
		if (this.status !== ConnectionStatus.Authenticated) {
			throw new NotAuthenticatedError('Must be authenticated to annotate tool calls');
		}
		this.enqueue(toolCall.encode());
	}

	async sendAsyncMessage(msg: TextMessage): Promise<void> {
		if (this.status !== ConnectionStatus.Authenticated) {
			throw new NotAuthenticatedError('Must be authenticated to send messages');
		}

		this.enqueue(msg.encode());
	}

	// -------------------------------------------------------------------
	// Getters
	// -------------------------------------------------------------------

	getStatus(): ConnectionStatus {
		return this.status;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	getPresence(): PresenceStatus {
		return this.presence;
	}

	// -------------------------------------------------------------------
	// Private — WebSocket plumbing
	// -------------------------------------------------------------------

	private authenticate(): void {
		const authMessage = {
			type: 'authenticate',
			id: randomUUID(),
			key: this.apiKey,
			name: this.name,
		};

		this.ws?.send(JSON.stringify(authMessage));
	}

	private setAvailable(): void {
		const presMessage = new PresenceMessage(PresenceStatus.Available);
		this.ws?.send(presMessage.encode());
	}

	private enqueue(message: string): void {
		const maxQueueSize = this.config.maxQueueSize ?? 32;

		if (this.outboundQueue.length >= maxQueueSize) {
			throw new Error(`Outbound queue is full (max: ${maxQueueSize})`);
		}

		this.outboundQueue.push(message);
		this.processQueue();
	}

	private processQueue(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return;
		}

		while (this.outboundQueue.length > 0) {
			const message = this.outboundQueue.shift();
			if (message) {
				this.ws.send(message);
			}
		}
	}

	// -------------------------------------------------------------------
	// Private — message dispatch
	// -------------------------------------------------------------------

	private handleRawMessage(data: WebSocket.RawData): void {
		try {
			const text = data.toString();
			const json = JSON.parse(text) as Record<string, unknown>;

			const messageType = json.type as string;

			switch (messageType) {
				case 'authenticated':
					this.handleAuthenticated(json);
					break;
				case 'message':
					this.handleTextMessage(json);
					break;
				case 'presence':
					this.handlePresenceMessage(json);
					break;
				case 'error':
					this.handleErrorMessage(json);
					break;
				default:
					console.warn(`Unknown message type: ${messageType}`);
			}
		} catch (err) {
			console.error('Error handling message:', err);
		}
	}

	private handleAuthenticated(json: Record<string, unknown>): void {
		this.sessionId = (json.data as Record<string, unknown>).session_id as string;

		if (this.authResolve) {
			this.authResolve();
			this.authResolve = null;
			this.authReject = null;
		}
	}

	private async handleTextMessage(json: Record<string, unknown>): Promise<void> {
		const msg = TextMessage.decode(json);

		// Check if this is a response to a pending request
		const pending = this.pending.get(msg.id);
		if (pending) {
			this.pending.delete(msg.id);
			pending.resolve(msg);
			return;
		}

		const session = this.getOrCreateSession(msg.sender);

		// New API path: typed message handler with AsyncLocalStorage context
		if (this.typedMessageHandler) {
			try {
				const data = session.data;
				if (!data) {
					console.error(`No session data initialized for sender ${session.id}`);
					return;
				}
				const handler = this.typedMessageHandler;
				const reply = await runWithLLPContext({ llpMessage: msg, llpClient: session }, () =>
					handler(data, msg),
				);
				await this.sendAsyncMessage(reply);
			} catch (err) {
				console.error('Error in message handler:', err);
			}
			return;
		}

		// Legacy API path
		if (this.messageHandler) {
			try {
				const reply = await this.messageHandler(session, msg);
				await this.sendAsyncMessage(reply);
			} catch (err) {
				console.error('Error in message handler:', err);
			}
		}
	}

	private handlePresenceMessage(json: Record<string, unknown>): void {
		const presence = PresenceMessage.decode(json);
		const session = this.getOrCreateSession(presence.sender);

		// New API path: factory + stop handler
		if (this.startFactory) {
			if (presence.status === PresenceStatus.Available) {
				session.clearData();
				Promise.resolve(this.startFactory())
					.then((data) => {
						if (data !== undefined) {
							session.setData(data as TSessionData);
						}
					})
					.catch((err) => {
						console.error('Error in onStart factory:', err);
					});
			} else if (presence.status === PresenceStatus.Unavailable) {
				const data = session.data;
				if (data && this.stopHandler) {
					Promise.resolve(this.stopHandler(data))
						.catch((err) => {
							console.error('Error in onStop handler:', err);
						})
						.finally(() => {
							session.clear();
							this.sessions.delete(presence.sender);
						});
				} else {
					session.clear();
					this.sessions.delete(presence.sender);
				}
			}
			return;
		}

		// Legacy API path
		if (this.startHandler) {
			Promise.resolve(this.startHandler(session, presence))
				.then((data) => {
					if (presence.status === PresenceStatus.Available) {
						session.clearData();
						if (data !== undefined) {
							session.setData(data);
						}
					}
				})
				.catch((err) => {
					console.error('Error in start handler:', err);
				})
				.finally(() => {
					if (presence.status === PresenceStatus.Unavailable) {
						session.clear();
						this.sessions.delete(presence.sender);
					}
				});
			return;
		}

		if (presence.status === PresenceStatus.Unavailable) {
			session.clear();
			this.sessions.delete(presence.sender);
		}
	}

	private handleErrorMessage(json: Record<string, unknown>): void {
		const code = json.code as ErrorCode;
		const message = json.message as string;
		const messageId = json.id as string | undefined;

		const error = new PlatformError(code, message, messageId);

		// If this is a response to a pending message, reject it
		if (messageId) {
			const pending = this.pending.get(messageId);
			if (pending) {
				this.pending.delete(messageId);
				pending.reject(error);
				return;
			}
		}

		// If we're authenticating, reject the auth promise
		if (this.authReject) {
			this.authReject(error);
			this.authReject = null;
			this.authResolve = null;
			return;
		}

		console.error('Platform error:', error);
	}

	private handleDisconnect(): void {
		if (this.isClosing) {
			this.status = ConnectionStatus.Closed;
		} else {
			this.status = ConnectionStatus.Disconnected;
			this.presence = PresenceStatus.Unavailable;
			this.sessionId = null;

			// Reject all pending messages
			for (const pending of this.pending.values()) {
				pending.reject(new NotConnectedError('Disconnected from server'));
			}
			this.pending.clear();
			for (const session of this.sessions.values()) {
				session.clear();
			}
			this.sessions.clear();
		}
	}

	private handleError(err: Error): void {
		console.error('WebSocket error:', err);

		if (this.authReject) {
			this.authReject(err);
			this.authReject = null;
			this.authResolve = null;
		}
	}

	private getOrCreateSession(id: string): LLPSession<TSessionData> {
		const existing = this.sessions.get(id);
		if (existing) {
			return existing;
		}

		const session = new LLPSession<TSessionData>(id, this);
		this.sessions.set(id, session);
		return session;
	}
}
