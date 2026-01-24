import { describe, expect, it } from 'vitest';
import {
	AlreadyClosedError,
	ErrorCode,
	NotAuthenticatedError,
	NotConnectedError,
	PlatformError,
	TextMessageEmptyError,
	TextMessageReplyError,
	TimeoutError,
} from '../src/errors.js';

describe('ErrorCode', () => {
	it('should have all required error codes', () => {
		expect(ErrorCode.InvalidJson).toBe(0);
		expect(ErrorCode.NotAuthenticated).toBe(1);
		expect(ErrorCode.InvalidSchema).toBe(2);
		expect(ErrorCode.InvalidPresenceSchema).toBe(3);
		expect(ErrorCode.InvalidMessageSchema).toBe(4);
		expect(ErrorCode.GeneralServerError).toBe(5);
		expect(ErrorCode.InvalidKey).toBe(100);
		expect(ErrorCode.NameAlreadyRegistered).toBe(101);
		expect(ErrorCode.MissingRecipient).toBe(102);
		expect(ErrorCode.UnrecognizedType).toBe(104);
		expect(ErrorCode.EncryptionUnsupported).toBe(105);
		expect(ErrorCode.AgentNotFound).toBe(106);
	});
});

describe('PlatformError', () => {
	it('should create error with code and message', () => {
		const error = new PlatformError(ErrorCode.InvalidKey, 'Invalid API key');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('PlatformError');
		expect(error.code).toBe(ErrorCode.InvalidKey);
		expect(error.message).toBe('[100] Invalid API key');
		expect(error.messageId).toBeUndefined();
	});

	it('should include message ID when provided', () => {
		const error = new PlatformError(
			ErrorCode.MissingRecipient,
			'No recipient specified',
			'msg-123',
		);

		expect(error.code).toBe(ErrorCode.MissingRecipient);
		expect(error.messageId).toBe('msg-123');
		expect(error.message).toBe('[102] No recipient specified');
	});
});

describe('Client Errors', () => {
	it('should create NotConnectedError', () => {
		const error = new NotConnectedError('Not connected to server');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('NotConnectedError');
		expect(error.message).toBe('Not connected to server');
	});

	it('should create NotAuthenticatedError', () => {
		const error = new NotAuthenticatedError('Authentication required');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('NotAuthenticatedError');
		expect(error.message).toBe('Authentication required');
	});

	it('should create AlreadyClosedError', () => {
		const error = new AlreadyClosedError('Client already closed');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('AlreadyClosedError');
		expect(error.message).toBe('Client already closed');
	});

	it('should create TimeoutError', () => {
		const error = new TimeoutError('Operation timed out');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('TimeoutError');
		expect(error.message).toBe('Operation timed out');
	});

	it('should create TextMessageReplyError', () => {
		const error = new TextMessageReplyError('Cannot create reply');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('TextMessageReplyError');
		expect(error.message).toBe('Cannot create reply');
	});

	it('should create TextMessageEmptyError', () => {
		const error = new TextMessageEmptyError('Message cannot be empty');

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('TextMessageEmptyError');
		expect(error.message).toBe('Message cannot be empty');
	});
});
