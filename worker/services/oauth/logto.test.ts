import { describe, it, expect, vi, afterEach } from 'vitest';
import { LogtoOAuthProvider } from './logto';

const ISSUER = 'https://prysm.sh/oidc';

function createProvider(issuer = ISSUER) {
	return new LogtoOAuthProvider(
		'client-id',
		'client-secret',
		'https://app.local/api/auth/callback/logto',
		issuer,
	);
}

describe('LogtoOAuthProvider.getAuthorizationUrl', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("speaks the issuer's endpoints", async () => {
		const url = new URL(await createProvider().getAuthorizationUrl('state-1'));

		expect(url.origin).toBe('https://prysm.sh');
		expect(url.pathname).toBe('/oidc/auth');
	});

	it('names offline_access, so the base class can refresh', async () => {
		const url = new URL(await createProvider().getAuthorizationUrl('state-1'));

		expect(url.searchParams.get('scope')).toContain('offline_access');
		expect(url.searchParams.get('client_id')).toBe('client-id');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://app.local/api/auth/callback/logto',
		);
	});

	it('asks for no consent screen', async () => {
		const url = new URL(await createProvider().getAuthorizationUrl('state-1'));

		// prompt=consent is Google's forcing function; on Logto it is a
		// pointless click between a signed-in user and the platform.
		expect(url.searchParams.get('prompt')).toBeNull();
		expect(url.searchParams.get('access_type')).toBeNull();
	});

	it('carries the PKCE challenge when given a verifier', async () => {
		const url = new URL(
			await createProvider().getAuthorizationUrl(
				'state-1',
				'test-verifier-test-verifier-test-verifier-test-verifier',
			),
		);

		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toBeTruthy();
	});
});

describe('LogtoOAuthProvider.getUserInfo', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reads the OIDC identity endpoint and maps the standard claims', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : input.toString();
				expect(url).toBe(`${ISSUER}/me`);
				return new Response(
					JSON.stringify({
						sub: 'user-1',
						email: 'user@prysm.sh',
						name: 'Test User',
						picture: 'https://prysm.sh/avatar.png',
						email_verified: true,
					}),
					{ status: 200 },
				);
			}),
		);

		const info = await createProvider().getUserInfo('token');

		expect(info.id).toBe('user-1');
		expect(info.email).toBe('user@prysm.sh');
		expect(info.name).toBe('Test User');
		expect(info.emailVerified).toBe(true);
	});

	it('throws when the identity endpoint fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('unauthorized', { status: 401 })),
		);

		await expect(createProvider().getUserInfo('token')).rejects.toThrow(
			/Failed to get user info/,
		);
	});
});

describe('LogtoOAuthProvider.create', () => {
	it('derives the endpoints from the configured issuer', () => {
		const env = {
			LOGTO_CLIENT_ID: 'client-id',
			LOGTO_CLIENT_SECRET: 'client-secret',
			LOGTO_ISSUER: ISSUER,
		} as unknown as Env;
		const provider = LogtoOAuthProvider.create(env, 'https://app.local');

		expect(provider['tokenUrl']).toBe(`${ISSUER}/token`);
		expect(provider['userInfoUrl']).toBe(`${ISSUER}/me`);
	});
});
