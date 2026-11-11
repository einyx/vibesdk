// The D1 database, on Node.
//
// D1 is SQLite behind an HTTP-shaped API: prepare a statement, bind values,
// run it. Drizzle's D1 driver speaks exactly that API, so the adapter
// implements it over Node's own SQLite and the queries do not change.
//
// What is faithful: prepare/bind/all/run/raw, batch, exec.
// What is not: there are no replicas, so `withSession` returns the same
// database. The read-replica path is a Cloudflare feature and the host has
// no replicas to read from.

import { DatabaseSync } from 'node:sqlite';

export type BindValue = string | number | null | ArrayBuffer | Uint8Array;

export interface D1Meta {
	duration: number;
	rows_read: number;
	rows_written: number;
	last_row_id: number;
	changed_db: boolean;
}

export interface D1Result<T = Record<string, unknown>> {
	success: boolean;
	meta: D1Meta;
	results: T[];
}

const emptyMeta = (): D1Meta => ({
	duration: 0,
	rows_read: 0,
	rows_written: 0,
	last_row_id: 0,
	changed_db: false,
});

/** A statement, and the values bound to it. */
export class D1Statement {
	constructor(
		private readonly database: DatabaseSync,
		private readonly sql: string,
		private readonly values: BindValue[] = [],
	) {}

	/** The same statement with values bound. */
	bind(...values: BindValue[]): D1Statement {
		return new D1Statement(this.database, this.sql, values);
	}

	/** Every row. */
	async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
		const started = performance.now();
		const rows = this.database
			.prepare(this.sql)
			.all(...(this.values as never[])) as Record<string, unknown>[];
		const results = rows.map((row) => ({ ...row })) as T[];
		return {
			success: true,
			meta: { ...emptyMeta(), duration: performance.now() - started, rows_read: rows.length },
			results,
		};
	}

	/** The first row, or null. */
	async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
		const { results } = await this.all<T>();
		const first = results[0];
		if (!first) return null;
		if (column === undefined) return first;
		return (first as Record<string, unknown>)[column] as T;
	}

	/** The rows as arrays, in column order. */
	async raw(): Promise<unknown[][]> {
		const statement = this.database.prepare(this.sql);
		const columns = statement.columns().map((column) => column.name);
		const rows = statement.all(...(this.values as never[])) as Record<string, unknown>[];
		return rows.map((row) => columns.map((column) => row[column]));
	}

	/** A statement that returns nothing. */
	async run(): Promise<D1Result> {
		const started = performance.now();
		const result = this.database
			.prepare(this.sql)
			.run(...(this.values as never[]));
		return {
			success: true,
			meta: {
				...emptyMeta(),
				duration: performance.now() - started,
				rows_written: Number(result.changes ?? 0),
				last_row_id: Number(result.lastInsertRowid ?? 0),
				changed_db: Number(result.changes ?? 0) > 0,
			},
			results: [],
		};
	}
}

/** A statement that was prepared but not bound to anything yet. */
export class D1Database {
	constructor(private readonly database: DatabaseSync) {}

	prepare(sql: string): D1Statement {
		return new D1Statement(this.database, sql);
	}

	/** Run the statements in order. */
	async batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]> {
		const results: D1Result<T>[] = [];
		for (const statement of statements) {
			results.push((await statement.all<T>()) as D1Result<T>);
		}
		return results;
	}

	/** Run a script. */
	async exec(sql: string): Promise<{ count: number; duration: number }> {
		const started = performance.now();
		this.database.exec(sql);
		return { count: 1, duration: performance.now() - started };
	}

	/** There are no replicas on the host, so a session is this database. */
	withSession(): D1Database {
		return this;
	}

	/** The underlying SQLite handle, for the tools that need it. */
	raw(): DatabaseSync {
		return this.database;
	}
}

/** Open the builder's database. */
export function openDatabase(path: string): D1Database {
	return new D1Database(new DatabaseSync(path));
}
