// Configuration, from the environment. The daemon runs one process that
// serves both the Runner API and the per-instance preview proxy.
//
// PORT          API + proxy listen port (default 8080)
// API_KEY       required bearer token for the Runner API
// DATA_DIR      where instance workdirs live (a PVC in k3s)
// PREVIEW_DOMAIN  wildcard domain for previews: <instanceId>.<domain>
// DEV_PORT_BASE first port allocated to instance dev servers (4173+)
// MAX_INSTANCES most concurrent instances (and ports) allowed

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        console.error(`[config] missing required env ${name}`);
        process.exit(1);
    }
    return value.trim();
}

function intEnv(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
    port: intEnv('PORT', 8080),
    apiKey: requireEnv('API_KEY'),
    dataDir: requireEnv('DATA_DIR'),
    /** The runner's own host — the preview URLs are built from it. */
    apiHost: requireEnv('RUNNER_HOST').toLowerCase(),
    /**
     * Previews are addressed by path (`/p/<instance>/…`) under the runner's
     * own host, so one hostname and one certificate cover every instance.
     * The host-based form (`<id>.<PREVIEW_DOMAIN>`) still works when a
     * wildcard certificate and DNS are available.
     */
    previewPathPrefix: '/p',
    previewDomain: (process.env.PREVIEW_DOMAIN ?? '').toLowerCase(),
    devPortBase: intEnv('DEV_PORT_BASE', 4173),
    maxInstances: intEnv('MAX_INSTANCES', 10),
    /** How long a preview nobody asks for any more lives, milliseconds. */
    idleTtlMs: intEnv('IDLE_TTL_MS', 30 * 60 * 1000),
    /** How often the idle instances are swept, milliseconds. */
    sweepIntervalMs: intEnv('SWEEP_INTERVAL_MS', 60_000),
    /** Body size cap for API requests (templates ship as one JSON body). */
    maxBodyBytes: intEnv('MAX_BODY_BYTES', 64 * 1024 * 1024),
    /** Default per-command timeout, seconds. */
    commandTimeoutSeconds: intEnv('COMMAND_TIMEOUT_SECONDS', 120),
    /** Ring-buffer cap per stream, bytes. */
    logCapBytes: intEnv('LOG_CAP_BYTES', 256 * 1024),
};
