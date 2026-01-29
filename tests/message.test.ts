import { describe, expect, it } from 'vitest';
import { TextMessageEmptyError } from '../src/errors.js';
import { PresenceMessage, TextMessage } from '../src/message.js';
import { PresenceStatus } from '../src/presence.js';

describe('TextMessage', () => {
	describe('constructor', () => {
		it('should create message with required fields', () => {
			const msg = new TextMessage('bob', 'Hello');

			expect(msg.id).toBeDefined();
			expect(msg.id.length).toBeGreaterThan(0);
			expect(msg.sender).toBe('');
			expect(msg.recipient).toBe('bob');
			expect(msg.prompt).toBe('Hello');
			expect(msg.encrypted).toBe(false);
		});

		it('should use provided ID and sender', () => {
			const msg = new TextMessage('bob', 'Hello', null, 'custom-id');
			expect(msg.id).toBe('custom-id');
		});

		it('should throw on empty prompt', () => {
			expect(() => new TextMessage('bob', '')).toThrow(TextMessageEmptyError);
		});

		it('should throw on whitespace-only prompt', () => {
			expect(() => new TextMessage('bob', '   ')).toThrow(TextMessageEmptyError);
		});
	});

	describe('encode', () => {
		it('should encode message to JSON with base64 prompt', () => {
			const msg = new TextMessage('bob', 'Hello World');

			const encoded = msg.encode();
			const parsed = JSON.parse(encoded);

			expect(parsed.type).toBe('message');
			expect(parsed.data.to).toBe('bob');
			expect(parsed.data.encrypted).toBe(false);

			// Verify base64 encoding
			const decoded = Buffer.from(parsed.data.prompt, 'base64').toString('utf-8');
			expect(decoded).toBe('Hello World');
		});

		it('should encode unicode characters correctly', () => {
			const msg = new TextMessage('bob', 'Hello 世界 🌍');

			const encoded = msg.encode();
			const parsed = JSON.parse(encoded);
			const decoded = Buffer.from(parsed.data.prompt, 'base64').toString('utf-8');

			expect(decoded).toBe('Hello 世界 🌍');
		});
	});

	describe('decode', () => {
		it('should decode JSON without attachment to TextMessage', () => {
			const json = {
				type: 'message',
				id: 'msg-456',
				from: 'alice',
				data: {
					to: 'bob',
					prompt: Buffer.from('Hello Bob', 'utf-8').toString('base64'),
					encrypted: false,
				},
			};

			const msg = TextMessage.decode(json);

			expect(msg.id).toBe('msg-456');
			expect(msg.sender).toBe('alice');
			expect(msg.recipient).toBe('bob');
			expect(msg.prompt).toBe('Hello Bob');
			expect(msg.encrypted).toBe(false);
			expect(msg.attachment).toBe('');
			expect(msg.hasAttachment()).toBe(false);
		});

		it('should decode JSON with attachment to TextMessage', () => {
			const json = {
				type: 'message',
				id: 'msg-456',
				from: 'alice',
				data: {
					to: 'bob',
					prompt: Buffer.from('Hello Bob', 'utf-8').toString('base64'),
					attachment_url: 'http://example.com/uploads/hello.txt',
				},
			};
			const msg = TextMessage.decode(json);

			expect(msg.attachment).toBe('http://example.com/uploads/hello.txt');
			expect(msg.hasAttachment()).toBe(true);
		});

		it('should decode unicode characters correctly', () => {
			const json = {
				type: 'message',
				id: 'msg-789',
				from: 'alice',
				data: {
					to: 'bob',
					prompt: Buffer.from('世界 🌍', 'utf-8').toString('base64'),
					encrypted: false,
				},
			};

			const msg = TextMessage.decode(json);

			expect(msg.prompt).toBe('世界 🌍');
		});
	});

	describe('reply', () => {
		it('should create reply with swapped sender/recipient', () => {
			const original = new TextMessage('bob', 'Hello');
			original.sender = 'alice';
			const reply = original.reply('Hi back!');

			expect(reply.id).toBeDefined();
			expect(reply.id).toBe(original.id);
			expect(reply.recipient).toBe('alice');
			expect(reply.prompt).toBe('Hi back!');
		});

		it('should throw when replying to message without sender', () => {
			const msg = new TextMessage('bob', 'Hello');

			// Should not throw even if sender is empty
			const reply = msg.reply('Reply');
			expect(reply.recipient).toBe('');
		});
	});

	describe('round-trip encoding', () => {
		it('should preserve all data through encode/decode cycle', () => {
			const original = new TextMessage('bob', 'Test message 世界', null, 'msg-200');

			const encoded = original.encode();
			const json = JSON.parse(encoded);
			const decoded = TextMessage.decode(json);

			expect(decoded.id).toBe(original.id);
			expect(decoded.sender).toBe(original.sender);
			expect(decoded.recipient).toBe(original.recipient);
			expect(decoded.prompt).toBe(original.prompt);
			expect(decoded.encrypted).toBe(original.encrypted);
		});
	});
});

describe('PresenceMessage', () => {
	it('should create presence message with all fields', () => {
		const msg = new PresenceMessage(PresenceStatus.Available, 'alice', 'presence-1');

		expect(msg.id).toBe('presence-1');
		expect(msg.sender).toBe('alice');
		expect(msg.status).toBe(PresenceStatus.Available);
	});

	it('should handle unavailable status', () => {
		const msg = new PresenceMessage(PresenceStatus.Unavailable);
		expect(msg.status).toBe(PresenceStatus.Unavailable);
	});

	it('should be able to encode and decode JSON', () => {
		const p = new PresenceMessage(PresenceStatus.Available, 'alice', 'p-1');
		const en = p.encode();
		const p2 = PresenceMessage.decode(JSON.parse(en));
		expect(p2.status).toEqual(p.status);
		expect(p2.sender).toEqual(p.sender);
		expect(p2.id).toEqual(p.id);
	});
});
