// The Runner service: one process, two faces.
//
//   runner.<domain>           the Runner API the vibesdk worker talks to
//   <instanceId>.preview.<domain>   proxied to that instance's dev server
//
// The API shape is the contract `RemoteSandboxServiceClient` speaks and
// `sandboxTypes.ts` validates — endpoint for endpoint, field for field.
import * as http from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { config } from './config.ts';
import type { CodeIssue, StaticAnalysisResponse } from '../protocol.ts';
import {
    createInstance,
    instanceDetail,
    executeCommand,
    findPortByPreviewHost,
    findPortByInstanceId,
    findBasePath,
    getInstance,
    killAllDevServers,
    isPortServing,
    listInstances,
    previewUrlFor,
    rehydrateInstances,
    readInstanceFiles,
    restartDevServer,
    restoreInstanceById,
    sanitizeId,
    shutdownInstance,
    touchInstance,
    evictIdleInstances,
    writeFilesTo,
    type Instance,
} from './instances.ts';

// ---------- small helpers ----------

function send(res: http.ServerResponse, status: number, body: unknown, cors = false): void {
    const payload = JSON.stringify(body);
    const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    };
    // Preview-path answers are read cross-origin by the builder's
    // readiness check; without ACAO every healthy preview reads as a
    // network error.
    if (cors) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(status, headers);
    res.end(payload);
}

function readBody(req: http.IncomingMessage, cap: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > cap) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const expected = `Bearer ${config.apiKey}`;
    if (header.length !== expected.length) return false;
    // Length matched above; compare in constant time regardless.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}


// ---------- static analysis (bounded: typecheck only in v1) ----------

async function runAnalysis(instance: Instance): Promise<Omit<StaticAnalysisResponse, 'success'>> {
    // Only typecheck when the project actually has typescript installed;
    // downloading toolchains on demand here would be a supply-chain and
    // latency surprise. Missing tooling is an empty success, not a failure.
    let typecheckOutput = '';
    try {
        await fs.access(path.join(instance.dir, 'node_modules', '.bin', 'tsc'));
        const typecheck = await executeCommand(instance, './node_modules/.bin/tsc --noEmit --pretty false 2>&1', 120);
        typecheckOutput = typecheck.output;
    } catch { /* no local tsc: nothing to run */ }
    const issues: CodeIssue[] = [];
    let errorCount = 0;
    for (const line of typecheckOutput.split('\n')) {
        const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/);
        if (!match) continue;
        const [, filePath, lineNo, column, severity, ruleId, message] = match;
        // The pattern only matches these two, but the type of a capture
        // group is a plain string, so it is narrowed here.
        if (severity !== 'error' && severity !== 'warning') continue;
        issues.push({ filePath, line: Number(lineNo), column: Number(column), severity, ruleId, message });
        if (severity === 'error') errorCount++;
    }
    return {
        lint: { issues: [], summary: { errorCount: 0, warningCount: 0, infoCount: 0 } },
        typecheck: { issues, summary: { errorCount, warningCount: 0, infoCount: 0 }, rawOutput: typecheckOutput.slice(0, 16000) },
    };
}

// ---------- the API routes ----------

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    // Unauthenticated liveness for the k8s readiness probe.
    if (url.pathname === '/healthz') {
        send(res, 200, { ok: true });
        return;
    }
    if (!authorized(req)) {
        send(res, 401, { success: false, error: 'unauthorized' });
        return;
    }
    const method = req.method ?? 'GET';
    const route = `${method} ${url.pathname}`;
    let body: Record<string, unknown> = {};

    try {
        if (method === 'POST' || method === 'PUT') {
            body = JSON.parse((await readBody(req, config.maxBodyBytes)) || '{}');
        }
    } catch (error) {
        send(res, 400, { success: false, error: `bad request body: ${String(error)}` });
        return;
    }

    try {
        // POST /instances — create from the files in the request
        if (route === 'POST /instances') {
            // The runner does not refuse a deploy because older previews are
            // lying around: it retires the least recently used one to make
            // room (see makeRoom).
            // The worker addresses every later call by its session id
            // (x-session-id header, and the path), so that is the
            // instance's identity — not a runner-assigned one.
            const rawId = typeof req.headers['x-session-id'] === 'string' && req.headers['x-session-id'] !== ''
                ? req.headers['x-session-id']
                : crypto.randomUUID().slice(0, 8);
            const id = sanitizeId(rawId);
            if (getInstance(id)) {
                // Same session recreating: shut the old one down first.
                await shutdownInstance(id);
            }
            const files = Array.isArray(body.files) ? body.files : [];
            const instance = await createInstance({
                id,
                files,
                projectName: typeof body.projectName === 'string' ? body.projectName : 'app',
                initCommand: typeof body.initCommand === 'string' ? body.initCommand : 'bun run dev',
                envVars: (typeof body.envVars === 'object' && body.envVars !== null ? body.envVars : {}) as Record<string, string>,
            });
            send(res, 200, { success: true, previewURL: previewUrlFor(instance.id), runId: instance.id, message: 'instance created; bootstrap in progress' });
            return;
        }

        // GET /instances — list
        if (route === 'GET /instances') {
            const all = listInstances();
            send(res, 200, { success: true, instances: all.map(instanceDetail), count: all.length });
            return;
        }

        const instanceMatch = url.pathname.match(/^\/instances\/([a-z0-9-]+)(\/[a-z]+)?$/i);
        if (!instanceMatch) {
            send(res, 404, { success: false, error: 'unknown endpoint' });
            return;
        }
        const id = sanitizeId(instanceMatch[1]);
        const instance = getInstance(id);

        if (route === `GET /instances/${id}`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            send(res, 200, { success: true, instance: instanceDetail(instance) });
            return;
        }
        if (route === `GET /instances/${id}/status`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found', pending: false, isHealthy: false }); return; }
            const healthy = instance.phase === 'serving' && (await isPortServing(instance.port));
            // The builder polls this while the preview comes up: a poll is
            // an access, so a preview being watched is never evicted.
            touchInstance(id);
            send(res, 200, {
                success: true,
                pending: instance.phase === 'creating' || instance.phase === 'installing' || instance.phase === 'starting',
                previewURL: instance.phase === 'serving' ? previewUrlFor(instance.id) : undefined,
                processId: instance.devProcess ? String(instance.devProcess.pid) : undefined,
                isHealthy: healthy,
                message: instance.phase,
            });
            return;
        }
        if (route === `POST /instances/${id}/files`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            const files = Array.isArray(body.files) ? body.files : [];
            const results = await writeFilesTo(instance, files);
            // Self-heal: a failed instance has no dev process left, so a
            // write that arrives with repaired code must also restart the
            // server — there is no watcher left to notice the change.
            if (!instance.devProcess || instance.phase === 'failed') {
                void restartDevServer(instance).then(() => send(res, 200, { success: results.every((r) => r.success), results, message: 'files written; dev server restarted' }));
                return;
            }
            send(res, 200, { success: results.every((r) => r.success), results, message: 'files written' });
            return;
        }
        if (route === `GET /instances/${id}/files`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            let filePaths: string[] | undefined;
            const raw = url.searchParams.get('filePaths');
            if (raw) { try { filePaths = JSON.parse(raw); } catch { filePaths = undefined; } }
            const files = await readInstanceFiles(instance, filePaths);
            send(res, 200, { success: true, files });
            return;
        }
        if (route === `POST /instances/${id}/commands`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            const commands = Array.isArray(body.commands) ? (body.commands as string[]) : [];
            const timeout = typeof body.timeout === 'number' ? Math.min(body.timeout / 1000, 600) : config.commandTimeoutSeconds;
            const results = [];
            for (const command of commands) {
                results.push(await executeCommand(instance, command, timeout));
            }
            send(res, 200, { success: results.every((r) => r.success), results, message: 'commands executed' });
            return;
        }
        if (route === `GET /instances/${id}/errors`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            send(res, 200, { success: true, errors: instance.errors, hasErrors: instance.errors.length > 0 });
            return;
        }
        if (route === `DELETE /instances/${id}/errors`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            instance.errors = [];
            send(res, 200, { success: true, message: 'errors cleared' });
            return;
        }
        if (route === `GET /instances/${id}/analysis`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            send(res, 200, { success: true, ...(await runAnalysis(instance)) });
            return;
        }
        if (route === `POST /instances/${id}/deploy`) {
            // The k3s runner *is* the deployment target: the app is already
            // serving from the cluster. Report the preview as the deployed URL.
            if (!instance) { send(res, 404, { success: false, message: 'instance not found', error: 'instance not found' }); return; }
            send(res, 200, {
                success: true,
                message: 'App serves from the k3s preview host; nothing further to deploy.',
                deployedUrl: previewUrlFor(instance.id),
                deploymentId: instance.id,
            });
            return;
        }
        if (route === `DELETE /instances/${id}`) {
            const removed = await shutdownInstance(id);
            send(res, removed ? 200 : 404, removed ? { success: true, message: 'instance shut down' } : { success: false, error: 'instance not found' });
            return;
        }
        if (route === `POST /instances/${id}/name`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            instance.projectName = typeof body.projectName === 'string' ? body.projectName : instance.projectName;
            send(res, 200, { success: true });
            return;
        }
        if (route === `GET /instances/${id}/logs`) {
            if (!instance) { send(res, 404, { success: false, error: 'instance not found' }); return; }
            const reset = url.searchParams.get('reset') === 'true';
            const payload = { success: true, logs: { stdout: instance.stdout, stderr: instance.stderr } };
            if (reset) { instance.stdout = ''; instance.stderr = ''; }
            send(res, 200, payload);
            return;
        }
        if (route === 'POST /logs') {
            // Debug sink the client may call; accepted and dropped.
            send(res, 200, { success: true });
            return;
        }

        send(res, 404, { success: false, error: 'unknown endpoint' });
    } catch (error) {
        console.error('[api] handler error', route, error);
        send(res, 500, { success: false, error: String(error) });
    }
}

// ---------- the preview proxy ----------

function proxyTo(res: http.ServerResponse, port: number, req: http.IncomingMessage, stripPrefix?: string): void {
    // http.request rather than a raw socket: vite answers with chunked
    // responses and hop-by-hop headers the client must not see verbatim —
    // node re-frames all of that correctly.
    if (stripPrefix && (req.url ?? '').startsWith(stripPrefix)) {
        req.url = (req.url ?? '').slice(stripPrefix.length) || '/';
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.connection;
    delete headers['transfer-encoding'];
    // Root-serving apps get identity bodies: HTML and CSS are rewritten by
    // the proxy, and decoding compressed bytes only to re-encode them is
    // waste. (Vite apps pipe through untouched.)
    if (stripPrefix) headers['accept-encoding'] = 'identity';
    console.log(`[runner] proxying ${req.method} ${req.url} -> 127.0.0.1:${port}`);
    const upstream = http.request(
        {
            host: '127.0.0.1',
            port,
            path: req.url,
            method: req.method,
            headers,
        },
        async (upstreamRes) => {
            const upstreamHeaders = upstreamRes.headers;
            const contentType = String(upstreamHeaders['content-type'] ?? '');
            // Root-serving apps reference their assets with root-absolute
            // paths (/style.css), which escape the preview prefix and 404.
            // For HTML and CSS we rewrite those to be relative, so the
            // browser keeps everything under /p/<id>/. Vite apps don't need
            // this: --base already makes vite emit prefixed URLs.
            const rewrite = stripPrefix !== undefined && /text\/html|text\/css/.test(contentType);
            if (!rewrite) {
                res.writeHead(upstreamRes.statusCode ?? 502, {
                    ...upstreamHeaders,
                    'Access-Control-Allow-Origin': '*',
                });
                upstreamRes.pipe(res);
                upstreamRes.on('error', () => res.end());
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            let failed = false;
            upstreamRes.on('data', (chunk) => {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) {
                    failed = true;
                    upstreamRes.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            upstreamRes.on('end', () => {
                if (failed) {
                    if (!res.headersSent) send(res, 502, { success: false, error: 'preview body too large to rewrite' }, true);
                    else res.end();
                    return;
                }
                let body = Buffer.concat(chunks).toString('utf8');
                // /x stays in the origin's root; under the preview prefix it
                // must reach the same file: /p/<id>/x. Relative is /x's twin
                // once the page lives at /p/<id>/.
                if (contentType.includes('text/html')) {
                    body = body.replace(/\b(href|src)=(["'])\/(?!\/)([^"']*)\2/g, '$1=$2$3$2');
                } else {
                    body = body.replace(/url\((['"]?)\/(?!\/)/g, 'url($1');
                }
                const fwd = { ...upstreamHeaders };
                // The body below is already decoded (we asked for identity),
                // so the upstream framing headers must not leak through.
                delete fwd['content-encoding'];
                delete fwd['transfer-encoding'];
                res.writeHead(upstreamRes.statusCode ?? 502, {
                    ...fwd,
                    'Content-Length': Buffer.byteLength(body),
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(body);
            });
            upstreamRes.on('error', (error) => {
                console.error('[runner] upstream stream error', error);
                res.end();
            });
        }
    );
    upstream.on('error', (error) => {
        console.error('[runner] upstream request error', error);
        if (!res.headersSent) send(res, 502, { success: false, error: 'instance dev server is not responding' }, true);
        else res.end();
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
    res.on('close', () => upstream.destroy());
}

function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
    const upstream = net.connect({ port, host: '127.0.0.1' }, () => {
        const headers = { ...req.headers, host: `127.0.0.1:${port}` };
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (const [key, value] of Object.entries(headers)) {
            if (value === undefined) continue;
            lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
        }
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
}

// ---------- the server ----------

// On shutdown, take the dev servers with us — an orphaned child holds its
// port and breaks the next pod's allocations.
process.on('SIGTERM', () => { killAllDevServers(); process.exit(0); });
process.on('SIGINT', () => { killAllDevServers(); process.exit(0); });

const server = http.createServer((req, res) => {
    void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');
    const host = (req.headers.host ?? '').toLowerCase();

    // Preview traffic, path-based: `/p/<instance>/…` under the runner's own
    // host. One hostname, one certificate, every instance.
    const pathMatch = url.pathname.match(/^\/p\/([a-z0-9-]+)(\/.*)?$/i);
    if (pathMatch) {
        // The builder polls preview readiness cross-origin (HEAD/GET).
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            });
            res.end();
            return;
        }
        const port = findPortByInstanceId(pathMatch[1]);
        if (port === null) {
            // The instance may simply be waiting for its dev server to come
            // back after a rollout: restore it on demand and let the caller
            // retry.
            const restored = await restoreInstanceById(pathMatch[1]);
            if (!restored) {
                send(res, 404, { success: false, error: 'unknown preview instance' }, true);
                return;
            }
            console.log(`[runner] the instance ${pathMatch[1]} is being restored; answering 503`);
            send(res, 503, { success: false, error: 'preview instance is starting' }, true);
            return;
        }
        // The app runs with --base /p/<id>/ (set by the runner for vite),
        // so the dev server expects the full, prefixed path — forward it
        // as-is. Non-vite servers are started with a command that ignores
        // the prefix (the smoke app answers any path).
        touchInstance(pathMatch[1]);
        proxyTo(res, port, req, findBasePath(pathMatch[1]));
        return;
    }

    // Preview traffic, host-based: any host under the preview domain.
    if (config.previewDomain && host.endsWith(`.${config.previewDomain}`)) {
        const port = findPortByPreviewHost(host);
        if (port === null) {
            send(res, 404, { success: false, error: 'unknown preview instance' });
            return;
        }
        proxyTo(res, port, req);
        return;
    }

    void handleApi(req, res, url);
}

// Vite's HMR speaks WebSocket over Upgrade — raw-pipe it to the instance.
server.on('upgrade', (req, socket, head) => {
    const host = (req.headers.host ?? '').toLowerCase();
    const url = new URL(req.url ?? '/', 'http://internal');
    const pathMatch = url.pathname.match(/^\/p\/([a-z0-9-]+)(\/.*)?$/i);
    let port: number | null = null;
    if (pathMatch) {
        // Vite instances serve under the base (keep the path); root-
        // serving apps need the prefix stripped, HMR included.
        port = findPortByInstanceId(pathMatch[1]);
        const base = findBasePath(pathMatch[1]);
        if (port !== null && !base) {
            req.url = url.pathname.slice(`/p/${pathMatch[1]}`.length) || '/';
        }
    } else if (config.previewDomain && host.endsWith(`.${config.previewDomain}`)) {
        port = findPortByPreviewHost(host);
    }
    if (port === null) {
        socket.destroy();
        return;
    }
    proxyUpgrade(req, socket as Duplex, head, port);
});

// A previous pod may have left instances on the volume (an OOM kill, a
// rollout). Adopt them before serving, so their previews come back.
void rehydrateInstances().catch((error) => {
    console.error('[runner] could not rehydrate the instances', error);
});

// Previews nobody asks for any more are swept away: each of them holds a
// dev server with its own heap, and the pod has to stay within its limit.
const sweep = setInterval(() => {
    void evictIdleInstances().catch((error) => {
        console.error('[runner] the idle sweep failed', error);
    });
}, config.sweepIntervalMs);
sweep.unref();

server.listen(config.port, () => {
    console.log(
        `[runner] listening on :${config.port}, previews at ${config.previewDomain ? `*.${config.previewDomain}` : `${config.apiHost}${config.previewPathPrefix}/<id>`}, data in ${config.dataDir}`,
    );
});
