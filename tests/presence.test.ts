import { describe, expect, it } from 'vitest';
import { ConnectionStatus, PresenceStatus } from '../src/presence.js';

describe('ConnectionStatus', () => {
	it('should have all required statuses', () => {
		expect(ConnectionStatus.Disconnected).toBe('disconnected');
		expect(ConnectionStatus.Connecting).toBe('connecting');
		expect(ConnectionStatus.Connected).toBe('connected');
		expect(ConnectionStatus.Authenticated).toBe('authenticated');
		expect(ConnectionStatus.Closed).toBe('closed');
	});

	it('should be type-safe', () => {
		const status: ConnectionStatus = ConnectionStatus.Connected;
		expect(status).toBe('connected');
	});
});

describe('PresenceStatus', () => {
	it('should have all required statuses', () => {
		expect(PresenceStatus.Available).toBe('available');
		expect(PresenceStatus.Unavailable).toBe('unavailable');
	});

	it('should be type-safe', () => {
		const status: PresenceStatus = PresenceStatus.Available;
		expect(status).toBe('available');
	});
});
