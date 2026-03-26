import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Annotater } from './annotate.js';
import {
	AlreadyClosedError,
	AlreadyConnectedError,
	type ErrorCode,
	MessageHandlerNotSetError,
	NotAuthenticatedError,
	PlatformError,
	TimeoutError,
} from './errors.js';
import { PresenceMessage, TextMessage } from './message.js';
import { ConnectionStatus, PresenceStatus } from './presence.js';
import type { ToolCall } from './tool_call.js';

export interface LLPClientConfig {
	readonly url?: string; // Default: wss://llphq.com/agent/websocket
	readonly connectTimeout?: number; // Default: 10000ms
	readonly responseTimeout?: number; // Default: 10000ms
	readonly maxQueueSize?: number; // Default: 32
}

export type SessionCreator<T> = () => T;
export type MessageHandler<T> = (
	agent: T,
	msg: TextMessage,
	annotater: Annotater,
) => Promise<TextMessage>;
export type StopHandler<T> = (data: T) => void | Promise<void>;

/**
 * Typed interface returned by `onStart()` for chaining.
 * The generic `T` is inferred from the factory return type.
 */
export interface TypedLLPClient<T> {
	onMessage(handler: MessageHandler<T>): TypedLLPClient<T>;
	onStop(handler: StopHandler<T>): TypedLLPClient<T>;
	connect(timeout?: number): Promise<void>;
	close(): Promise<void>;
	getStatus(): ConnectionStatus;
	getSessionId(): string | null;
	getPresence(): PresenceStatus;
	annotateToolCall(toolCall: ToolCall): Promise<void>;
}

export class LLPClient<TSessionData = unknown> implements Annotater {
	private ws: WebSocket | null = null;
	private status: ConnectionStatus = ConnectionStatus.Disconnected;
	private sessionId: string | null = null;
	private presence: PresenceStatus = PresenceStatus.Unavailable;

	private readonly outboundQueue: Array<string> = [];
	private readonly sessions = new Map<string, TSessionData>();

	private sessionCreator: SessionCreator<unknown> | null = null;
	private messageHandler: MessageHandler<unknown> | null = null;
	private stopHandler: StopHandler<unknown> | null = null;

	private authResolve: (() => void) | null = null;
	private authReject: ((err: Error) => void) | null = null;

	private isClosing = false;

	constructor(
		private readonly name: string,
		private readonly apiKey: string,
		private readonly config: LLPClientConfig = {},
	) {}

	/**
	 * Register a callback that creates session data for each new user session.
	 * The SDK calls this automatically when a user becomes available.
	 *
	 * ```ts
	 * new LLPClient(name, key, config)
	 *   .onStart(() => createAgent({ model, tools, middleware: [createLLPToolMiddleware()] }))
	 *   .onMessage(async (agent, msg) => {
	 *     const result = await agent.invoke({ messages: [new HumanMessage(msg.prompt)] });
	 *     return msg.reply(extractText(result));
	 *   })
	 *   .connect();
	 * ```
	 */
	onStart<T>(creator: SessionCreator<T>): TypedLLPClient<T> {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onStart callback before connecting');
		}

		this.sessionCreator = creator as SessionCreator<unknown>;
		return this as unknown as TypedLLPClient<T>;
	}

	/**
	 * Register a message handler (new API — called via chaining after onStart).
	 * The first argument is the session data created by onStart.
	 */
	onMessage(handler: MessageHandler<TSessionData>): TypedLLPClient<TSessionData> {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onMessage callback before connecting');
		}

		this.messageHandler = handler as MessageHandler<unknown>;
		return this as unknown as TypedLLPClient<TSessionData>;
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
	async annotateToolCall(toolCall: ToolCall): Promise<void> {
		if (this.status !== ConnectionStatus.Authenticated) {
			throw new NotAuthenticatedError('Must be authenticated to annotate tool calls');
		}
		this.enqueue(toolCall.encode());
	}

	private async sendAsyncMessage(msg: TextMessage): Promise<void> {
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
				case 'ack':
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

		console.log(`[message] received from sender=${msg.sender} id=${msg.id}`);
		const data = this.sessions.get(msg.sender);
		if (!data) {
			console.error(`[message] no session data for sender=${msg.sender} — was presence received?`);
			return;
		}

		if (!this.messageHandler) {
			throw new MessageHandlerNotSetError(
				'Message handler not set, have you called onMessage before connecting?',
			);
		}
		const reply = await this.messageHandler(data, msg, this);
		await this.sendAsyncMessage(reply);
	}

	private handlePresenceMessage(json: Record<string, unknown>): void {
		const presence = PresenceMessage.decode(json);
		console.log(`[presence] sender=${presence.sender} status=${presence.status}`);

		if (presence.status === PresenceStatus.Available) {
			if (this.sessionCreator) {
				const data = this.sessionCreator() as TSessionData;
				this.sessions.set(presence.sender, data);
				console.log(`[presence] session ready for sender=${presence.sender}`);
			}
		} else if (presence.status === PresenceStatus.Unavailable) {
			const data = this.sessions.get(presence.sender);
			if (data && this.stopHandler) {
				Promise.resolve(this.stopHandler(data))
					.catch((err) => {
						console.error('Error in onStop handler:', err);
					})
					.finally(() => {
						this.sessions.delete(presence.sender);
					});
			} else {
				this.sessions.delete(presence.sender);
			}
		}
	}

	private handleErrorMessage(json: Record<string, unknown>): void {
		const code = json.code as ErrorCode;
		const message = json.message as string;
		const messageId = json.id as string | undefined;

		const error = new PlatformError(code, message, messageId);

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
}
