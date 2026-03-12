import type { Annotater } from './annotate.js';
import type { ToolCall } from './message.js';

export class LLPSession<TData = unknown> implements Annotater {
	private readonly values = new Map<string, unknown>();
	private sessionData: TData | undefined;

	constructor(
		public readonly id: string,
		private readonly annotater: Annotater,
	) {}

	async annotateToolCall(toolCall: ToolCall): Promise<void> {
		await this.annotater.annotateToolCall(toolCall);
	}

	get data(): TData | undefined {
		return this.sessionData;
	}

	setData(value: TData): void {
		this.sessionData = value;
	}

	clearData(): void {
		this.sessionData = undefined;
	}

	get<T>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}

	set<T>(key: string, value: T): void {
		this.values.set(key, value);
	}

	delete(key: string): boolean {
		return this.values.delete(key);
	}

	clear(): void {
		this.sessionData = undefined;
		this.values.clear();
	}
}
