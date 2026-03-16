import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotater } from '../src/annotate.js';
import { TextMessage } from '../src/message.js';

const createMiddlewareMock = vi.fn((config) => config);

vi.mock('langchain', () => ({
	createMiddleware: createMiddlewareMock,
}));

describe('LangChain integration', () => {
	beforeEach(() => {
		createMiddlewareMock.mockClear();
	});

	it('creates middleware that annotates successful tool calls', async () => {
		const { createLLPToolMiddleware, llpMiddlewareContextSchema } = await import(
			'../src/langchain.js'
		);
		const annotateToolCall = vi.fn().mockResolvedValue(undefined);
		const annotater: Annotater = { annotateToolCall };
		const msg = new TextMessage(
			'financial-advisor',
			'Summarize the invoice',
			undefined,
			'msg-123',
			'user-1',
		);

		const callsBefore = createMiddlewareMock.mock.calls.length;
		const middleware = createLLPToolMiddleware();
		const result = await middleware.wrapToolCall(
			{
				toolCall: {
					name: 'load_invoice_pdf',
					args: { url: 'https://example.com/invoice.pdf' },
				},
				runtime: {
					context: {
						llpMessage: msg,
						llpClient: annotater,
					},
				},
			},
			async () => 'Invoice total: $50',
		);

		expect(createMiddlewareMock).toHaveBeenCalledTimes(callsBefore + 1);
		expect(middleware.name).toBe('LLPToolCallMiddleware');
		expect(middleware.contextSchema).toBe(llpMiddlewareContextSchema);
		expect(result).toBe('Invoice total: $50');
		expect(annotateToolCall).toHaveBeenCalledTimes(1);

		const toolCall = annotateToolCall.mock.calls[0][0];
		expect(toolCall.name).toBe('load_invoice_pdf');
		expect(toolCall.parameters).toContain('invoice.pdf');
		expect(toolCall.result).toBe('Invoice total: $50');
		expect(toolCall.threwException).toBe(false);
	});

	it('annotates failed tool calls and rethrows', async () => {
		const { createLLPToolMiddleware } = await import('../src/langchain.js');
		const annotateToolCall = vi.fn().mockResolvedValue(undefined);
		const annotater: Annotater = { annotateToolCall };
		const msg = new TextMessage(
			'financial-advisor',
			'Summarize the invoice',
			undefined,
			'msg-123',
			'user-1',
		);
		const middleware = createLLPToolMiddleware();
		const error = new Error('network down');

		await expect(
			middleware.wrapToolCall(
				{
					toolCall: {
						name: 'load_invoice_pdf',
						args: { url: 'https://example.com/invoice.pdf' },
					},
					runtime: {
						context: {
							llpMessage: msg,
							llpClient: annotater,
						},
					},
				},
				async () => {
					throw error;
				},
			),
		).rejects.toThrow('network down');

		expect(annotateToolCall).toHaveBeenCalledTimes(1);
		const toolCall = annotateToolCall.mock.calls[0][0];
		expect(toolCall.name).toBe('load_invoice_pdf');
		expect(toolCall.result).toBe('network down');
		expect(toolCall.threwException).toBe(true);
	});
});
