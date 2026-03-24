/**
 * Mastra integration for the LLP SDK.
 *
 * Import via the sub-path export:
 *   import { wrapWithLLPAnnotation, type LLPMastraContext } from 'llpsdk/mastra';
 *
 * Does not require @mastra/core as a dependency — uses duck typing for RequestContext.
 *
 * Usage (Mastra v1.x):
 *
 * ```ts
 * import { wrapWithLLPAnnotation, type LLPMastraContext } from 'llpsdk/mastra';
 * import { RequestContext } from '@mastra/core/request-context';
 * import { createTool } from '@mastra/core/tools';
 *
 * const myTool = createTool({
 *   id: 'my_tool',
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: wrapWithLLPAnnotation('my_tool', async (inputData) => {
 *     return await doSomething(inputData.query);
 *   }),
 * });
 *
 * // In handleMessage:
 * const requestContext = new RequestContext<LLPMastraContext>();
 * requestContext.set('llpMessage', message);
 * requestContext.set('llpAnnotater', annotater);
 * const result = await agent.generate(prompt, { requestContext });
 * ```
 */

import type { Annotater } from './annotate.js';
import type { TextMessage } from './message.js';

/**
 * The runtime context type for LLP-connected Mastra agents.
 *
 * Use as the type parameter for RequestContext:
 *   new RequestContext<LLPMastraContext>()
 */
export type LLPMastraContext = {
	llpMessage: TextMessage;
	llpAnnotater: Annotater;
};

/**
 * Minimal interface that RequestContext<LLPMastraContext> satisfies.
 * Used internally so this module does not depend on @mastra/core.
 */
interface LLPMastraRequestContextLike {
	get(key: 'llpMessage'): TextMessage;
	get(key: 'llpAnnotater'): Annotater;
}

/**
 * Minimal duck-type for Mastra v1.x ToolExecutionContext.
 * Only requires the requestContext field we actually use.
 */
interface MastraToolExecutionContextLike {
	requestContext?: LLPMastraRequestContextLike;
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
 * Compatible with Mastra v1.x createTool execute signature: (inputData, context) => Promise<TOutput>
 * The tool's requestContext must be a RequestContext<LLPMastraContext>.
 */
export function wrapWithLLPAnnotation<TInput, TOutput>(
	toolId: string,
	execute: (inputData: TInput) => Promise<TOutput>,
	options: LLPAnnotationOptions = {},
): (inputData: TInput, context: MastraToolExecutionContextLike) => Promise<TOutput> {
	const serializeInput = options.serializeInput ?? serialize;
	const serializeOutput = options.serializeOutput ?? serialize;
	const onAnnotationError =
		options.onAnnotationError ??
		((error: unknown) => console.warn('[LLP] Failed to annotate tool call:', error));

	return async (inputData, context) => {
		const startMs = Date.now();
		const requestContext = context.requestContext;
		const llpMessage = requestContext?.get('llpMessage');
		const llpAnnotater = requestContext?.get('llpAnnotater');
		const params = serializeInput(inputData);

		try {
			const result = await execute(inputData);
			if (llpMessage && llpAnnotater) {
				llpAnnotater
					.annotateToolCall(
						llpMessage.toolCall(toolId, params, serializeOutput(result), Date.now() - startMs),
					)
					.catch(onAnnotationError);
			}
			return result;
		} catch (err) {
			if (llpMessage && llpAnnotater) {
				const e = err instanceof Error ? err : new Error(String(err));
				llpAnnotater
					.annotateToolCall(llpMessage.toolCallException(toolId, params, e, Date.now() - startMs))
					.catch(onAnnotationError);
			}
			throw err;
		}
	};
}
