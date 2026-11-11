// The Durable Object surface, as the SDK expects it.
//
// These are the shapes the `agents` SDK and `partyserver` reach for. The
// Node platform implements them; the types live here so both sides can
// speak about them without importing each other.
//
// The shapes avoid `readonly` in type positions: Node's type stripping
// erases types, and it does not erase a `readonly` in front of a method
// signature.

export interface SessionId {
	name: string;
	toString(): string;
}

export interface DurableObjectContext {
	readonly id: SessionId;
	readonly storage: DurableObjectStorage;
	waitUntil(promise: Promise<unknown>): void;
	acceptWebSocket(socket: unknown, tags?: string[]): void;
	getWebSockets(tag?: string): unknown[];
	blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
	abort(reason?: string): void;
	readonly exports: Record<string, unknown>;
	readonly facets: { get<T>(name: string, init: () => T): Promise<T> };
}

export interface DurableObjectStorage {
	sql: { exec(query: string, ...values: unknown[]): Record<string, unknown>[] };
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	deleteAll(): Promise<void>;
	list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
	setAlarm(scheduledTime: number): Promise<void>;
	getAlarm(): Promise<number | null>;
	deleteAlarm(): Promise<void>;
}
