export const ConnectionStatus = {
	Disconnected: 'disconnected',
	Connecting: 'connecting',
	Connected: 'connected',
	Authenticated: 'authenticated',
	Closed: 'closed',
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export const PresenceStatus = {
	Available: 'available',
	Unavailable: 'unavailable',
} as const;

export type PresenceStatus = (typeof PresenceStatus)[keyof typeof PresenceStatus];
