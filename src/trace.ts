import { randomUUID } from 'node:crypto';

export type TraceDirection = 'inbound' | 'outbound';

export interface TracePayload {
	readonly decisionId?: string;
	readonly stepType?: string;
	readonly latencyMs?: number;
	readonly score?: number;
	readonly direction?: TraceDirection;
	readonly conversationId?: string;
}

export type TraceInput = TracePayload & {
	readonly prompt: string;
};

/**
 * Analytics/trace event sent over the agent websocket.
 * Mirrors the shape we plan to store in the platform.
 */
export class TraceMessage {
	readonly id: string;
	readonly sender: string;
	readonly prompt: string;
	readonly decisionId?: string;
	readonly stepType?: string;
	readonly latencyMs?: number;
	readonly score?: number;
	readonly direction: TraceDirection;
	readonly conversationId?: string;

	constructor(prompt: string, payload: TracePayload = {}, id?: string, sender?: string) {
		if (!prompt || !prompt.trim()) {
			throw new Error('Trace prompt cannot be empty');
		}

		this.id = id ?? randomUUID();
		this.sender = sender ?? '';
		this.prompt = prompt;
		this.decisionId = payload.decisionId;
		this.stepType = payload.stepType;
		this.latencyMs = payload.latencyMs;
		this.score = payload.score;
		this.direction = payload.direction ?? 'outbound';
		this.conversationId = payload.conversationId;
	}

	encode(): string {
		const data: Record<string, unknown> = {
			prompt: Buffer.from(this.prompt, 'utf-8').toString('base64'),
			decision_id: this.decisionId,
			step_type: this.stepType,
			latency_ms: this.latencyMs,
			score: this.score,
			direction: this.direction,
			conversation_id: this.conversationId,
		};

		// Drop undefined values to keep payload small
		for (const key of Object.keys(data)) {
			if (data[key] === undefined || data[key] === null) {
				delete data[key];
			}
		}

		return JSON.stringify({
			type: 'trace',
			id: this.id,
			from: this.sender,
			data,
		});
	}
}

export interface TraceSender {
	sendTrace(trace: TraceMessage | TraceInput): Promise<void>;
}

/**
 * LangChain-friendly callback handler that emits trace events.
 * It is intentionally dependency-light: it relies only on the method names
 * that LangChain calls at runtime, not on LangChain types.
 */
export class PlatformTraceHandler {
	private readonly timings = new Map<string, number>();

	constructor(private readonly sender: TraceSender) {}

	// ---- LLM hooks ----
	handleLLMStart(_llm: unknown, prompts: string[], runId: string, parentRunId?: string): void {
		this.markStart(runId);
		this.emitSafe({
			prompt: prompts[0] ?? '',
			decisionId: parentRunId ?? runId,
			stepType: 'llm',
		});
	}

	handleLLMEnd(_output: unknown, runId: string, parentRunId?: string): void {
		this.emitWithDuration(runId, parentRunId, 'llm_end');
	}

	// ---- Chain hooks ----
	handleChainStart(_chain: unknown, inputs: unknown, runId: string, parentRunId?: string): void {
		this.markStart(runId);
		const prompt = serialize(inputs);
		this.emitSafe({
			prompt,
			decisionId: parentRunId ?? runId,
			stepType: 'chain',
		});
	}

	handleChainEnd(_outputs: unknown, runId: string, parentRunId?: string): void {
		this.emitWithDuration(runId, parentRunId, 'chain_end');
	}

	// ---- Tool hooks ----
	handleToolStart(_tool: unknown, input: unknown, runId: string, parentRunId?: string): void {
		this.markStart(runId);
		this.emitSafe({
			prompt: serialize(input),
			decisionId: parentRunId ?? runId,
			stepType: 'tool_call',
		});
	}

	handleToolEnd(_output: unknown, runId: string, parentRunId?: string): void {
		this.emitWithDuration(runId, parentRunId, 'tool_end');
	}

	// ---- Agent hooks ----
	handleAgentAction(action: unknown, runId: string, parentRunId?: string): void {
		this.markStart(runId);
		this.emitSafe({
			prompt: serialize(action),
			decisionId: parentRunId ?? runId,
			stepType: 'agent_action',
		});
	}

	handleAgentEnd(_action: unknown, runId: string, parentRunId?: string): void {
		this.emitWithDuration(runId, parentRunId, 'agent_end');
	}

	private markStart(runId: string): void {
		this.timings.set(runId, Date.now());
	}

	private duration(runId: string): number | undefined {
		const start = this.timings.get(runId);
		if (start === undefined) return undefined;
		const ms = Date.now() - start;
		this.timings.delete(runId);
		return ms;
	}

	private emitWithDuration(runId: string, parentRunId: string | undefined, stepType: string): void {
		const latencyMs = this.duration(runId);
		this.emitSafe({
			prompt: `${stepType}`,
			decisionId: parentRunId ?? runId,
			stepType,
			latencyMs,
		});
	}

	private emitSafe(input: TraceInput): void {
		// Ensure we always have some prompt text
		const prompt = input.prompt && input.prompt.trim().length > 0 ? input.prompt : input.stepType ?? 'trace';

		const payload: TraceInput = {
			...input,
			prompt,
		};

		this.sender
			.sendTrace(payload)
			.catch((err) => console.warn('[LLP tracing] Failed to send trace:', err));
	}
}

function serialize(value: unknown): string {
	try {
		return typeof value === 'string' ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}
