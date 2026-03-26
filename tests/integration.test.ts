import { beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { LLPClient } from '../src/client.js';
import { ErrorCode, PlatformError } from '../src/errors.js';
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

describe('LLPClient Integration Tests', () => {
	let mockWs: {
		on: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		readyState: number;
	};
	let client: LLPClient<string>;

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

		client = new LLPClient<string>('test-agent', 'test-key');
	});

	async function connectClient(): Promise<void> {
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
	}

	describe('Full connection lifecycle', () => {
		it('should complete full connect-authenticate-close cycle', async () => {
			// Connect
			await connectClient();
			expect(client.getStatus()).toBe(ConnectionStatus.Authenticated);
			expect(client.getSessionId()).toBe('session-123');
			expect(client.getPresence()).toBe(PresenceStatus.Available);

			// Close
			await client.close();
			expect(client.getStatus()).toBe(ConnectionStatus.Closed);
		});
	});

	describe('Message sending and receiving', () => {
		it('should handle incoming messages and send replies', async () => {
			const replies: TextMessage[] = [];
			const messageCalled = new Promise<boolean>((resolve, reject) => {
				client
					.onStart(() => 'alice-session')
					.onMessage(async (_agent, msg: TextMessage, _annotater) => {
						expect(msg.sender).toBe('alice');
						const reply = msg.reply(`Echo: ${msg.prompt}`);
						replies.push(reply);
						resolve(true);
						return reply;
					});
				setTimeout(reject, 100);
			});
			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Simulate presence update from alice to initialize session
			const presenceMsg = JSON.stringify({
				type: 'presence',
				id: 'pres-alice',
				from: 'alice',
				data: { status: 'available' },
			});
			messageHandler?.(Buffer.from(presenceMsg));

			// Simulate incoming message
			const incomingMsg = new TextMessage(
				'test-agent',
				'Hello!',
				undefined,
				'msg-incoming',
				'alice',
			);

			messageHandler?.(Buffer.from(incomingMsg.encode()));

			// Wait for async handler, then flush remaining microtasks
			const called = await messageCalled;
			await new Promise((r) => setTimeout(r, 0));

			// Verify reply was sent (1 auth + 1 presence + 1 reply from handler)
			expect(called).toBe(true);
			expect(mockWs.send).toHaveBeenCalledTimes(3);
			expect(replies[0]?.prompt).toBe('Echo: Hello!');
		});
	});

	describe('Presence handling', () => {
		it('should receive and process presence updates', async () => {
			const startCalled = new Promise<boolean>((resolve, reject) => {
				client.onStart(() => {
					resolve(true);
				});
				setTimeout(reject, 10);
			});

			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Simulate presence update
			const presenceMsg = JSON.stringify({
				type: 'presence',
				id: 'pres-1',
				from: 'alice',
				data: {
					status: 'available',
				},
			});

			messageHandler?.(Buffer.from(presenceMsg));

			const called = await startCalled;
			expect(called).toBe(true);
		});
	});

	describe('Error handling', () => {
		// TODO: client should disconnect when receiving an error
		it('should reject auth promise on authentication error', async () => {
			const connectPromise = client.connect();

			const openHandler = mockWs.on.mock.calls.find((call) => call[0] === 'open')?.[1];
			openHandler?.();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Simulate auth error
			const errorMsg = JSON.stringify({
				type: 'error',
				id: 'auth-error',
				code: ErrorCode.InvalidKey,
				message: 'Invalid API key',
			});

			messageHandler?.(Buffer.from(errorMsg));

			await expect(connectPromise).rejects.toThrow(PlatformError);
			await expect(connectPromise).rejects.toMatchObject({
				code: ErrorCode.InvalidKey,
			});
		});
	});
});
