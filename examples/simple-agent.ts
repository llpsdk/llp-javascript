import { LLPClient, TextMessage } from '../src/index.js';

async function main() {
	const client = new LLPClient('simple-agent', process.env.LLP_API_KEY || '');

	// Register handlers
	client.onMessage(async (msg) => {
		console.log(`Received from ${msg.sender}: ${msg.prompt}`);
		return msg.reply('hello from TypeScript!');
	});
	client.onPresence((update) => {
		console.log(`${update.sender} is now ${update.status}`);
	});

	try {
		console.log('Connecting...');
		await client.connect();
		console.log(`Connected! Session: ${client.getSessionId()}`);

		// Send a message
		const response = await client.sendMessage(
			new TextMessage({
				recipient: 'other-agent',
				prompt: 'Hello from TypeScript!',
			}),
		);
		console.log(`Response: ${response.prompt}`);

		// Keep running
		await new Promise(() => {}); // Wait forever
	} catch (err) {
		console.error('Error:', err);
	} finally {
		await client.close();
	}
}

main();
