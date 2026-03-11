/**
 * LangChain integration for the LLP SDK.
 *
 * Import via the sub-path export:
 *   import { createLLPToolMiddleware } from 'llpsdk/langchain';
 *
 * Requires `langchain` as a peer dependency.
 */

import { createMiddleware } from 'langchain';
import type { Annotater } from './annotate.js';
import type { TextMessage } from './message.js';

// LangChain calls these methods by name at runtime.
// We type only what we need from @langchain/core to stay dependency-light.
interface ToolInfo {
	name?: string;
}

interface ToolCallRequest {
	toolCall: {
		name: string;
		args: unknown;
	};
}

type ToolCallHandler = (request: ToolCallRequest) => Promise<unknown>;

export interface LLPToolMiddlewareOptions {
	name?: string;
	onAnnotationError?: (error: unknown) => void;
	serializeArgs?: (value: unknown) => string;
	serializeResult?: (value: unknown) => string;
}

function serialize(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * LangChain v1 middleware helper that captures tool calls and reports them
 * to the LLP platform via `annotater.annotateToolCall()`.
 *
 * Instantiate once per inbound message and pass it to `createAgent()`:
 *
 * ```ts
 * client.onMessage(async (annotater, msg) => {
 *   const agent = createAgent({
 *     model,
 *     tools,
 *     middleware: [createLLPToolMiddleware(msg, annotater)],
 *   });
 *   const result = await agent.invoke({ messages });
 *   return msg.reply(String(result.messages.at(-1)?.content ?? ''));
 * });
 * ```
 */
export function createLLPToolMiddleware(
	msg: TextMessage,
	annotater: Annotater,
	options: LLPToolMiddlewareOptions = {},
) {
	const serializeArgs = options.serializeArgs ?? serialize;
	const serializeResult = options.serializeResult ?? serialize;
	const onAnnotationError =
		options.onAnnotationError ??
		((error: unknown) => console.warn('[LLP] Failed to annotate tool call:', error));

	return createMiddleware({
		name: options.name ?? 'LLPToolCallMiddleware',
		wrapToolCall: async (request: ToolCallRequest, handler: ToolCallHandler) => {
			const startMs = Date.now();
			const toolName = request.toolCall.name;
			const parameters = serializeArgs(request.toolCall.args);

			try {
				const result = await handler(request);
				await annotater
					.annotateToolCall(
						msg.toolCall(toolName, parameters, serializeResult(result), Date.now() - startMs),
					)
					.catch(onAnnotationError);
				return result;
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				await annotater
					.annotateToolCall(
						msg.toolCallException(toolName, parameters, err, Date.now() - startMs),
					)
					.catch(onAnnotationError);
				throw error;
			}
		},
	});
}

/**
 * Legacy LangChain callback handler that captures tool calls and reports them
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
