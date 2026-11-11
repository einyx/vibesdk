// The key-value store, on Node.
//
// Workers KV is a namespace of key-value pairs with a list by prefix. The
// application uses it for the sandbox configuration and a handful of small
// records, so the host keeps the same shape over one table in the
// builder's own SQLite file.
//
// The expiry is not implemented: KV's TTL is a Cloudflare feature, and the
// records the application writes are read back within the same request.

import type { DatabaseSync } from 'node:sqlite';

export interface KvStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
	delete(key: string): Promise<boolean>;
	list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

export class SqliteKvStore implements KvStore {
	constructor(private readonly database: DatabaseSync) {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS builder_kv (
				key TEXT PRIMARY KEY NOT NULL,
				value TEXT NOT NULL
			);
		`);
	}

	async get(key: string): Promise<string | null> {
		const rows = this.database
			.prepare('SELECT value FROM builder_kv WHERE key = ?')
			.all(key) as { value: string }[];
		return rows[0]?.value ?? null;
	}

	async put(key: string, value: string): Promise<void> {
		this.database
			.prepare(
				'INSERT INTO builder_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
			)
			.run(key, value);
	}

	async delete(key: string): Promise<boolean> {
		const before = this.database
			.prepare('SELECT key FROM builder_kv WHERE key = ?')
			.all(key);
		this.database.prepare('DELETE FROM builder_kv WHERE key = ?').run(key);
		return before.length > 0;
	}

	async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }> {
		const prefix = options?.prefix ?? '';
		const rows = this.database
			.prepare('SELECT key FROM builder_kv WHERE key LIKE ? ORDER BY key')
			.all(`${prefix}%`) as { key: string }[];
		const limited = options?.limit === undefined ? rows : rows.slice(0, options.limit);
		return { keys: limited.map((row) => ({ name: row.key })) };
	}
}
