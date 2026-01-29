import { beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { LLPClient } from '../src/client.js';
import { NotAuthenticatedError, TimeoutError } from '../src/errors.js';
import { TextMessage } from '../src/message.js';
import { ConnectionStatus, PresenceStatus } from '../src/presence.js';

// Mock WebSocket
vi.mock('ws', () => {
	const MockWebSocket = vi.fn();
	// Add WebSocket constants
	MockWebSocket.CONNECTING = 0;
	MockWebSocket.OPEN = 1;
	MockWebSocket.CLOSING = 2;
	MockWebSocket.CLOSED = 3;
	return {
		default: MockWebSocket,
	};
});

describe('LLPClient', () => {
	let mockWs: {
		on: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		readyState: number;
	};
	let client: LLPClient;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Mock WebSocket constructor - capture the instance when created
		const WS = await import('ws');
		vi.mocked(WS.default).mockImplementation(() => {
			mockWs = {
				on: vi.fn(),
				once: vi.fn((event, handler) => {
					// Auto-trigger close handler when close event is registered
					if (event === 'close') {
						setTimeout(() => handler(), 0);
					}
				}),
				send: vi.fn(),
				close: vi.fn(),
				readyState: 1, // OPEN
			};
			return mockWs as unknown as WebSocket;
		});

		client = new LLPClient('test-agent', 'test-key');
	});

	describe('constructor', () => {
		it('should create client with required parameters', () => {
			expect(client).toBeDefined();
			expect(client.getStatus()).toBe(ConnectionStatus.Disconnected);
			expect(client.getSessionId()).toBeNull();
			expect(client.getPresence()).toBe(PresenceStatus.Unavailable);
		});

		it('should accept custom config', () => {
			const customClient = new LLPClient('test-agent', 'key', {
				connectTimeout: 5000,
				responseTimeout: 15000,
				maxQueueSize: 64,
			});

			expect(customClient).toBeDefined();
		});
	});

	describe('getStatus', () => {
		it('should return current connection status', () => {
			expect(client.getStatus()).toBe(ConnectionStatus.Disconnected);
		});
	});

	describe('getSessionId', () => {
		it('should return null when not connected', () => {
			expect(client.getSessionId()).toBeNull();
		});
	});

	describe('getPresence', () => {
		it('should return Unavailable by default', () => {
			expect(client.getPresence()).toBe(PresenceStatus.Unavailable);
		});
	});

	describe('connect', () => {
		it('should throw TimeoutError if connection times out', async () => {
			const connectPromise = client.connect(100);

			// Don't trigger 'open' event, let it timeout
			await expect(connectPromise).rejects.toThrow(TimeoutError);
		});

		it('should update status to Connecting then Connected', async () => {
			const connectPromise = client.connect();

			// Status should be Connecting (actually starts at Disconnected until WS is created)
			// Let's trigger the open event
			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			expect(openHandler).toBeDefined();

			// Trigger open - this should send auth message
			openHandler?.();

			// Now we need to send back authenticated response
			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			const authResponse = JSON.stringify({
				type: 'authenticated',
				id: 'auth-1',
				data: {
					session_id: 'session-123',
				},
			});

			messageHandler?.(Buffer.from(authResponse));

			await connectPromise;

			expect(client.getStatus()).toBe(ConnectionStatus.Authenticated);
			expect(client.getSessionId()).toBe('session-123');
		});

		it('should send authentication message on open', async () => {
			const connectPromise = client.connect();

			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			openHandler?.();

			// Check that send was called with auth message
			expect(mockWs.send).toHaveBeenCalled();
			const authMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
			expect(authMessage.type).toBe('authenticate');
			expect(authMessage.key).toBe('test-key');
			expect(authMessage.name).toBe('test-agent');

			// Complete authentication
			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];
			const authResponse = JSON.stringify({
				type: 'authenticated',
				id: 'auth-1',
				data: {
					session_id: 'session-123',
				},
			});
			messageHandler?.(Buffer.from(authResponse));

			await connectPromise;
		});
	});

	describe('sendAsyncMessage', () => {
		it('should throw NotAuthenticatedError when not authenticated', async () => {
			const msg = new TextMessage('bob', 'Hello');
			await expect(client.sendAsyncMessage(msg)).rejects.toThrow(NotAuthenticatedError);
		});
	});

	describe('close', () => {
		it('should close WebSocket connection', async () => {
			// First connect
			const connectPromise = client.connect();
			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			openHandler?.();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];
			const authResponse = JSON.stringify({
				type: 'authenticated',
				id: 'auth-1',
				data: {
					session_id: 'session-123',
				},
			});
			messageHandler?.(Buffer.from(authResponse));
			await connectPromise;

			// Now close
			await client.close();
			expect(mockWs.close).toHaveBeenCalled();
		});

		it('should update status to Closed', async () => {
			await client.close();

			const closeHandler = mockWs.on.mock.calls.find((call) => call[0] === 'close')?.[1];
			closeHandler?.();

			expect(client.getStatus()).toBe(ConnectionStatus.Closed);
		});
	});

	describe('onMessage', () => {
		it('should throw if client is connected', async () => {
			const connectPromise = client.connect();
			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			openHandler?.();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];
			const authResponse = JSON.stringify({
				type: 'authenticated',
				id: 'auth-1',
				data: {
					session_id: 'session-123',
				},
			});
			messageHandler?.(Buffer.from(authResponse));
			await connectPromise;
			const throwError = () =>
				client.onMessage(async (msg: TextMessage) => {
					return msg;
				});
			expect(throwError).toThrow(/before connecting/);
		});
	});

	describe('onPresence', () => {
		it('should throw if client is connected', async () => {
			const connectPromise = client.connect();
			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			openHandler?.();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];
			const authResponse = JSON.stringify({
				type: 'authenticated',
				id: 'auth-1',
				data: {
					session_id: 'session-123',
				},
			});
			messageHandler?.(Buffer.from(authResponse));
			await connectPromise;
			const throwError = () => client.onPresence(async (_msg: PresenceMessage) => {});
			expect(throwError).toThrow(/before connecting/);
		});
	});
});
