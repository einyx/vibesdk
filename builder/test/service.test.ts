import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { start, type BuilderHandle } from '../src/index.ts';
import { migrate } from '../src/migrate.ts';
import { openDatabase } from '../src/storage/d1.ts';

// The Workers modules, for the SDKs that are loaded outside the bundler.
// The application itself is resolved by the test's aliases.
register('../hooks.mjs', import.meta.url);

const jwtSecret = 'A-local-secret-for-the-builder-tests-9f2c';

let directory: string;
let service: BuilderHandle;

const url = (pathname: string): string => `http://127.0.0.1:${service.port}${pathname}`;

const mintToken = async (userId: string, email: string, sessionId: string): Promise<string> =>
	new SignJWT({ sub: userId, email, sessionId, type: 'access' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(new TextEncoder().encode(jwtSecret));

beforeAll(async () => {
	directory = mkdtempSync(path.join(tmpdir(), 'vibesdk-builder-service-'));

	const databasePath = path.join(directory, 'builder.sqlite');
	migrate({
		databasePath,
		migrationsDir: path.resolve(import.meta.dirname, '../../migrations'),
	});

	// A user and a session: the authenticated path reads both.
	const database = openDatabase(databasePath).raw();
	database
		.prepare(
			`INSERT INTO users (id, email, username, display_name, provider, provider_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'user-one',
			'builder@example.com',
			'builder',
			'Builder',
			'logto',
			'logto-user-one',
			Date.now(),
			Date.now(),
		);
	database
		.prepare(
			`INSERT INTO sessions (id, user_id, access_token_hash, refresh_token_hash, expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'session-one',
			'user-one',
			'hash',
			'hash',
			Date.now() + 3_600_000,
			Date.now(),
		);
	database.close();

	process.env.DATABASE_PATH = databasePath;
	process.env.DATA_DIR = path.join(directory, 'data');
	process.env.PORT = '0';
	process.env.HOST = '127.0.0.1';
	process.env.JWT_SECRET = jwtSecret;
	process.env.LOGTO_ISSUER = 'https://prysm.sh/oidc';
	process.env.LOGTO_CLIENT_ID = 'builder-local';
	process.env.LOGTO_CLIENT_SECRET = 'builder-local-secret';
	process.env.CUSTOM_DOMAIN = 'localhost';

	service = await start();
});

afterAll(async () => {
	await service?.close();
	rmSync(directory, { recursive: true, force: true });
});

describe('the builder, on the host', () => {
	it('answers the health check', async () => {
		const response = await fetch(url('/api/health'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('lists the sign-in providers it has', async () => {
		const response = await fetch(url('/api/auth/providers'));
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { providers: { logto: boolean } } };
		expect(body.data.providers.logto).toBe(true);
	});

	it('refuses a request without a session', async () => {
		const response = await fetch(url('/api/apps'));
		expect(response.status).toBe(401);
	});

	it('answers an authenticated request from its own database', async () => {
		const token = await mintToken('user-one', 'builder@example.com', 'session-one');
		const response = await fetch(url('/api/apps'), {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { success: boolean };
		expect(body.success).toBe(true);
	});
});
