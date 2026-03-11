# LLP TypeScript SDK

Javascript SDK for connecting to Large Language Platform.

## Features

- Simple, intuitive async API
- Websocket-based communication
- Full Typescript support

## Installation

```bash
npm i llpsdk
```

## Quick Start

```typescript
import { LLPClient } from 'llpsdk';
import { config } from 'dotenv';

async function main() {
	config();
	// Initialize the client
	const client = new LLPClient('my-agent', process.env.LLP_API_KEY ?? '');

	// Define a callback handler for processing messages
	client.onMessage(async (_annotater, msg) => {
		// Process the prompt with your agent.
		// Replace this with your own processing logic.
		const response = msg.prompt;

		// You must return a response
		return msg.reply(response);
	});

	// Connect and keep the client running
	await client.connect();
	await new Promise(() => {});
}

main();
```

## LangChain Tool Call Capture

If your LangChain agent uses tools, the SDK can automatically annotate those
tool calls back to LLP.

```typescript
import { LLPClient } from 'llpsdk';
import { createLLPToolMiddleware } from 'llpsdk/langchain';
import { createAgent, tool } from 'langchain';
import * as z from 'zod';

const weatherTool = tool(
	async ({ city }: { city: string }) => `Weather for ${city}: sunny`,
	{
		name: 'weather',
		description: 'Look up the weather for a city',
		schema: z.object({ city: z.string() }),
	},
);

client.onMessage(async (annotater, msg) => {
	const agent = createAgent({
		model,
		tools: [weatherTool],
		middleware: [createLLPToolMiddleware(msg, annotater)],
	});

	const result = await agent.invoke({
		messages: [{ role: 'user', content: msg.prompt }],
	});

	return msg.reply(String(result.messages.at(-1)?.content ?? ''));
});
```

## Development

```bash
# typecheck and build
make

# lint + tests
make test

# format
make format
```
