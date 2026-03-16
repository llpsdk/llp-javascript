import type { Annotater } from './annotate.js';
import type { ToolCall } from './tool_call.js';

export class LLPSession<TData = unknown> implements Annotater {
	private sessionData: TData | undefined;
	private dataReady: {
		promise: Promise<void>;
		resolve: () => void;
		reject: (err: Error) => void;
	} | null = null;

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
		this.dataReady?.resolve();
		this.dataReady = null;
	}

	failInit(err: Error): void {
		this.dataReady?.reject(err);
		this.dataReady = null;
	}

	clearData(): void {
		this.sessionData = undefined;
	}

	async waitForData(): Promise<void> {
		if (this.sessionData !== undefined) return;
		if (!this.dataReady) {
			let resolve!: () => void;
			let reject!: (err: Error) => void;
			const promise = new Promise<void>((res, rej) => {
				resolve = res;
				reject = rej;
			});
			this.dataReady = { promise, resolve, reject };
		}
		await this.dataReady.promise;
	}

	clear(): void {
		this.sessionData = undefined;
		this.dataReady = null;
	}
}
