/**
 * Mastra integration for the LLP SDK.
 *
 * Import via the sub-path export:
 *   import { wrapWithLLPAnnotation, type LLPMastraContext } from 'llpsdk/mastra';
 *
 * Does not require @mastra/core as a dependency — uses duck typing for RuntimeContext.
 *
 * Usage:
 *
 * ```ts
 * import { wrapWithLLPAnnotation, type LLPMastraContext } from 'llpsdk/mastra';
 * import { RuntimeContext } from '@mastra/core/runtime-context';
 * import { createTool } from '@mastra/core/tools';
 *
 * const myTool = createTool({
 *   id: 'my_tool',
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: wrapWithLLPAnnotation('my_tool', async ({ context }) => {
 *     return await doSomething(context.query);
 *   }),
 * });
 *
 * // In handleMessage:
 * const runtimeContext = new RuntimeContext<LLPMastraContext>();
 * runtimeContext.set('llpMessage', message);
 * runtimeContext.set('llpAnnotater', annotater);
 * const result = await agent.generate(prompt, { runtimeContext });
 * ```
 */

import type { Annotater } from './annotate.js';
import type { TextMessage } from './message.js';

/**
 * The runtime context type for LLP-connected Mastra agents.
 *
 * Use as the type parameter for RuntimeContext:
 *   new RuntimeContext<LLPMastraContext>()
 */
export type LLPMastraContext = {
	llpMessage: TextMessage;
	llpAnnotater: Annotater;
};

/**
 * Minimal interface that RuntimeContext<LLPMastraContext> satisfies.
 * Used internally so this module does not depend on @mastra/core.
 */
interface LLPMastraRuntimeContextLike {
	get(key: 'llpMessage'): TextMessage;
	get(key: 'llpAnnotater'): Annotater;
}

export interface LLPAnnotationOptions {
	/** Override how tool input is serialized for the annotation. Default: JSON.stringify. */
	serializeInput?: (value: unknown) => string;
	/** Override how tool output is serialized for the annotation. Default: JSON.stringify. */
	serializeOutput?: (value: unknown) => string;
	/** Called when annotation fails. Default: console.warn. Never throws. */
	onAnnotationError?: (error: unknown) => void;
}

function serialize(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * Wraps a Mastra tool's execute function with LLP tool-call annotation.
 *
 * Handles timing, success annotation, exception annotation, and annotation
 * error swallowing — the Mastra equivalent of createLLPToolMiddleware() for
 * LangChain.
 *
 * The returned function is compatible with Mastra's createTool execute signature.
 * The tool's runtimeContext must be a RuntimeContext<LLPMastraContext>.
 */
export function wrapWithLLPAnnotation<TInput, TOutput>(
	toolId: string,
	execute: (args: { context: TInput }) => Promise<TOutput>,
	options: LLPAnnotationOptions = {},
): (args: { context: TInput; runtimeContext: LLPMastraRuntimeContextLike }) => Promise<TOutput> {
	const serializeInput = options.serializeInput ?? serialize;
	const serializeOutput = options.serializeOutput ?? serialize;
	const onAnnotationError =
		options.onAnnotationError ??
		((error: unknown) => console.warn('[LLP] Failed to annotate tool call:', error));

	return async ({ context, runtimeContext }) => {
		const startMs = Date.now();
		const llpMessage = runtimeContext.get('llpMessage');
		const llpAnnotater = runtimeContext.get('llpAnnotater');
		const params = serializeInput(context);

		try {
			const result = await execute({ context });
			llpAnnotater
				.annotateToolCall(
					llpMessage.toolCall(toolId, params, serializeOutput(result), Date.now() - startMs),
				)
				.catch(onAnnotationError);
			return result;
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			llpAnnotater
				.annotateToolCall(
					llpMessage.toolCallException(toolId, params, e, Date.now() - startMs),
				)
				.catch(onAnnotationError);
			throw err;
		}
	};
}
