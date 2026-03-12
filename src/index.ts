// Annotater interface
export type { Annotater } from './annotate.js';
// Core client
export {
	LLPClient,
	type LLPClientConfig,
	// Legacy handler types (backward compat)
	type MessageHandler,
	type PresenceHandler,
	type SessionCreator,
	type StartHandler,
	type StopHandler,
	type TypedLLPClient,
	type TypedMessageHandler,
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
// Message types
export { PresenceMessage, TextMessage, ToolCall } from './message.js';
// Status enums
export {
	ConnectionStatus,
	type ConnectionStatus as ConnectionStatusType,
	PresenceStatus,
	type PresenceStatus as PresenceStatusType,
} from './presence.js';
export { LLPSession, LLPSession as Session } from './session.js';
