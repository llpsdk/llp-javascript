# Simple Agent Example

This is a literal TypeScript port of the Python `simple_agent.py` example.

It:

- connects to LLP
- annotates a hardcoded `get_weather` tool call for Seattle
- replies with the fixed string `this is my response`

## Run

```bash
LLP_URL=wss://llphq.com/agent/websocket \
LLP_API_KEY=your-api-key \
npm run example
```
