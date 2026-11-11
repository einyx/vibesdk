// The configuration of the host service.
//
// The Worker's configuration is a set of bindings and vars in the dashboard.
// Here it is the environment: the same names, the same meaning, read once at
// boot and checked before the service serves anything.
//
// The names are the Worker's own, so the port is mechanical — a variable
// that moves from a dashboard to an environment file keeps its name.

export interface BuilderConfig {
	/** Where the service listens. */
	host: string;
	port: number;
	/** The public origin: the name the OIDC application is registered under. */
	customDomain: string;
	environment: string;

	jwtSecret: string;

	logtoIssuer: string;
	logtoClientId: string;
	logtoClientSecret: string;

	/** The builder's own SQLite file: the app, the chats, the sessions. */
	databasePath: string;
	/** One directory per app. */
	dataDir: string;
	/** The sessions' own SQLite files. */
	sessionsDir: string;
	/** The built single-page application. */
	assetsDir: string;

	/** The runner: previews. */
	sandboxServiceType: string;
	sandboxServiceUrl: string;
	sandboxServiceApiKey: string;
	/** The publisher: deployed apps. */
	publishServiceUrl: string;
	publishServiceApiKey: string;

	/** Direct model providers. There is no gateway on the host. */
	glmApiKey: string;
	platformModelProviders: string;

	/** Chromium, for the browser console. */
	sidecarUrl: string;

	templatesRepository: string;
	maxSandboxInstances: number;
}

const number = (value: string | undefined, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const text = (value: string | undefined, fallback = ''): string =>
	value === undefined || value === '' ? fallback : value;

/** Read the configuration from the environment. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): BuilderConfig {
	const dataDir = text(env.DATA_DIR, '/data');

	return {
		host: text(env.HOST, '0.0.0.0'),
		port: number(env.PORT, 8080),
		customDomain: text(env.CUSTOM_DOMAIN, 'localhost'),
		environment: text(env.ENVIRONMENT, 'development'),

		jwtSecret: text(env.JWT_SECRET),

		logtoIssuer: text(env.LOGTO_ISSUER),
		logtoClientId: text(env.LOGTO_CLIENT_ID),
		logtoClientSecret: text(env.LOGTO_CLIENT_SECRET),

		databasePath: text(env.DATABASE_PATH, `${dataDir}/builder.sqlite`),
		dataDir,
		sessionsDir: text(env.SESSIONS_DIR, `${dataDir}/sessions`),
		assetsDir: text(env.ASSETS_DIR, 'dist/client'),

		sandboxServiceType: text(env.SANDBOX_SERVICE_TYPE, 'runner'),
		sandboxServiceUrl: text(env.SANDBOX_SERVICE_URL),
		sandboxServiceApiKey: text(env.SANDBOX_SERVICE_API_KEY),
		publishServiceUrl: text(env.PUBLISH_SERVICE_URL),
		publishServiceApiKey: text(env.PUBLISH_SERVICE_API_KEY),

		glmApiKey: text(env.GLM_API_KEY) || text(env.ZHIPU_API_KEY),
		platformModelProviders: text(env.PLATFORM_MODEL_PROVIDERS),

		sidecarUrl: text(env.DEV_BROWSER_SIDECAR_URL),

		templatesRepository: text(
			env.TEMPLATES_REPOSITORY,
			'https://github.com/cloudflare/vibesdk-templates',
		),
		maxSandboxInstances: number(env.MAX_SANDBOX_INSTANCES, 10),
	};
}

/**
 * What the service cannot do without.
 *
 * The list is the honest one: without these the service starts and answers,
 * but the path that needs them fails where it is used.
 */
export function missingRequirements(config: BuilderConfig): string[] {
	const missing: string[] = [];

	if (!config.jwtSecret) missing.push('JWT_SECRET — the service signs its own tokens');
	if (!config.logtoIssuer) missing.push('LOGTO_ISSUER — the sign-in flow has no issuer');
	if (!config.logtoClientId || !config.logtoClientSecret) {
		missing.push('LOGTO_CLIENT_ID and LOGTO_CLIENT_SECRET — no application to sign in with');
	}
	if (!config.sandboxServiceUrl) missing.push('SANDBOX_SERVICE_URL — the previews have no runner');
	if (!config.sandboxServiceApiKey) missing.push('SANDBOX_SERVICE_API_KEY — the runner is not authenticated');
	if (!config.publishServiceUrl) missing.push('PUBLISH_SERVICE_URL — the deploys have no publisher');
	if (!config.publishServiceApiKey) missing.push('PUBLISH_SERVICE_API_KEY — the publisher is not authenticated');
	if (!config.glmApiKey) missing.push('GLM_API_KEY — the models have no key');

	return missing;
}
