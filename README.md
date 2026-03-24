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
	client.onMessage(async (_session, msg) => {
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

## Examples

- `examples/simple-agent` is a standalone example package containing the literal Python `simple_agent.py` port
- `examples/mastra-weather-agent` is a standalone Mastra example package with its own `package.json`

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

const client = new LLPClient<ReturnType<typeof createAgent>>('my-agent', process.env.LLP_API_KEY ?? '');

client.onStart((session, presence) => {
	if (presence.status === 'available') {
		return createAgent({
			model,
			tools: [weatherTool],
			middleware: [createLLPToolMiddleware()],
		});
	}
});

client.onMessage(async (session, msg) => {
	const agent = session.data;
	if (!agent) {
		throw new Error(`No agent initialized for session ${session.id}`);
	}

	const result = await agent.invoke(
		{
			messages: [{ role: 'user', content: msg.prompt }],
		},
		{
			context: {
				llpMessage: msg,
				llpClient: session,
			},
		},
	);

	return msg.reply(String(result.messages.at(-1)?.content ?? ''));
});
```

The middleware requires LLP runtime context with:

- `llpMessage`: the inbound `TextMessage`
- `llpClient`: the session or client object used to send tool-call annotations

`onStart()` can return a typed session value that the SDK stores on `session.data`.
`onPresence()` remains available as a compatibility alias, but `onStart()` is the preferred API.

## Development

```bash
# typecheck and build
make

# lint + tests
make test

# format
make format
```
