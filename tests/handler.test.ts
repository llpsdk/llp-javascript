import { describe, expect, it } from 'vitest';
import { PresenceMessage, TextMessage } from '../src/message.js';
import { PresenceStatus } from '../src/presence.js';
import { LLPSession } from '../src/session.js';

describe('Message Handlers', () => {
	describe('MessageHandler type', () => {
		const session = new LLPSession<string>('alice', {
			annotateToolCall: async () => {},
		});

		it('should accept async function that returns TextMessage', async () => {
			const handler = async (
				_session: LLPSession<string>,
				msg: TextMessage,
			): Promise<TextMessage> => {
				return msg.reply('Response');
			};

			const input = new TextMessage('bob', 'Hello', null, 'msg-1', 'alice');

			const result = await handler(session, input);
			expect(result.prompt).toBe('Response');
			expect(result.recipient).toBe('alice');
		});

		it('should allow handler to process message content', async () => {
			const handler = async (
				_session: LLPSession<string>,
				msg: TextMessage,
			): Promise<TextMessage> => {
				const upperPrompt = msg.prompt.toUpperCase();
				return msg.reply(`Echo: ${upperPrompt}`);
			};

			const input = new TextMessage('bob', 'hello world');

			const result = await handler(session, input);
			expect(result.prompt).toBe('Echo: HELLO WORLD');
		});
	});

	describe('PresenceHandler type', () => {
		it('should accept void function', () => {
			const handler = (_session: LLPSession<string>, msg: PresenceMessage): void => {
				expect(msg.sender).toBeDefined();
			};

			const presence = new PresenceMessage(PresenceStatus.Available, 'alice');
			handler(new LLPSession<string>('alice', { annotateToolCall: async () => {} }), presence);
		});

		it('should accept async void function', async () => {
			const handler = async (_session: LLPSession<string>, msg: PresenceMessage): Promise<void> => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				expect(msg.status).toBe(PresenceStatus.Unavailable);
			};

			const presence = new PresenceMessage(PresenceStatus.Unavailable, 'bob');
			await handler(new LLPSession<string>('bob', { annotateToolCall: async () => {} }), presence);
		});

		it('should allow side effects in handler', async () => {
			const log: string[] = [];

			const handler = (session: LLPSession<string>, msg: PresenceMessage): void => {
				log.push(`${session.id}: ${msg.status}`);
			};

			const p1 = new PresenceMessage(PresenceStatus.Available, 'alice');
			const p2 = new PresenceMessage(PresenceStatus.Unavailable, 'bob');
			handler(new LLPSession<string>('alice', { annotateToolCall: async () => {} }), p1);
			handler(new LLPSession<string>('bob', { annotateToolCall: async () => {} }), p2);

			expect(log).toEqual(['alice: available', 'bob: unavailable']);
		});
	});
});
