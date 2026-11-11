// The migrations, applied to the host's database.
//
// The migrations are the same files the Worker applies: plain SQL, split on
// the statement marker, applied in order and recorded by name. Nothing here
// knows about D1; it only knows about SQLite and a table of what has been
// applied.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { openDatabase } from './storage/d1.ts';

export interface MigrateOptions {
	databasePath: string;
	migrationsDir: string;
}

interface AppliedMigration {
	name: string;
}

const splitStatements = (sql: string): string[] =>
	sql
		.split('--> statement-breakpoint')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);

/** The migrations that have not been applied yet, in order. */
export function pendingMigrations(options: MigrateOptions): string[] {
	const applied = new Set(
		(
			openDatabase(options.databasePath)
				.raw()
				.prepare('SELECT name FROM d1_migrations')
				.all() as unknown as AppliedMigration[]
		).map((row) => row.name),
	);

	return readdirSync(options.migrationsDir)
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.filter((file) => !applied.has(file));
}

/** Apply the migrations that have not been applied yet. */
export function migrate(options: MigrateOptions): string[] {
	const database = openDatabase(options.databasePath);
	const handle = database.raw();

	handle.exec(`
		CREATE TABLE IF NOT EXISTS d1_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			created_at INTEGER NOT NULL
		);
	`);

	const applied = new Set(
		(
			handle.prepare('SELECT name FROM d1_migrations').all() as unknown as AppliedMigration[]
		).map((row) => row.name),
	);

	const files = readdirSync(options.migrationsDir)
		.filter((file) => file.endsWith('.sql'))
		.sort();

	const done: string[] = [];
	for (const file of files) {
		if (applied.has(file)) continue;

		const sql = readFileSync(path.join(options.migrationsDir, file), 'utf8');
		handle.exec('BEGIN');
		try {
			for (const statement of splitStatements(sql)) {
				handle.exec(statement);
			}
			handle
				.prepare('INSERT INTO d1_migrations (name, created_at) VALUES (?, ?)')
				.run(file, Date.now());
			handle.exec('COMMIT');
		} catch (error) {
			handle.exec('ROLLBACK');
			throw error;
		}
		done.push(file);
	}

	handle.close();
	return done;
}

if (import.meta.main) {
	const applied = migrate({
		databasePath: process.env.DATABASE_PATH ?? '/data/builder.sqlite',
		migrationsDir: process.env.MIGRATIONS_DIR ?? 'migrations',
	});
	console.log(`[builder] applied ${applied.length} migration(s)`);
	for (const file of applied) console.log(`  - ${file}`);
}
