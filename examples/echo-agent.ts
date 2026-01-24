import { LLPClient, type PresenceMessage, TextMessage } from '../src/index.js';

async function main() {
	const client = new LLPClient('ts-echo-agent', process.env.LLP_API_KEY || 'testkey');

	client.onMessage(async (msg: TextMessage) => {
		console.log(`[${msg.sender}]: ${msg.prompt}`);
		// Echo back the message
		return msg.reply(`Echo: ${msg.prompt}`);
	});

	client.onPresence((update: PresenceMessage) => {
		const status = update.status === 'available' ? '🟢' : '🔴';
		console.log(`${status} ${update.sender}`);
		tm = new TextMessage({ recipient: update.sender, prompt: 'Hello, from Typescript!' });
		client.sendAsyncMessage(tm);
	});

	try {
		await client.connect();
		console.log('Echo agent ready!');

		// Handle graceful shutdown
		process.on('SIGINT', async () => {
			console.log('\nShutting down...');
			await client.close();
			process.exit(0);
		});

		await new Promise(() => {}); // Wait forever
	} catch (err) {
		console.error('Fatal error:', err);
		process.exit(1);
	}
}

main();
