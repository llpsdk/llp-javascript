import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { config } from 'dotenv';
import { type Annotater, LLPClient, type LLPClientConfig, type TextMessage } from 'llpsdk';
import { type LLPMastraContext, wrapWithLLPAnnotation } from 'llpsdk/mastra';
import * as z from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

const SYSTEM_PROMPT = `
You are a helpful meteorologist that gives succinct responses regarding the weather for various American cities.

Important rules:
1. Use the get_weather tool for every weather question about a supported city.
2. Supported cities are New York, Los Angeles, Chicago, Miami, Seattle, Denver, San Francisco, Austin, Boston, and London.
3. If the city is unsupported, decline and mention the supported cities.
4. If the question is not about weather, decline.
5. Keep summaries concise and practical.
`;

const supportedCities = [
	'New York',
	'Los Angeles',
	'Chicago',
	'Miami',
	'Seattle',
	'Denver',
	'San Francisco',
	'Austin',
	'Boston',
	'London',
] as const;

const weatherData: Record<
	(typeof supportedCities)[number],
	{ conditions: string; temperature_f: number; advisory: string }
> = {
	'New York': {
		conditions: 'Partly cloudy with a steady northwest breeze',
		temperature_f: 45,
		advisory: 'A light jacket is a good idea.',
	},
	'Los Angeles': {
		conditions: 'Sunny and mild',
		temperature_f: 72,
		advisory: 'Comfortable weather for being outside.',
	},
	Chicago: {
		conditions: 'Overcast, windy, with a chance of snow',
		temperature_f: 30,
		advisory: 'Dress warmly and plan for wind.',
	},
	Miami: {
		conditions: 'Humid and warm',
		temperature_f: 82,
		advisory: 'Stay hydrated if you are outdoors.',
	},
	Seattle: {
		conditions: 'Rainy with a cool west wind',
		temperature_f: 48,
		advisory: 'Bring a rain jacket or umbrella.',
	},
	Denver: {
		conditions: 'Clear skies with a crisp breeze',
		temperature_f: 38,
		advisory: 'Layers will help with the cooler air.',
	},
	'San Francisco': {
		conditions: 'Foggy and breezy',
		temperature_f: 58,
		advisory: 'A light outer layer will be useful.',
	},
	Austin: {
		conditions: 'Sunny and pleasant',
		temperature_f: 68,
		advisory: 'Good conditions for outdoor plans.',
	},
	Boston: {
		conditions: 'Cold and windy',
		temperature_f: 35,
		advisory: 'Bundle up before heading out.',
	},
	London: {
		conditions: 'Light drizzle with cool air',
		temperature_f: 50,
		advisory: 'Carry an umbrella.',
	},
};

type WeatherToolResult = {
	city: string;
	conditions: string;
	temperature_f: number;
	advisory: string;
};
type WeatherAgent = ReturnType<typeof createWeatherAgent>;

const getWeatherTool = createTool({
	id: 'get_weather',
	description: 'Get the current weather for a supported city.',
	inputSchema: z.object({
		city: z.enum(supportedCities),
	}),
	execute: wrapWithLLPAnnotation<{ city: (typeof supportedCities)[number] }, WeatherToolResult>(
		'get_weather',
		async (inputData) => {
			return { city: inputData.city, ...weatherData[inputData.city] };
		},
	),
});

function createWeatherAgent(model: string) {
	return new Agent({
		id: 'mastra-weather-agent',
		name: 'mastra-weather-agent',
		instructions: SYSTEM_PROMPT,
		model,
		tools: { get_weather: getWeatherTool },
	});
}

async function handleMessage(
	agent: WeatherAgent,
	message: TextMessage,
	annotater: Annotater,
): Promise<string> {
	const requestContext = new RequestContext<LLPMastraContext>();
	requestContext.set('llpMessage', message);
	requestContext.set('llpAnnotater', annotater);

	try {
		return await agent.generate(message.prompt, { requestContext });
	} catch (error) {
		console.error('Agent execution failed:', error);
		return "I'm sorry, I hit an error while handling that weather request.";
	}
}

async function main(): Promise<void> {
	const agentName = process.env.AGENT_NAME ?? 'mastra-weather-agent';
	const apiKey = process.env.LLP_API_KEY ?? '';
	const model = process.env.MODEL_NAME ?? 'ollama/llama3.1';

	if (!process.env.LLP_URL) {
		throw new Error('LLP_URL env var is not defined');
	}

	if (!apiKey) {
		throw new Error('LLP_API_KEY env var is not defined');
	}

	const llpConfig: LLPClientConfig = {
		url: process.env.LLP_URL,
		responseTimeout: 600_000,
	};

	const client = new LLPClient(agentName, apiKey, llpConfig)
		.onStart(() => createWeatherAgent(model))
		.onMessage(async (agent, msg, annotater) => {
			const response = await handleMessage(agent, msg, annotater);
			return msg.reply(response);
		})
		.onStop(() => {
			console.log('session ended');
		});

	try {
		console.log(`Mastra weather agent initialized model=${model}`);
		await client.connect();
		console.log('Connected to platform');
		await new Promise(() => {});
	} catch (error) {
		console.error('Fatal error:', error);
		process.exit(1);
	}
}

void main();
