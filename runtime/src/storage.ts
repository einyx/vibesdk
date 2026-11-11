// A Durable Object's storage, on Node.
//
// The SDK expects two things from a session's storage: SQLite
// (`ctx.storage.sql.exec`) and a small key-value store
// (`ctx.storage.get/put/delete/list`). Alarms are on the same store.
//
// Both live in one SQLite file per session, on a volume.

import { DatabaseSync } from 'node:sqlite';

export class SqliteStorage {
	readonly sql: { exec(query: string, ...values: unknown[]): Record<string, unknown>[] };
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		this.sql = {
			exec: (query: string, ...values: unknown[]): Record<string, unknown>[] =>
				this.exec(query, ...values),
		};
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS cf_kv (
				key TEXT PRIMARY KEY NOT NULL,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS cf_alarms (
				key TEXT PRIMARY KEY NOT NULL,
				scheduled INTEGER NOT NULL
			);
		`);
	}

	/** Run a statement and return its rows. */
	exec(query: string, ...values: unknown[]): Record<string, unknown>[] {
		const statement = this.db.prepare(query);
		const rows = statement.all(...(values as never[])) as Record<string, unknown>[];
		// Cloudflare's cursor has a toArray(); the SDK uses it.
		return Object.assign(rows, { toArray: () => rows });
	}

	/** Run a statement that returns nothing. */
	run(query: string, ...values: unknown[]): void {
		this.db.prepare(query).run(...(values as never[]));
	}

	async get<T>(key: string): Promise<T | undefined> {
		const rows = this.exec('SELECT value FROM cf_kv WHERE key = ?', key);
		const raw = rows[0]?.value;
		if (typeof raw !== 'string') return undefined;
		return JSON.parse(raw) as T;
	}

	async put<T>(key: string, value: T): Promise<void> {
		this.run(
			'INSERT INTO cf_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
			key,
			JSON.stringify(value ?? null),
		);
	}

	async delete(key: string): Promise<boolean> {
		const before = this.exec('SELECT key FROM cf_kv WHERE key = ?', key);
		this.run('DELETE FROM cf_kv WHERE key = ?', key);
		return before.length > 0;
	}

	async deleteAll(): Promise<void> {
		this.run('DELETE FROM cf_kv');
	}

	async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
		const prefix = options?.prefix ?? '';
		const rows = this.exec(
			'SELECT key, value FROM cf_kv WHERE key LIKE ? ORDER BY key',
			`${prefix}%`,
		);
		const limit = options?.limit ?? rows.length;
		const result = new Map<string, T>();
		for (const row of rows.slice(0, limit)) {
			result.set(String(row.key), JSON.parse(String(row.value)) as T);
		}
		return result;
	}

	async setAlarm(scheduledTime: number): Promise<void> {
		this.run(
			'INSERT INTO cf_alarms (key, scheduled) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET scheduled = excluded.scheduled',
			'alarm',
			scheduledTime,
		);
	}

	async getAlarm(): Promise<number | null> {
		const rows = this.exec('SELECT scheduled FROM cf_alarms WHERE key = ?', 'alarm');
		const scheduled = rows[0]?.scheduled;
		return typeof scheduled === 'number' ? scheduled : null;
	}

	async deleteAlarm(): Promise<void> {
		this.run('DELETE FROM cf_alarms WHERE key = ?', 'alarm');
	}
}
