// Core client
export {
	LLPClient,
	type LLPClientConfig,
	type MessageHandler,
	type PresenceHandler,
} from './client.js';

// Error types and codes
export {
	AlreadyClosedError,
	ErrorCode,
	NotAuthenticatedError,
	NotConnectedError,
	PlatformError,
	TextMessageEmptyError,
	TextMessageReplyError,
	TimeoutError,
	type ErrorCode as ErrorCodeType,
} from './errors.js';

// Message types
export { PresenceMessage, TextMessage } from './message.js';

// Status enums
export {
	ConnectionStatus,
	PresenceStatus,
	type ConnectionStatus as ConnectionStatusType,
	type PresenceStatus as PresenceStatusType,
} from './presence.js';
