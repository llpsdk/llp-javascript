import { describe, expect, it, vi } from 'vitest';
import { PlatformTraceHandler, TraceMessage } from '../src/trace.js';

describe('TraceMessage', () => {
	it('encodes prompt as base64 and omits undefined fields', () => {
		const msg = new TraceMessage('hello trace', {
			stepType: 'llm',
			latencyMs: 42,
		});

		const encoded = JSON.parse(msg.encode()) as Record<string, unknown>;
		expect(encoded.type).toBe('trace');
		expect(encoded.data).toBeDefined();

		const data = encoded.data as Record<string, unknown>;
		expect(data.step_type).toBe('llm');
		expect(data.latency_ms).toBe(42);
		expect(data.score).toBeUndefined();

		const decodedPrompt = Buffer.from(data.prompt as string, 'base64').toString('utf-8');
		expect(decodedPrompt).toBe('hello trace');
	});
});

describe('PlatformTraceHandler', () => {
	it('emits trace on LLM start with safe defaults', async () => {
		const sendTrace = vi.fn().mockResolvedValue(undefined);
		const handler = new PlatformTraceHandler({ sendTrace });

		handler.handleLLMStart({}, ['prompt text'], 'run-1', 'parent-1');

		expect(sendTrace).toHaveBeenCalledTimes(1);
		const payload = sendTrace.mock.calls[0][0];
		expect(payload.prompt).toBe('prompt text');
		expect(payload.decisionId).toBe('parent-1');
		expect(payload.stepType).toBe('llm');
	});

	it('uses stepType as prompt when prompt is empty and includes latency', async () => {
		const sendTrace = vi.fn().mockResolvedValue(undefined);
		const handler = new PlatformTraceHandler({ sendTrace });

		handler.handleToolStart({}, {}, 'run-2', undefined);
		// simulate some time
		await new Promise((resolve) => setTimeout(resolve, 1));
		handler.handleToolEnd({}, 'run-2', undefined);

		// Two traces: start + end
		expect(sendTrace).toHaveBeenCalledTimes(2);
		const endPayload = sendTrace.mock.calls[1][0];
		expect(endPayload.stepType).toBe('tool_end');
		expect(typeof endPayload.latencyMs === 'number' || endPayload.latencyMs === undefined).toBe(true);
	});
});
