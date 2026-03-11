import { randomUUID } from 'node:crypto';
import { TextMessageEmptyError, TextMessageReplyError } from './errors.js';
import type { PresenceStatus } from './presence.js';

// =============================================================================
// ToolCall
// =============================================================================

export class ToolCall {
	readonly id: string;
	readonly recipient: string;
	readonly name: string;
	readonly parameters: string;
	readonly result: string;
	readonly threwException: boolean;
	readonly durationMs: number;

	constructor(args: {
		id: string;
		recipient: string;
		name: string;
		parameters: string;
		result: string;
		threwException: boolean;
		durationMs: number;
	}) {
		this.id = args.id;
		this.recipient = args.recipient;
		this.name = args.name;
		this.parameters = args.parameters;
		this.result = args.result;
		this.threwException = args.threwException;
		this.durationMs = args.durationMs;
	}

	encode(): string {
		return JSON.stringify({
			type: 'tool_call',
			id: this.id,
			data: {
				to: this.recipient,
				name: this.name,
				parameters: this.parameters,
				result: this.result,
				threw_exception: this.threwException,
				duration_ms: this.durationMs,
			},
		});
	}
}

// =============================================================================
// TextMessage
// =============================================================================

export class TextMessage {
	readonly id: string;
	readonly sender: string;
	readonly recipient: string;
	readonly prompt: string;
	readonly encrypted: boolean;
	readonly attachment: string;

	constructor(
		recipient: string,
		prompt: string,
		attachment?: string,
		id?: string,
		sender?: string,
	) {
		if (!prompt.trim()) {
			throw new TextMessageEmptyError('Message prompt cannot be empty');
		}
		this.id = id ?? randomUUID();
		this.sender = sender ?? '';
		this.recipient = recipient;
		this.prompt = prompt;
		this.encrypted = false;
		this.attachment = attachment ?? '';
	}

	reply(prompt: string): TextMessage {
		if (!this.id) {
			throw new TextMessageReplyError('Cannot reply to message without ID');
		}
		return new TextMessage(this.sender, prompt, undefined, this.id);
	}

	encode(): string {
		const payload: Record<string, unknown> = {
			type: 'message',
			id: this.id,
			from: this.sender,
			data: {
				to: this.recipient,
				prompt: Buffer.from(this.prompt, 'utf-8').toString('base64'),
				encrypted: this.encrypted,
				...(this.hasAttachment() ? { attachment: this.attachment } : {}),
			},
		};
		return JSON.stringify(payload);
	}

	hasAttachment(): boolean {
		return this.attachment !== null && this.attachment !== '';
	}

	/**
	 * Factory for a successful tool call record.
	 * Stamps the correct message ID and recipient so the platform
	 * can correlate this tool call with the originating message.
	 */
	toolCall(name: string, parameters: string, result: string, durationMs: number): ToolCall {
		return new ToolCall({
			id: this.id,
			recipient: this.sender,
			name,
			parameters,
			result,
			threwException: false,
			durationMs,
		});
	}

	/**
	 * Factory for a failed tool call record.
	 */
	toolCallException(name: string, parameters: string, err: Error, durationMs: number): ToolCall {
		return new ToolCall({
			id: this.id,
			recipient: this.sender,
			name,
			parameters,
			result: err.message,
			threwException: true,
			durationMs,
		});
	}

	static decode(json: Record<string, unknown>): TextMessage {
		const data = json.data as Record<string, unknown>;
		const recipient = data.to as string;
		const prompt = Buffer.from(data.prompt as string, 'base64').toString('utf-8');
		const id = json.id as string;
		const sender = json.from as string;
		const attachment = data.attachment_url as string;
		return new TextMessage(recipient, prompt, attachment, id, sender);
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
