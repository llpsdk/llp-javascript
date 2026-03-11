import type { ToolCall } from './message.js';

export interface Annotater {
	annotateToolCall(toolCall: ToolCall): Promise<void>;
}
