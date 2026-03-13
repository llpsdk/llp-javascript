import type { ToolCall } from './tool_call.js';

export interface Annotater {
	annotateToolCall(toolCall: ToolCall): Promise<void>;
}
