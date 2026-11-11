// A Durable Object's context, on Node.
//
// The context is what the SDK reaches for: the session's name, its storage,
// its sockets, and the few lifecycle calls that Cloudflare's runtime
// provides.

import type { DurableObjectContext, DurableObjectStorage, SessionId } from './types.ts';
import type { SqliteStorage } from './storage.ts';

export interface SocketRecord {
	socket: unknown;
	tags: string[];
}

export class NodeContext implements DurableObjectContext {
	readonly id: SessionId;
	readonly storage: DurableObjectStorage;
	readonly exports: Record<string, unknown>;
	readonly facets: { get<T>(name: string, init: () => T): Promise<T> };

	private readonly sockets = new Map<unknown, SocketRecord>();
	private readonly pending: Promise<unknown>[] = [];
	private readonly initializing: Promise<unknown>[] = [];
	private readonly onAbort: (reason?: string) => void;
	private abortReason: string | undefined;

	constructor(
		sessionName: string,
		sessionStorage: SqliteStorage,
		onAbort: (reason?: string) => void,
	) {
		this.onAbort = onAbort;
		this.id = {
			name: sessionName,
			toString: () => sessionName,
		};
		this.storage = sessionStorage;
		this.exports = {};
		this.facets = {
			get: async <T>(_name: string, init: () => T): Promise<T> => init(),
		};
	}

	waitUntil(promise: Promise<unknown>): void {
		this.pending.push(promise);
		// A rejected background promise must not take the process down.
		void promise.catch(() => undefined);
	}

	acceptWebSocket(socket: unknown, tags: string[] = []): void {
		this.sockets.set(socket, { socket, tags });
	}

	getWebSockets(tag?: string): unknown[] {
		const records = [...this.sockets.values()];
		if (tag === undefined) return records.map((record) => record.socket);
		return records.filter((record) => record.tags.includes(tag)).map((record) => record.socket);
	}

	/** The sockets this session holds, with their tags. */
	records(): SocketRecord[] {
		return [...this.sockets.values()];
	}

	/** Forget a socket: it closed. */
	forget(socket: unknown): void {
		this.sockets.delete(socket);
	}

	blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
		const promise = fn();
		this.initializing.push(promise);
		return promise;
	}

	abort(reason?: string): void {
		this.abortReason = reason;
		this.onAbort(reason);
	}

	/** The reason the session was aborted, if it was. */
	reason(): string | undefined {
		return this.abortReason;
	}

	/** Wait for the background work the session started. */
	settled(): Promise<void> {
		return Promise.all([...this.initializing, ...this.pending]).then(() => undefined);
	}
}
