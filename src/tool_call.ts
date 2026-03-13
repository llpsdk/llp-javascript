export class ToolCall {
	readonly id: string;
	readonly recipient: string;
	readonly name: string;
	readonly parameters: string;
	readonly result: string;
	readonly threwException: boolean;
	readonly durationMs: number;

	constructor(args: {
		id: string;
		recipient: string;
		name: string;
		parameters: string;
		result: string;
		threwException: boolean;
		durationMs: number;
	}) {
		this.id = args.id;
		this.recipient = args.recipient;
		this.name = args.name;
		this.parameters = args.parameters;
		this.result = args.result;
		this.threwException = args.threwException;
		this.durationMs = args.durationMs;
	}

	encode(): string {
		return JSON.stringify({
			type: 'tool_call',
			id: this.id,
			data: {
				to: this.recipient,
				name: this.name,
				parameters: this.parameters,
				result: this.result,
				threw_exception: this.threwException,
				duration_ms: this.durationMs,
			},
		});
	}
}
