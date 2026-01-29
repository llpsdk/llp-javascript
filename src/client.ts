import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
	AlreadyClosedError,
	AlreadyConnectedError,
	type ErrorCode,
	NotAuthenticatedError,
	NotConnectedError,
	PlatformError,
	TimeoutError,
} from './errors.js';
import { PresenceMessage, TextMessage } from './message.js';
import { ConnectionStatus, PresenceStatus } from './presence.js';

export interface LLPClientConfig {
	readonly url?: string; // Default: wss://llphq.com/agent/websocket
	readonly connectTimeout?: number; // Default: 10000ms
	readonly responseTimeout?: number; // Default: 10000ms
	readonly maxQueueSize?: number; // Default: 32
}

export type MessageHandler = (msg: TextMessage) => Promise<TextMessage>;
export type PresenceHandler = (msg: PresenceMessage) => void | Promise<void>;

export class LLPClient {
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

	private messageHandler: MessageHandler | null = null;
	private presenceHandler: PresenceHandler | null = null;

	private authResolve: (() => void) | null = null;
	private authReject: ((err: Error) => void) | null = null;

	private isClosing = false;

	constructor(
		private readonly name: string,
		private readonly apiKey: string,
		private readonly config: LLPClientConfig = {},
	) {}

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

			this.ws.on('message', (data) => this.handleMessage(data));
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

	async sendAsyncMessage(msg: TextMessage): Promise<void> {
		if (this.status !== ConnectionStatus.Authenticated) {
			throw new NotAuthenticatedError('Must be authenticated to send messages');
		}

		this.enqueue(msg.encode());
	}

	onMessage(handler: MessageHandler): void {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onMessage callback before connecting');
		}
		this.messageHandler = handler;
	}

	onPresence(handler: PresenceHandler): void {
		if (this.status !== ConnectionStatus.Disconnected && this.status !== ConnectionStatus.Closed) {
			throw new AlreadyConnectedError('Must set onMessage callback before connecting');
		}
		this.presenceHandler = handler;
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	getPresence(): PresenceStatus {
		return this.presence;
	}

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

	private handleMessage(data: WebSocket.RawData): void {
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

		// Otherwise, call the message handler
		if (this.messageHandler) {
			try {
				const reply = await this.messageHandler(msg);
				await this.sendAsyncMessage(reply);
			} catch (err) {
				console.error('Error in message handler:', err);
			}
		}
	}

	private handlePresenceMessage(json: Record<string, unknown>): void {
		const presence = PresenceMessage.decode(json);
		if (this.presenceHandler) {
			Promise.resolve(this.presenceHandler(presence)).catch((err) => {
				console.error('Error in presence handler:', err);
			});
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
