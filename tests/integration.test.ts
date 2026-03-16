import { beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { LLPClient } from '../src/client.js';
import { ErrorCode, PlatformError, TimeoutError } from '../src/errors.js';
import { type PresenceMessage, TextMessage } from '../src/message.js';
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
		it('should send message and receive response', async () => {
			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Send a message
			const tm = new TextMessage('bob', 'Hello Bob');
			const sendPromise = client.sendMessage(tm);

			// Verify message was sent
			expect(mockWs.send).toHaveBeenCalledTimes(3); // 1 auth + 1 presence + 1 message

			const sentMessage = JSON.parse(mockWs.send.mock.calls[2][0]);
			expect(sentMessage.type).toBe('message');
			expect(sentMessage.data.to).toBe('bob');

			// Simulate response
			const response = tm.reply('Hi back!');

			messageHandler?.(Buffer.from(response.encode()));

			const result = await sendPromise;
			expect(result.prompt).toBe('Hi back!');
		});

		it('should handle incoming messages and send replies', async () => {
			const replies: TextMessage[] = [];
			client.onMessage(async (session, msg: TextMessage) => {
				expect(session.id).toBe('alice');
				const reply = msg.reply(`Echo: ${msg.prompt}`);
				replies.push(reply);
				return reply;
			});
			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Simulate incoming message
			const incomingMsg = new TextMessage(
				'test-agent',
				'Hello!',
				undefined,
				'msg-incoming',
				'alice',
			);

			messageHandler?.(Buffer.from(incomingMsg.encode()));

			// Wait for async handler
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify reply was sent (1 auth + 1 presence + 1 reply from handler)
			expect(mockWs.send).toHaveBeenCalledTimes(3);
			expect(replies[0]?.prompt).toBe('Echo: Hello!');
		});

		it('should timeout if no response received', async () => {
			await connectClient();

			const sendPromise = client.sendMessage(new TextMessage('bob', 'Hello'), 100); // 100ms timeout

			// Don't send a response, let it timeout
			await expect(sendPromise).rejects.toThrow(TimeoutError);
		});
	});

	describe('Presence handling', () => {
		it('should receive and process presence updates', async () => {
			const presenceUpdates: Array<{ sessionId: string; msg: PresenceMessage }> = [];
			client.onStart((session, msg: PresenceMessage) => {
				presenceUpdates.push({ sessionId: session.id, msg });
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

			// Wait for async handler
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(presenceUpdates).toHaveLength(1);
			expect(presenceUpdates[0]?.sessionId).toBe('alice');
			expect(presenceUpdates[0]?.msg.sender).toBe('alice');
			expect(presenceUpdates[0]?.msg.status).toBe(PresenceStatus.Available);
		});

		it('should handle async presence handlers', async () => {
			let handlerCalled = false;
			client.onStart(async (session, msg: PresenceMessage) => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				handlerCalled = true;
				expect(session.id).toBe('bob');
				expect(msg.sender).toBe('bob');
			});

			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			const presenceMsg = JSON.stringify({
				type: 'presence',
				id: 'pres-2',
				from: 'bob',
				data: {
					status: 'unavailable',
				},
			});

			messageHandler?.(Buffer.from(presenceMsg));

			// Wait for async handler
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(handlerCalled).toBe(true);
		});

		it('should isolate session state by sender and clear it on unavailable', async () => {
			const seenValues: Array<string | undefined> = [];

			client.onStart((_session, msg: PresenceMessage) => {
				if (msg.status === PresenceStatus.Available) {
					return `agent-for-${msg.sender}`;
				}
			});

			client.onMessage(async (session, msg: TextMessage) => {
				seenValues.push(session.data);
				return msg.reply(`Ack: ${msg.prompt}`);
			});

			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			const alicePresence = JSON.stringify({
				type: 'presence',
				id: 'pres-alice',
				from: 'alice',
				data: { status: 'available' },
			});
			const bobPresence = JSON.stringify({
				type: 'presence',
				id: 'pres-bob',
				from: 'bob',
				data: { status: 'available' },
			});
			messageHandler?.(Buffer.from(alicePresence));
			messageHandler?.(Buffer.from(bobPresence));

			// Wait for presence handler microtasks (setData) to resolve
			await new Promise((resolve) => setTimeout(resolve, 10));

			const aliceMsg = new TextMessage('test-agent', 'hello', undefined, 'msg-alice', 'alice');
			const bobMsg = new TextMessage('test-agent', 'hi', undefined, 'msg-bob', 'bob');
			messageHandler?.(Buffer.from(aliceMsg.encode()));
			messageHandler?.(Buffer.from(bobMsg.encode()));

			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(seenValues).toEqual(['agent-for-alice', 'agent-for-bob']);

			const aliceUnavailable = JSON.stringify({
				type: 'presence',
				id: 'pres-alice-off',
				from: 'alice',
				data: { status: 'unavailable' },
			});
			messageHandler?.(Buffer.from(aliceUnavailable));
			await new Promise((resolve) => setTimeout(resolve, 20));

			const aliceMsgAfter = new TextMessage(
				'test-agent',
				'hello again',
				undefined,
				'msg-alice-2',
				'alice',
			);
			messageHandler?.(Buffer.from(aliceMsgAfter.encode()));
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(seenValues).toEqual(['agent-for-alice', 'agent-for-bob', undefined]);
		});
	});

	describe('Error handling', () => {
		it('should handle server error responses', async () => {
			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			const msg = new TextMessage('nonexistent', 'Hello');

			const sendPromise = client.sendMessage(msg);

			// Simulate error response
			const errorMsg = JSON.stringify({
				type: 'error',
				id: msg.id,
				code: ErrorCode.AgentNotFound,
				message: 'Agent not found',
			});

			messageHandler?.(Buffer.from(errorMsg));

			await expect(sendPromise).rejects.toThrow(PlatformError);
			await expect(sendPromise).rejects.toMatchObject({
				code: ErrorCode.AgentNotFound,
				messageId: msg.id,
			});
		});

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

	describe('Queue management', () => {
		it('should queue messages when WebSocket is not ready', async () => {
			// Create client with small queue
			client = new LLPClient('test-agent', 'ws://localhost:4000', 'key', {
				maxQueueSize: 3,
			});

			await connectClient();

			// Mock WebSocket as not open
			mockWs.readyState = 0; // CONNECTING

			// These should queue
			await expect(
				client.sendAsyncMessage(new TextMessage('bob', 'msg1')),
			).resolves.toBeUndefined();

			await expect(
				client.sendAsyncMessage(new TextMessage('bob', 'msg2')),
			).resolves.toBeUndefined();
		});

		it('should throw when queue is full', async () => {
			client = new LLPClient('test-agent', 'key', {
				maxQueueSize: 2,
			});

			await connectClient();

			// Mock WebSocket as not ready
			mockWs.readyState = 0; // CONNECTING

			// Fill the queue
			await client.sendAsyncMessage(new TextMessage('bob', 'msg1'));
			await client.sendAsyncMessage(new TextMessage('bob', 'msg2'));

			// This should overflow
			await expect(client.sendAsyncMessage(new TextMessage('bob', 'msg3'))).rejects.toThrow(
				'Outbound queue is full',
			);
		});
	});

	describe('Multiple concurrent requests', () => {
		it('should handle multiple pending requests simultaneously', async () => {
			await connectClient();

			const messageHandler = mockWs.on.mock.calls.find((call) => call[0] === 'message')?.[1];

			// Send three messages concurrently
			const msg1 = new TextMessage('alice', 'Hello Alice');
			const msg2 = new TextMessage('bob', 'Hello Bob');
			const msg3 = new TextMessage('charlie', 'Hello Charlie');

			const promise1 = client.sendMessage(msg1);
			const promise2 = client.sendMessage(msg2);
			const promise3 = client.sendMessage(msg3);

			// Respond to them in reverse order
			const response3 = msg3.reply('Hi from Charlie');
			const response1 = msg1.reply('Hi from Alice');
			const response2 = msg2.reply('Hi from Bob');

			messageHandler?.(Buffer.from(response3.encode()));
			messageHandler?.(Buffer.from(response1.encode()));
			messageHandler?.(Buffer.from(response2.encode()));

			const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

			expect(result1.prompt).toBe('Hi from Alice');
			expect(result2.prompt).toBe('Hi from Bob');
			expect(result3.prompt).toBe('Hi from Charlie');
		});
	});

	describe('Disconnection scenarios', () => {
		it('should clean up pending requests on disconnect', async () => {
			await connectClient();

			const sendPromise = client.sendMessage(new TextMessage('bob', 'Hello'));

			// Trigger disconnect
			const closeHandler = mockWs.on.mock.calls.find((call) => call[0] === 'close')?.[1];
			closeHandler?.();

			await expect(sendPromise).rejects.toThrow('Disconnected from server');
			expect(client.getStatus()).toBe(ConnectionStatus.Disconnected);
			expect(client.getPresence()).toBe(PresenceStatus.Unavailable);
		});
	});
});
