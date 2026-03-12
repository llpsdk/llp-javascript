import { AsyncLocalStorage } from 'node:async_hooks';
import type { Annotater } from './annotate.js';
import type { TextMessage } from './message.js';

export interface LLPContext {
	readonly llpMessage: TextMessage;
	readonly llpClient: Annotater;
}

const storage = new AsyncLocalStorage<LLPContext>();

/**
 * Runs the given function within an LLP async context.
 * The middleware reads from this context automatically —
 * no need for developers to pass context manually.
 */
export function runWithLLPContext<T>(ctx: LLPContext, fn: () => T): T {
	return storage.run(ctx, fn);
}

/**
 * Retrieves the current LLP context from AsyncLocalStorage.
 * Throws if called outside of a `runWithLLPContext` scope.
 */
export function getLLPContext(): LLPContext {
	const ctx = storage.getStore();
	if (!ctx) {
		throw new Error('LLP context not available — this must be called inside an onMessage handler');
	}
	return ctx;
}
