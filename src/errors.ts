export const ErrorCode = {
	InvalidJson: 0,
	NotAuthenticated: 1,
	InvalidSchema: 2,
	InvalidPresenceSchema: 3,
	InvalidMessageSchema: 4,
	GeneralServerError: 5,
	InvalidKey: 100,
	NameAlreadyRegistered: 101,
	MissingRecipient: 102,
	UnrecognizedType: 104,
	EncryptionUnsupported: 105,
	AgentNotFound: 106,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class PlatformError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
		public readonly messageId?: string,
	) {
		super(`[${code}] ${message}`);
		this.name = 'PlatformError';
	}
}

export class NotConnectedError extends Error {
	name = 'NotConnectedError';
}

export class NotAuthenticatedError extends Error {
	name = 'NotAuthenticatedError';
}

export class AlreadyConnectedError extends Error {
	name = 'AlreadyConnectedError';
}

export class AlreadyClosedError extends Error {
	name = 'AlreadyClosedError';
}

export class TimeoutError extends Error {
	name = 'TimeoutError';
}

export class TextMessageReplyError extends Error {
	name = 'TextMessageReplyError';
}

export class TextMessageEmptyError extends Error {
	name = 'TextMessageEmptyError';
}

export class MessageHandlerNotSetError extends Error {
	name = 'MessageHandlerNotSetError';
}
