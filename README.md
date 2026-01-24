# LLP TypeScript Client

[![npm version](https://img.shields.io/npm/v/llp-client.svg)](https://www.npmjs.com/package/llp-client)
[![npm downloads](https://img.shields.io/npm/dm/llp-client.svg)](https://www.npmjs.com/package/llp-client)

A minimal, idiomatic TypeScript client library for the Large Language Platform (LLP). Built for Node.js and Next.js server environments with full TypeScript support.

## Features

- 🚀 **Modern ESM** - Native ES modules with TypeScript
- 🔒 **Type-safe** - Full TypeScript support with strict mode
- ⚡ **Fast** - Built with performance in mind
- 🧪 **Well-tested** - 60+ tests with comprehensive coverage
- 📦 **Zero dependencies** - Only requires `ws` for WebSocket support
- 🎯 **Promise-based** - Native async/await patterns

## Installation

```bash
npm install llp-client
```

## Quick Start

```typescript
import { LLPClient, TextMessage } from 'llp-client';

const client = new LLPClient(
  'my-agent',
  'ws://localhost:4000/agent/websocket',
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

## API Reference

### LLPClient

The main client class for connecting to the LLP server.

#### Constructor

```typescript
new LLPClient(
  name: string,
  url: string,
  apiKey: string,
  config?: LLPClientConfig
)
```

**Parameters:**
- `name` - Unique name for your agent
- `url` - WebSocket URL (e.g., `ws://localhost:4000/agent/websocket`)
- `apiKey` - Your LLP API key
- `config` - Optional configuration object

**Configuration Options:**
```typescript
interface LLPClientConfig {
  connectTimeout?: number;   // Default: 10000ms
  responseTimeout?: number;  // Default: 10000ms
  maxQueueSize?: number;     // Default: 32
}
```

#### Methods

##### `connect(timeout?: number): Promise<void>`

Connect to the LLP server and authenticate.

```typescript
await client.connect();
await client.connect(5000); // Custom timeout
```

##### `close(): Promise<void>`

Gracefully close the connection.

```typescript
await client.close();
```

##### `sendMessage(msg: TextMessage, timeout?: number): Promise<TextMessage>`

Send a message and wait for a response.

```typescript
const response = await client.sendMessage(
  new TextMessage({
    recipient: 'other-agent',
    prompt: 'Hello!'
  })
);
```

##### `sendAsyncMessage(msg: TextMessage): Promise<void>`

Send a message without waiting for a response (fire-and-forget).

```typescript
await client.sendAsyncMessage(
  new TextMessage({
    recipient: 'logger-agent',
    prompt: 'Log this event'
  })
);
```

##### `onMessage(handler: MessageHandler): this`

Register a message handler (fluent API).

```typescript
client.onMessage(async (msg: TextMessage) => {
  // Process message
  return msg.reply('Response');
});
```

##### `onPresence(handler: PresenceHandler): this`

Register a presence update handler (fluent API).

```typescript
client.onPresence((update: PresenceMessage) => {
  console.log(`${update.sender} is ${update.status}`);
});
```

##### `getStatus(): ConnectionStatus`

Get the current connection status.

```typescript
const status = client.getStatus();
// Returns: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'closed'
```

##### `getSessionId(): string | null`

Get the current session ID (null if not connected).

```typescript
const sessionId = client.getSessionId();
```

##### `getPresence(): PresenceStatus`

Get the current presence status.

```typescript
const presence = client.getPresence();
// Returns: 'available' | 'unavailable'
```

### TextMessage

Represents a text message between agents.

#### Constructor

```typescript
new TextMessage({
  recipient: string;
  prompt: string;
  id?: string;         // Auto-generated if not provided
  sender?: string;     // Set by server
  encrypted?: boolean; // Default: false
})
```

#### Methods

##### `reply(prompt: string): TextMessage`

Create a reply to this message with sender/recipient swapped.

```typescript
const reply = incomingMsg.reply('Thanks!');
```

##### `encode(): string`

Encode the message to JSON (with base64 prompt).

```typescript
const json = message.encode();
```

##### `static decode(json: Record<string, unknown>): TextMessage`

Decode a JSON message.

```typescript
const message = TextMessage.decode(json);
```

### PresenceMessage

Represents a presence update notification.

```typescript
interface PresenceMessage {
  readonly id: string;
  readonly sender: string;
  readonly status: PresenceStatus; // 'available' | 'unavailable'
}
```

## Examples

### Echo Agent

An agent that echoes back any message it receives:

```typescript
import { LLPClient, TextMessage } from 'llp-client';

const client = new LLPClient(
  'echo-agent',
  'ws://localhost:4000/agent/websocket',
  process.env.LLP_API_KEY
);

client.onMessage(async (msg: TextMessage) => {
  console.log(`[${msg.sender}]: ${msg.prompt}`);
  return msg.reply(`Echo: ${msg.prompt}`);
});

client.onPresence((update) => {
  const status = update.status === 'available' ? '🟢' : '🔴';
  console.log(`${status} ${update.sender}`);
});

await client.connect();
console.log('Echo agent ready!');

// Graceful shutdown
process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});
```

### Request-Response Pattern

Send messages and wait for responses:

```typescript
import { LLPClient, TextMessage } from 'llp-client';

const client = new LLPClient(
  'requester',
  'ws://localhost:4000/agent/websocket',
  process.env.LLP_API_KEY
);

await client.connect();

try {
  const response = await client.sendMessage(
    new TextMessage({
      recipient: 'calculator-agent',
      prompt: 'What is 2 + 2?'
    }),
    5000 // 5 second timeout
  );

  console.log(`Answer: ${response.prompt}`);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Request timed out');
  } else {
    console.error('Error:', err);
  }
}
```

### Handling Multiple Agents

Using presence updates to track available agents:

```typescript
const availableAgents = new Set<string>();

client.onPresence((update) => {
  if (update.status === 'available') {
    availableAgents.add(update.sender);
  } else {
    availableAgents.delete(update.sender);
  }

  console.log(`Available agents: ${[...availableAgents].join(', ')}`);
});
```

### Error Handling

Comprehensive error handling:

```typescript
import {
  LLPClient,
  TextMessage,
  TimeoutError,
  NotAuthenticatedError,
  PlatformError,
  ErrorCode
} from 'llp-client';

try {
  await client.connect();

  const response = await client.sendMessage(
    new TextMessage({
      recipient: 'unknown-agent',
      prompt: 'Hello'
    })
  );
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Request timed out');
  } else if (err instanceof NotAuthenticatedError) {
    console.error('Not authenticated');
  } else if (err instanceof PlatformError) {
    if (err.code === ErrorCode.AgentNotFound) {
      console.error('Agent not found');
    } else {
      console.error(`Platform error [${err.code}]: ${err.message}`);
    }
  } else {
    console.error('Unknown error:', err);
  }
}
```

## Error Types

The library provides specific error types for different scenarios:

- `PlatformError` - Server-side errors with error codes
- `NotConnectedError` - Attempting operations while disconnected
- `NotAuthenticatedError` - Attempting operations before authentication
- `AlreadyClosedError` - Attempting operations on closed client
- `TimeoutError` - Operation timed out
- `TextMessageEmptyError` - Empty message prompt
- `TextMessageReplyError` - Cannot reply to message without ID

## Error Codes

```typescript
enum ErrorCode {
  InvalidJson = 0,
  NotAuthenticated = 1,
  InvalidSchema = 2,
  InvalidPresenceSchema = 3,
  InvalidMessageSchema = 4,
  GeneralServerError = 5,
  InvalidKey = 100,
  NameAlreadyRegistered = 101,
  MissingRecipient = 102,
  UnrecognizedType = 104,
  EncryptionUnsupported = 105,
  AgentNotFound = 106,
}
```

## TypeScript Support

The library is written in TypeScript and provides full type definitions:

```typescript
import type {
  LLPClient,
  LLPClientConfig,
  MessageHandler,
  PresenceHandler,
  ConnectionStatus,
  PresenceStatus,
  ErrorCode,
} from 'llp-client';
```

## Development

### Running Tests

```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
```

### Building

```bash
npm run build         # Compile TypeScript
npm run typecheck     # Type check without emitting
```

### Linting & Formatting

```bash
npm run lint          # Check code quality
npm run format        # Auto-format code
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass and code is properly formatted before submitting a PR.

```bash
npm test
npm run lint
npm run build
```
