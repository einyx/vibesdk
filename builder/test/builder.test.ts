import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

import { Assets } from '../src/storage/assets.ts';
import { openDatabase } from '../src/storage/d1.ts';
import { SqliteKvStore } from '../src/storage/kv.ts';
import { migrate } from '../src/migrate.ts';

const notes = sqliteTable('notes', {
	id: text('id').primaryKey(),
	body: text('body').notNull(),
	count: integer('count').notNull().default(0),
});

describe('the D1 adapter', () => {
	let directory: string;
	let database: ReturnType<typeof openDatabase>;

	beforeAll(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'vibesdk-builder-d1-'));
		database = openDatabase(path.join(directory, 'builder.sqlite'));
		database.raw().exec(`
			CREATE TABLE notes (
				id text PRIMARY KEY NOT NULL,
				body text NOT NULL,
				count integer NOT NULL DEFAULT 0
			);
		`);
	});

	afterAll(() => {
		database.raw().close();
		rmSync(directory, { recursive: true, force: true });
	});

	it('speaks the API drizzle\'s D1 driver speaks', async () => {
		const db = drizzle(database as never, { schema: { notes } });

		await db.insert(notes).values({ id: 'one', body: 'first' });
		await db.insert(notes).values({ id: 'two', body: 'second', count: 2 });

		const rows = await db.select().from(notes).where(eq(notes.id, 'two'));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.body).toBe('second');
		expect(rows[0]?.count).toBe(2);
	});

	it('binds values in order', async () => {
		const all = await database.prepare('SELECT id FROM notes ORDER BY id').all();
		expect(all.results.map((row) => (row as { id: string }).id)).toEqual(['one', 'two']);

		const bound = await database
			.prepare('SELECT id FROM notes WHERE id = ?')
			.bind('two')
			.all();
		expect(bound.results.map((row) => (row as { id: string }).id)).toEqual(['two']);
	});

	it('reports the rows it wrote', async () => {
		const result = await database
			.prepare('UPDATE notes SET count = count + 1 WHERE id = ?')
			.bind('one')
			.run();
		expect(result.success).toBe(true);
		expect(result.meta.rows_written).toBe(1);
	});
});

describe('the key-value store', () => {
	let directory: string;
	let store: SqliteKvStore;

	beforeAll(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'vibesdk-builder-kv-'));
		store = new SqliteKvStore(openDatabase(path.join(directory, 'builder.sqlite')).raw());
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it('writes, reads and deletes', async () => {
		expect(await store.get('missing')).toBeNull();

		await store.put('config:one', '{"value":1}');
		expect(await store.get('config:one')).toBe('{"value":1}');

		const listed = await store.list({ prefix: 'config:' });
		expect(listed.keys.map((key) => key.name)).toEqual(['config:one']);

		expect(await store.delete('config:one')).toBe(true);
		expect(await store.delete('config:one')).toBe(false);
	});
});

describe('the assets', () => {
	let directory: string;

	beforeAll(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'vibesdk-builder-assets-'));
		mkdirSync(path.join(directory, 'assets'), { recursive: true });
		writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>builder</title>');
		writeFileSync(path.join(directory, 'assets', 'app.js'), 'export const app = 1;');
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it('serves the file a request names', async () => {
		const assets = new Assets(directory);
		const response = await assets.fetch(new Request('https://apps.prysm.sh/assets/app.js'));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/javascript');
		expect(await response.text()).toContain('export const app');
	});

	it('falls back to the index for the application\'s own routes', async () => {
		const assets = new Assets(directory);
		const response = await assets.fetch(new Request('https://apps.prysm.sh/apps/one'));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('builder');
	});
});

describe('the migrations', () => {
	let directory: string;

	beforeAll(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'vibesdk-builder-migrate-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it('applies the migrations once, and records them', () => {
		const databasePath = path.join(directory, 'builder.sqlite');
		const migrationsDir = path.resolve(import.meta.dirname, '../../migrations');

		const applied = migrate({ databasePath, migrationsDir });
		expect(applied.length).toBeGreaterThan(0);

		// Running them again does nothing: they are recorded by name.
		expect(migrate({ databasePath, migrationsDir })).toHaveLength(0);

		const tables = openDatabase(databasePath)
			.raw()
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { name: string }[];
		const names = tables.map((table) => table.name);
		expect(names).toContain('users');
		expect(names).toContain('d1_migrations');
	});
});
