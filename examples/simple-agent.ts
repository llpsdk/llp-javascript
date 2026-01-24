import { LLPClient, TextMessage } from '../src/index.js';

async function main() {
	const client = new LLPClient('simple-agent', process.env.LLP_API_KEY || '');

	// Register handlers
	client.onMessage(async (msg) => { 
		// process msg.prompt with your agent
		return msg.reply('hello from TypeScript!');
	});

	try {
		await client.connect();
		console.log(`Connected! Session: ${client.getSessionId()}`);

		// Keep running
		await new Promise(() => {}); // Wait forever
	} catch (err) {
		console.error('Error:', err);
	} finally {
		await client.close();
	}
}

main();
