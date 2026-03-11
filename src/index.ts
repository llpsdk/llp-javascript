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
	type ErrorCode as ErrorCodeType,
	NotAuthenticatedError,
	NotConnectedError,
	PlatformError,
	TextMessageEmptyError,
	TextMessageReplyError,
	TimeoutError,
} from './errors.js';

// Annotater interface
export type { Annotater } from './annotate.js';

// Message types
export { PresenceMessage, TextMessage, ToolCall } from './message.js';

// Status enums
export {
	ConnectionStatus,
	type ConnectionStatus as ConnectionStatusType,
	PresenceStatus,
	type PresenceStatus as PresenceStatusType,
} from './presence.js';
