import { config } from 'dotenv';
import { type Annotater, LLPClient, type TextMessage } from '../../src/index.js';

async function main() {
	config();

	const platformUrl = process.env.LLP_URL;
	const apiKey = process.env.LLP_API_KEY;

	if (!platformUrl) {
		throw new Error('LLP_URL env var is not defined');
	}

	if (!apiKey) {
		throw new Error('LLP_API_KEY env var is not defined');
	}

	const client = new LLPClient('simple-agent', apiKey, { url: platformUrl });

	client.onMessage(async (_data: unknown, msg: TextMessage, annotater: Annotater) => {
		const toolCall = msg.toolCall('get_weather', '{"city":"Seattle"}', 'rainy', 1_000);
		await annotater.annotateToolCall(toolCall);
		return msg.reply('this is my response');
	});

	try {
		console.log('Connecting to server...');
		await client.connect();
		console.log(`Connected! Session: ${client.getSessionId()}`);
		console.log('Agent running. Press Ctrl+C to exit...');
		await new Promise(() => {});
	} catch (error) {
		console.error('Error:', error);
	} finally {
		await client.close();
		console.log('Disconnected.');
	}
}

main();
