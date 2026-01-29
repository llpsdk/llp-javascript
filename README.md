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
	client.onMessage(async (msg) => {
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

## Development

```bash
# typecheck and build
make

# lint + tests
make test

# format
make format
```
