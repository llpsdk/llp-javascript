import { randomUUID } from 'node:crypto';
import { TextMessageEmptyError, TextMessageReplyError } from './errors.js';
import type { PresenceStatus } from './presence.js';

export class TextMessage {
	readonly id: string;
	readonly sender: string;
	readonly recipient: string;
	readonly prompt: string;
	readonly encrypted: boolean;

	constructor(recipient: string, prompt: string, id?: string, sender?: string) {
		if (!prompt.trim()) {
			throw new TextMessageEmptyError('Message prompt cannot be empty');
		}
		this.id = id ?? randomUUID();
		this.sender = sender ?? '';
		this.recipient = recipient;
		this.prompt = prompt;
		this.encrypted = false;
	}

	reply(prompt: string): TextMessage {
		if (!this.id) {
			throw new TextMessageReplyError('Cannot reply to message without ID');
		}
		return new TextMessage(this.sender, prompt, this.id);
	}

	encode(): string {
		return JSON.stringify({
			type: 'message',
			id: this.id,
			from: this.sender,
			data: {
				to: this.recipient,
				prompt: Buffer.from(this.prompt, 'utf-8').toString('base64'),
				encrypted: this.encrypted,
			},
		});
	}

	static decode(json: Record<string, unknown>): TextMessage {
		const data = json.data as Record<string, unknown>;
		const recipient = data.to as string;
		const prompt = Buffer.from(data.prompt as string, 'base64').toString('utf-8');
		const id = json.id as string;
		const sender = json.from as string;
		return new TextMessage(recipient, prompt, id, sender);
	}
}

export class PresenceMessage {
	readonly id: string;
	readonly sender: string;
	readonly status: PresenceStatus;

	constructor(status: PresenceStatus, sender?: string, id?: string) {
		this.id = id ?? randomUUID();
		this.sender = sender ?? '';
		this.status = status;
	}

	encode(): string {
		return JSON.stringify({
			type: 'presence',
			id: this.id,
			from: this.sender,
			data: {
				status: this.status,
				supports_encryption: false,
			},
		});
	}

	static decode(json: Record<string, unknown>): PresenceMessage {
		const data = json.data as Record<string, unknown>;
		const status = data.status as PresenceStatus;
		const sender = json.from as string;
		const id = json.id as string;
		return new PresenceMessage(status, sender, id);
	}
}
