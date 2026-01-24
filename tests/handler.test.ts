import { describe, expect, it, vi } from 'vitest';
import { PresenceMessage, TextMessage } from '../src/message.js';
import { PresenceStatus } from '../src/presence.js';

describe('Message Handlers', () => {
	describe('MessageHandler type', () => {
		it('should accept async function that returns TextMessage', async () => {
			const handler = async (msg: TextMessage): Promise<TextMessage> => {
				return msg.reply('Response');
			};

			const input = new TextMessage('bob', 'Hello', 'msg-1', 'alice');

			const result = await handler(input);
			expect(result.prompt).toBe('Response');
			expect(result.recipient).toBe('alice');
		});

		it('should allow handler to process message content', async () => {
			const handler = async (msg: TextMessage): Promise<TextMessage> => {
				const upperPrompt = msg.prompt.toUpperCase();
				return msg.reply(`Echo: ${upperPrompt}`);
			};

			const input = new TextMessage('bob', 'hello world');

			const result = await handler(input);
			expect(result.prompt).toBe('Echo: HELLO WORLD');
		});
	});

	describe('PresenceHandler type', () => {
		it('should accept void function', () => {
			const handler = (msg: PresenceMessage): void => {
				expect(msg.sender).toBeDefined();
			};

			const presence = new PresenceMessage(PresenceStatus.Available, 'alice');
			handler(presence);
		});

		it('should accept async void function', async () => {
			const handler = async (msg: PresenceMessage): Promise<void> => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				expect(msg.status).toBe(PresenceStatus.Unavailable);
			};

			const presence = new PresenceMessage(PresenceStatus.Unavailable, 'bob');
			await handler(presence);
		});

		it('should allow side effects in handler', async () => {
			const log: string[] = [];

			const handler = (msg: PresenceMessage): void => {
				log.push(`${msg.sender}: ${msg.status}`);
			};

			const p1 = new PresenceMessage(PresenceStatus.Available, 'alice');
			const p2 = new PresenceMessage(PresenceStatus.Unavailable, 'bob');
			handler(p1);
			handler(p2);

			expect(log).toEqual(['alice: available', 'bob: unavailable']);
		});
	});
});
