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
import { LLPClient, TextMessage } from llpsdk;

const client = new LLPClient(
  'my-agent',
  process.env.LLP_API_KEY
);

// Register message handler
client.onMessage(async (msg: TextMessage) => {
  console.log(`Received: ${msg.prompt}`);
  return msg.reply('Hello back!');
});

// Connect and start
await client.connect();
console.log('Connected!');
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
