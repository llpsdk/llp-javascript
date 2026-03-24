# Weather Agent Example

Mastra-based LLP weather agent example.

This example:

- uses `@mastra/core` for the agent runtime
- uses `llpsdk/mastra` to annotate tool calls back to LLP
- answers weather questions for a fixed set of cities
- declines unsupported cities and non-weather questions

## Setup

```bash
cd /Users/gagansingh/code/llpsdk/llp-javascript/examples/mastra-weather-agent
npm install
```

## Environment

Create a `.env` file in this directory:

```bash
LLP_URL=wss://llphq.com/agent/websocket
LLP_API_KEY=your-api-key
MODEL_NAME=ollama/llama3.1
AGENT_NAME=weather-agent-mastra
```

## Run

```bash
npm start
```
