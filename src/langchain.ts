/**
 * LangChain integration for the LLP SDK.
 *
 * Import via the sub-path export:
 *   import { LLPAnnotationMiddleware } from 'llpsdk/langchain';
 *
 * Requires `langchain` as a peer dependency.
 */

import { createMiddleware } from 'langchain';
import { z } from 'zod';
import type { Annotater } from './annotate.js';
import { getLLPContext } from './context.js';
import type { TextMessage } from './message.js';

export interface LLPToolMiddlewareOptions {
	onAnnotationError?: (error: unknown) => void;
	serializeArgs?: (value: unknown) => string;
	serializeResult?: (value: unknown) => string;
}

export const llpMiddlewareContextSchema = z.object({
	llpMessage: z.custom<TextMessage>(),
	llpClient: z.custom<Annotater>(),
});

function serialize(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * LangChain v1 middleware helper that captures tool calls and reports them
 * to the LLP platform via `llpClient.annotateToolCall()`.
 *
 * Pass the LLP runtime context when invoking the agent:
 *
 * ```ts
 * const agent = createAgent({
 *   model,
 *   tools,
 *   middleware: [createLLPToolMiddleware()],
 * });
 *
 * client.onMessage(async (session, msg) => {
 *   const result = await agent.invoke(
 *     { messages },
 *     { context: { llpMessage: msg, llpClient: session } },
 *   );
 *   return msg.reply(String(result.messages.at(-1)?.content ?? ''));
 * });
 * ```
 */
/**
 * @deprecated Use `LLPAnnotationMiddleware` instead. This older API requires
 * manually passing `{ context: { llpMessage, llpClient } }` on every invoke call.
 */
export function createLLPToolMiddleware(options: LLPToolMiddlewareOptions = {}) {
	const serializeArgs = options.serializeArgs ?? serialize;
	const serializeResult = options.serializeResult ?? serialize;
	const onAnnotationError =
		options.onAnnotationError ??
		((error: unknown) => console.warn('[LLP] Failed to annotate tool call:', error));

	return createMiddleware({
		name: 'LLPToolCallMiddleware',
		contextSchema: llpMiddlewareContextSchema,
		wrapToolCall: async (request, handler) => {
			const startMs = Date.now();
			const { llpMessage, llpClient } = request.runtime.context;
			const toolName = request.toolCall.name;
			const parameters = serializeArgs(request.toolCall.args);

			try {
				const result = await handler(request);
				await llpClient
					.annotateToolCall(
						llpMessage.toolCall(
							toolName,
							parameters,
							serializeResult(result),
							Date.now() - startMs,
						),
					)
					.catch(onAnnotationError);
				return result;
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				await llpClient
					.annotateToolCall(
						llpMessage.toolCallException(toolName, parameters, err, Date.now() - startMs),
					)
					.catch(onAnnotationError);
				throw error;
			}
		},
	});
}

// ---------------------------------------------------------------------------
// New API — reads context from AsyncLocalStorage automatically
// ---------------------------------------------------------------------------

/**
 * LangChain middleware that captures tool calls and reports them to the
 * LLP platform. Context is read from AsyncLocalStorage automatically —
 * no manual context passing needed.
 *
 * ```ts
 * new LLPClient(name, key, config)
 *   .onStart(() => createAgent({
 *     model,
 *     tools,
 *     middleware: [LLPAnnotationMiddleware],
 *   }))
 *   .onMessage(async (agent, msg) => {
 *     const result = await agent.invoke({ messages: [...] });
 *     return msg.reply(extractText(result));
 *   })
 *   .connect();
 * ```
 */
export const LLPAnnotationMiddleware = createMiddleware({
	name: 'LLPAnnotationMiddleware',
	wrapToolCall: async (request, handler) => {
		const startMs = Date.now();
		const { llpMessage, llpClient } = getLLPContext();
		const toolName = request.toolCall.name;
		const parameters = serialize(request.toolCall.args);

		try {
			const result = await handler(request);
			await llpClient
				.annotateToolCall(
					llpMessage.toolCall(toolName, parameters, serialize(result), Date.now() - startMs),
				)
				.catch((error: unknown) => console.warn('[LLP] Failed to annotate tool call:', error));
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			await llpClient
				.annotateToolCall(
					llpMessage.toolCallException(toolName, parameters, err, Date.now() - startMs),
				)
				.catch((annotateErr: unknown) =>
					console.warn('[LLP] Failed to annotate tool call:', annotateErr),
				);
			throw error;
		}
	},
});
