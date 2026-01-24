/**
 * Financial Advisor Agent - TypeScript implementation mirroring Python/Go agent architecture.
 *
 * This agent provides financial advisory capabilities using the LLP TypeScript SDK.
 * Structure mirrors the Python financial_advisor and Go devops_agent examples.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the same directory as this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

import { LLPClient, TextMessage } from '../src/index.js';

// =============================================================================
// Constants
// =============================================================================

const SYSTEM_PROMPT = `
You are a Financial Advisor AI assistant that analyzes financial questions and provides guidance.
You MUST return ONLY valid JSON responses.

## Response Format

Return JSON matching ONE of these formats:

### For Financial Analysis Questions:
{
    "type": "analysis",
    "category": "investment" | "budgeting" | "retirement" | "tax" | "debt" | "savings",
    "risk_level": "low" | "medium" | "high",
    "recommendation": "Your specific recommendation",
    "considerations": ["factor1", "factor2", ...]
}

### For Capabilities Questions:
{
    "type": "capabilities"
}

### For Out-of-Domain Questions:
{
    "type": "decline",
    "reason": "Polite explanation of why you cannot help"
}

## Your Expertise Areas:
- Investment strategies and portfolio allocation
- Budgeting and expense management
- Retirement planning (401k, IRA, pensions)
- Tax optimization strategies
- Debt management and payoff strategies
- Emergency fund and savings goals
- Risk assessment and management

## Important Rules:
1. NEVER provide specific stock picks or guarantees
2. Always recommend consulting a licensed financial advisor for major decisions
3. Consider the user's risk tolerance when applicable
4. Provide educational information, not personalized financial advice
5. Be clear about limitations and uncertainties

## Category Definitions:
- investment: Questions about stocks, bonds, ETFs, portfolio allocation
- budgeting: Questions about spending, income management, expense tracking
- retirement: Questions about 401k, IRA, pension, retirement age planning
- tax: Questions about tax strategies, deductions, tax-advantaged accounts
- debt: Questions about loans, credit cards, debt payoff strategies
- savings: Questions about emergency funds, savings goals, high-yield accounts
`;

// =============================================================================
// Types (mirrors Python dataclasses / Go structs)
// =============================================================================

interface FinancialAnalysis {
	type: 'analysis' | 'capabilities' | 'decline' | string;
	category?: 'investment' | 'budgeting' | 'retirement' | 'tax' | 'debt' | 'savings';
	risk_level?: 'low' | 'medium' | 'high';
	recommendation?: string;
	considerations?: string[];
	reason?: string; // For decline responses
}

// =============================================================================
// Ollama Client (mirrors Python/Go Ollama client)
// =============================================================================

class OllamaClient {
	private host: string;
	private model: string;
	private headers: Record<string, string>;

	constructor(host: string, model: string, apiKey?: string) {
		this.host = host.replace(/\/$/, '');
		this.model = model;
		this.headers = {
			'Content-Type': 'application/json',
		};
		if (apiKey) {
			this.headers['Authorization'] = `Bearer ${apiKey}`;
		}
	}

	async chat(systemPrompt: string, userMessage: string): Promise<string> {
		const response = await fetch(`${this.host}/api/chat`, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
				stream: false,
			}),
		});

		if (!response.ok) {
			throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return data.message.content;
	}

	getModel(): string {
		return this.model;
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract JSON from LLM response.
 * Mirrors Python/Go extractJSON() function.
 * Handles markdown code blocks and mixed content.
 */
function extractJson(text: string): string | null {
	// Try to extract from markdown code block
	const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return codeBlockMatch[1].trim();
	}

	// Find first { to last }
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start !== -1 && end !== -1 && end > start) {
		return text.slice(start, end + 1);
	}

	return null;
}

/**
 * Parse JSON string into FinancialAnalysis object.
 */
function parseAnalysis(jsonStr: string): FinancialAnalysis {
	const data = JSON.parse(jsonStr);
	return {
		type: data.type ?? 'unknown',
		category: data.category,
		risk_level: data.risk_level,
		recommendation: data.recommendation,
		considerations: data.considerations,
		reason: data.reason,
	};
}

/**
 * Return capabilities description.
 */
function formatCapabilities(): string {
	return `I'm a Financial Advisor assistant. I can help with:

* Investment Strategies - Portfolio allocation, diversification, risk management
* Budgeting - Expense tracking, income management, spending plans
* Retirement Planning - 401(k), IRA, pension strategies
* Tax Optimization - Tax-advantaged accounts, deduction strategies
* Debt Management - Payoff strategies, refinancing options
* Savings Goals - Emergency funds, high-yield accounts

Note: I provide educational information, not personalized financial advice.
Always consult a licensed financial advisor for major financial decisions.`;
}

/**
 * Format analysis response for user.
 */
function formatAnalysis(analysis: FinancialAnalysis): string {
	const parts: string[] = [];

	if (analysis.category) {
		const category = analysis.category.charAt(0).toUpperCase() + analysis.category.slice(1);
		parts.push(`Category: ${category}`);
	}

	if (analysis.risk_level) {
		const riskLevel = analysis.risk_level.charAt(0).toUpperCase() + analysis.risk_level.slice(1);
		parts.push(`Risk Level: ${riskLevel}`);
	}

	if (analysis.recommendation) {
		parts.push(`\n${analysis.recommendation}`);
	}

	if (analysis.considerations && analysis.considerations.length > 0) {
		parts.push('\nConsiderations:');
		for (const item of analysis.considerations) {
			parts.push(`  * ${item}`);
		}
	}

	parts.push('\n\nNote: This is educational information, not personalized financial advice.');

	return parts.join('\n');
}

// =============================================================================
// Message Handler (mirrors Python/Go handleMessage pattern)
// =============================================================================

async function handleMessage(ollama: OllamaClient, message: TextMessage): Promise<string> {
	// Use message ID as correlation ID for tracing request/response pairs
	const corrId = message.id?.slice(0, 8) ?? 'no-id';
	const preview = message.prompt.slice(0, 80);
	console.log(`[${corrId}] >>> RECV from=${message.sender} prompt="${preview}"`);

	// Call LLM with system prompt
	let rawResponse: string;
	try {
		console.log(`[${corrId}] ... calling LLM`);
		rawResponse = await ollama.chat(SYSTEM_PROMPT, message.prompt);
		console.log(`[${corrId}] <<< LLM response_len=${rawResponse.length}`);
	} catch (err) {
		console.error(`[${corrId}] !!! LLM CALL FAILED error=${err}`);
		return "I'm sorry, I encountered an error processing your request.";
	}

	// Extract and parse JSON
	const jsonStr = extractJson(rawResponse);
	if (!jsonStr) {
		console.warn(`[${corrId}] !!! JSON EXTRACTION FAILED`);
		return rawResponse; // Fallback to raw content
	}

	let analysis: FinancialAnalysis;
	try {
		analysis = parseAnalysis(jsonStr);
		console.log(`[${corrId}] === type=${analysis.type} category=${analysis.category ?? 'n/a'}`);
	} catch (err) {
		console.warn(`[${corrId}] !!! JSON PARSE FAILED error=${err}`);
		return rawResponse;
	}

	// Route based on response type
	if (analysis.type === 'capabilities') {
		return formatCapabilities();
	} else if (analysis.type === 'decline') {
		return analysis.reason ?? 'I can only help with financial questions.';
	} else if (analysis.type === 'analysis') {
		return formatAnalysis(analysis);
	} else {
		return rawResponse;
	}
}

// =============================================================================
// Main Entry Point (mirrors Python/Go agent structure)
// =============================================================================

async function main(): Promise<void> {
	// 1. Load environment variables
	const agentName = process.env.AGENT_NAME ?? 'financial-advisor-ts';
	const platformAddress = process.env.PLATFORM_ADDRESS ?? 'localhost:4000';
	const apiKey = process.env.AGENT_KEY ?? 'testkey';

	// 2. Initialize Ollama client
	const ollama = new OllamaClient(
		process.env.OLLAMA_HOST ?? 'http://localhost:11434',
		process.env.OLLAMA_MODEL ?? 'gpt-oss:120b',
		process.env.OLLAMA_API_KEY,
	);
	console.log(`Ollama client initialized model=${ollama.getModel()}`);

	// 3. Initialize LLP client
	const client = new LLPClient(agentName, apiKey, {
		url: `${platformAddress}/agent/websocket`,
	});

	client.onMessage(async (msg: TextMessage) => {
		const corrId = msg.id?.slice(0, 8) ?? 'no-id';
		console.log(`[${corrId}] --- REQUEST START ---`);
		const response = await handleMessage(ollama, msg);
		console.log(`[${corrId}] <<< SEND to=${msg.sender} len=${response.length}`);
		console.log(`[${corrId}] --- REQUEST END ---`);
		return msg.reply(response);
	});

	// 5. Setup graceful shutdown
	const shutdown = async () => {
		console.log('\nShutting down...');
		await client.close();
		console.log('Disconnected');
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// 6. Connect and run
	try {
		await client.connect();
		console.log(`Connected to platform address=${platformAddress}/agent/websocket`);

		// Wait forever
		await new Promise(() => {});
	} catch (err) {
		console.error('Fatal error:', err);
		process.exit(1);
	}
}

main();
