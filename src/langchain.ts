/**
 * LangChain integration for the LLP SDK.
 *
 * Import via the sub-path export:
 *   import { LLPToolCallMiddleware } from 'llpsdk/langchain';
 *
 * Requires @langchain/core as a peer dependency.
 */

import type { Annotater } from './annotate.js';
import type { TextMessage } from './message.js';

// LangChain calls these methods by name at runtime.
// We type only what we need from @langchain/core to stay dependency-light.
interface ToolInfo {
	name?: string;
}

function serialize(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * LangChain callback handler that captures tool calls and reports them
 * to the LLP platform via `annotater.annotateToolCall()`.
 *
 * Instantiate once per inbound message and pass to `chain.invoke()`:
 *
 * ```ts
 * client.onMessage(async (annotater, msg) => {
 *   const middleware = new LLPToolCallMiddleware(msg, annotater);
 *   const result = await chain.invoke(input, { callbacks: [middleware] });
 *   return msg.reply(result);
 * });
 * ```
 */
export class LLPToolCallMiddleware {
	private readonly pending = new Map<
		string,
		{ name: string; parameters: string; startMs: number }
	>();

	constructor(
		private readonly msg: TextMessage,
		private readonly annotater: Annotater,
	) {}

	handleToolStart(tool: ToolInfo | null | undefined, input: unknown, runId: string): void {
		const name = tool?.name ?? 'unknown';
		const parameters = serialize(input);
		this.pending.set(runId, { name, parameters, startMs: Date.now() });
	}

	handleToolEnd(output: unknown, runId: string): void {
		const entry = this.pending.get(runId);
		if (!entry) return;
		this.pending.delete(runId);

		const durationMs = Date.now() - entry.startMs;
		const tc = this.msg.toolCall(entry.name, entry.parameters, serialize(output), durationMs);
		this.annotater
			.annotateToolCall(tc)
			.catch((err) => console.warn('[LLP] Failed to annotate tool call:', err));
	}

	handleToolError(err: unknown, runId: string): void {
		const entry = this.pending.get(runId);
		if (!entry) return;
		this.pending.delete(runId);

		const durationMs = Date.now() - entry.startMs;
		const error = err instanceof Error ? err : new Error(String(err));
		const tc = this.msg.toolCallException(entry.name, entry.parameters, error, durationMs);
		this.annotater
			.annotateToolCall(tc)
			.catch((e) => console.warn('[LLP] Failed to annotate tool call exception:', e));
	}
}
