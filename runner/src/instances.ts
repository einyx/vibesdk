// Instance lifecycle: one instance is a workdir plus a dev-server process.
// The preview is served by the app's own dev server (vite, via
// `bun run dev`), started from the initCommand the platform sends.
import { spawn, execFile, type ChildProcess, type ExecException } from 'node:child_process';
import { promises as fs, existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { config } from './config.ts';

export interface InstanceFile {
    filePath: string;
    fileContents: string;
}

export interface StoredError {
    timestamp: string;
    level: number;
    message: string;
    rawOutput: string;
}

type BootstrapPhase = 'creating' | 'installing' | 'starting' | 'serving' | 'failed';

export interface Instance {
    id: string;
    dir: string;
    projectName: string;
    port: number;
    phase: BootstrapPhase;
    /** The URL prefix the dev server serves under (vite gets /p/<id>/); null serves at root. */
    basePath: string | null;
    devProcess: ChildProcess | null;
    initCommand: string;
    envVars: Record<string, string>;
    stdout: string;
    stderr: string;
    errors: StoredError[];
    createdAt: string;
    startedAt: string | null;
    /** When the instance was last asked for, epoch ms. Drives the eviction order. */
    lastAccessedAt: number;
}

const instances = new Map<string, Instance>();
const errorDedupe = new Map<string, Set<string>>(); // id -> rawOutput hashes
/** Instances whose dev server is currently being started. */
const booting = new Set<string>();

export function listInstances(): Instance[] {
    return [...instances.values()];
}

export function getInstance(id: string): Instance | undefined {
    return instances.get(id);
}

export function sanitizeId(raw: string): string {
    // Instances become DNS labels: lowercase, alnum and dashes only.
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return cleaned || 'instance';
}

/** Whether a port can be bound right now. */
function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', () => resolve(false));
        tester.once('listening', () => tester.close(() => resolve(true)));
        tester.listen(port, '127.0.0.1');
    });
}

function allocatePort(): Promise<number | null> {
    const used = new Set([...instances.values()].map((i) => i.port));
    const candidates: number[] = [];
    for (let p = config.devPortBase; p < config.devPortBase + config.maxInstances + 10; p++) {
        if (!used.has(p)) candidates.push(p);
    }
    // Probe: after a crash, an orphaned dev server may still hold a port
    // the fresh daemon believes is free.
    return (async () => {
        for (const port of candidates) {
            if (await isPortFree(port)) return port;
        }
        return null;
    })();
}

function inInstanceDir(instance: Instance, relativePath: string): string | null {
    // Path traversal guard: everything must resolve inside the workdir.
    const resolved = path.resolve(instance.dir, relativePath);
    const root = path.resolve(instance.dir) + path.sep;
    if (resolved !== path.resolve(instance.dir) && !resolved.startsWith(root)) return null;
    return resolved;
}

async function appendLog(stream: 'stdout' | 'stderr', instance: Instance, chunk: string): Promise<void> {
    instance[stream] = (instance[stream] + chunk).slice(-config.logCapBytes);
    if (stream === 'stderr') {
        for (const line of chunk.split('\n')) {
            if (!line || line.length > 400) continue;
            if (!/error|failed|exception/i.test(line)) continue;
            if (/warning|0 errors|warn/i.test(line)) continue;
            const seen = errorDedupe.get(instance.id) ?? new Set<string>();
            const hash = line.slice(0, 160);
            if (seen.has(hash)) continue;
            seen.add(hash);
            errorDedupe.set(instance.id, seen);
            instance.errors.push({
                timestamp: new Date().toISOString(),
                level: 50,
                message: line.slice(0, 200),
                rawOutput: line,
            });
            if (instance.errors.length > 100) instance.errors.shift();
        }
    }
}

export function killAllDevServers(): void {
    for (const instance of instances.values()) {
        if (instance.devProcess) killTree(instance.devProcess);
    }
}

function killTree(child: ChildProcess): void {
    if (!child.pid || child.exitCode !== null) return;
    const pid = child.pid;
    try {
        // The dev server is spawned in its own process group, so the
        // negative pid reaches the whole tree (bun -> vite -> esbuild).
        process.kill(-pid, 'SIGTERM');
        console.log(`[runner] signalled the process group ${-pid}`);
    } catch (error) {
        console.error(`[runner] could not signal the process group ${-pid}`, error);
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    // Some of the toolchain's processes shrug off SIGTERM. The port has to
    // be free for the next instance, so make sure the group is really gone.
    setTimeout(() => {
        try {
            process.kill(pid, 0); // still there?
            process.kill(-pid, 'SIGKILL');
            console.log(`[runner] killed the process group ${-pid} outright`);
        } catch { /* already gone */ }
    }, 8000).unref();
}

export async function isPortServing(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1', timeout: 1500 });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(false));
    });
}

export interface CreateInstanceInput {
    id: string;
    files: InstanceFile[];
    projectName: string;
    initCommand: string;
    envVars: Record<string, string>;
}

/**
 * Mark an instance as in use.
 *
 * The access time is what the eviction order is built on: a preview nobody
 * asks for any more is the first to go.
 */
export function touchInstance(id: string): void {
    const instance = instances.get(id);
    if (instance) instance.lastAccessedAt = Date.now();
}

/**
 * Stop an instance and free its resources.
 */
async function evict(instance: Instance, reason: string): Promise<void> {
    console.log(`[runner] evicting the instance ${instance.id} (${reason})`);
    if (instance.devProcess) killTree(instance.devProcess);
    instances.delete(instance.id);
    errorDedupe.delete(instance.id);
    await fs.rm(instance.dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Evict the instances nobody has asked for in a while.
 *
 * Every instance holds a dev server with its own V8 heap; without a sweep
 * the pod runs out of memory long before the instance limit is reached.
 */
export async function evictIdleInstances(): Promise<number> {
    const now = Date.now();
    const idle = [...instances.values()].filter(
        (instance) => now - instance.lastAccessedAt > config.idleTtlMs,
    );
    for (const instance of idle) {
        await evict(instance, 'idle');
    }
    return idle.length;
}

/**
 * Make room for a new instance.
 *
 * A preview is a short-lived thing: the least recently used one goes, so a
 * fresh deploy never fails with "instance limit reached" because older
 * previews are still lying around.
 */
async function makeRoom(): Promise<void> {
    await evictIdleInstances();
    while (instances.size >= config.maxInstances) {
        const oldest = [...instances.values()].sort(
            (a, b) => a.lastAccessedAt - b.lastAccessedAt,
        )[0];
        if (!oldest) break;
        await evict(oldest, 'least recently used');
    }
}

/**
 * The public URL of an instance.
 *
 * Path-based under the runner's own host (`/p/<id>`), so a single hostname
 * and a single certificate cover every instance. The host-based form is kept
 * for deployments that do have a wildcard certificate and DNS.
 *
 * The trailing slash on the path-based form is load-bearing. A page served
 * from `/p/<id>` (no slash) resolves its relative asset references against
 * `/p/`, so `styles.css` is requested as `/p/styles.css` — not a preview path
 * at all, and the stylesheet never arrives. With the slash the browser asks
 * for `/p/<id>/styles.css`, which is. The host-based form needs no slash:
 * its path is already `/`.
 */
export function previewUrlFor(id: string): string {
    if (config.previewDomain) {
        return `https://${id}.${config.previewDomain}`;
    }
    return `https://${config.apiHost}${config.previewPathPrefix}/${id}/`;
}

/**
 * The instance as the API reports it.
 *
 * The shape is the protocol's `InstanceDetails`, so it is type-checked
 * against the contract the worker validates every response with.
 */
export function instanceDetail(instance: Instance) {
    return {
        runId: instance.id,
        name: instance.projectName,
        projectName: instance.projectName,
        startTime: instance.createdAt,
        uptime: (Date.now() - Date.parse(instance.createdAt)) / 1000,
        previewURL: instance.phase === 'serving' ? previewUrlFor(instance.id) : undefined,
        directory: instance.dir,
        serviceDirectory: instance.dir,
        processId: instance.devProcess ? String(instance.devProcess.pid) : undefined,
        runtimeErrors: instance.errors,
    };
}

/** Register the instance and start its bootstrap, asynchronously. */
export async function createInstance(input: CreateInstanceInput): Promise<Instance> {
    // A redeploy reuses the instance id, so the previous instance of the
    // same app is retired first: its dev server would otherwise linger,
    // holding memory and a port.
    const previous = instances.get(input.id);
    if (previous) {
        if (previous.devProcess) killTree(previous.devProcess);
        instances.delete(input.id);
        errorDedupe.delete(input.id);
    }
    // Make room first: a full runner must not refuse a deploy.
    await makeRoom();
    const port = await allocatePort();
    if (port === null) throw new Error('no free dev-server ports');
    const dir = path.join(config.dataDir, 'instances', input.id);
    // A redeploy starts from a clean workdir: files the new publish does
    // not ship must not survive from the old one.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(dir, { recursive: true });

    const instance: Instance = {
        id: input.id,
        dir,
        projectName: input.projectName,
        port,
        phase: 'creating',
        basePath: null,
        devProcess: null,
        initCommand: input.initCommand || 'bun run dev',
        envVars: input.envVars ?? {},
        stdout: '',
        stderr: '',
        errors: [],
        createdAt: new Date().toISOString(),
        startedAt: null,
        lastAccessedAt: Date.now(),
    };
    instances.set(input.id, instance);
    persistInstanceMeta(instance);

    // The files arrive with the request; write them synchronously so a
    // failed write fails the create, then bootstrap in the background.
    await writeFilesTo(instance, input.files);

    void bootstrap(instance);
    return instance;
}

/**
 * The instance's identity, on disk.
 *
 * The registry lives in memory, so a pod restart (an OOM kill, a rollout)
 * would forget every instance while its files survived on the volume. The
 * metadata lets the agent adopt the instance again and restart its server.
 */
function persistInstanceMeta(instance: Instance): void {
    const meta = {
        id: instance.id,
        port: instance.port,
        projectName: instance.projectName,
        initCommand: instance.initCommand,
        envVars: instance.envVars,
        createdAt: instance.createdAt,
        lastAccessedAt: instance.lastAccessedAt,
    };
    try {
        writeFileSync(path.join(instance.dir, 'instance.json'), JSON.stringify(meta), 'utf8');
    } catch (error) {
        console.error('[runner] could not persist the instance metadata', error);
    }
}

/** How long to wait between two restored dev servers, milliseconds. */
const RESTORE_STAGGER_MS = 4000;

/**
 * Read an instance's metadata off the volume.
 */
function readPersistedMeta(dir: string): PersistedMeta | null {
    try {
        const meta = JSON.parse(readFileSync(path.join(dir, 'instance.json'), 'utf8')) as PersistedMeta;
        if (!meta?.id) return null;
        return meta;
    } catch {
        return null; // Not an instance directory.
    }
}

interface PersistedMeta {
    id: string;
    port: number;
    projectName: string;
    initCommand: string;
    envVars: Record<string, string>;
    createdAt: string;
    lastAccessedAt?: number;
}

function instanceFromMeta(meta: PersistedMeta, dir: string): Instance {
    return {
        id: meta.id,
        dir,
        projectName: meta.projectName,
        port: meta.port,
        phase: 'starting',
        basePath: null,
        devProcess: null,
        initCommand: meta.initCommand || 'bun run dev',
        envVars: meta.envVars ?? {},
        stdout: '',
        stderr: '',
        errors: [],
        createdAt: meta.createdAt,
        startedAt: null,
        lastAccessedAt: meta.lastAccessedAt ?? Date.now(),
    };
}

/**
 * Adopt an instance from the volume and start its dev server again.
 *
 * Both the boot restore and the on-demand restore go through here, so an
 * instance is never adopted twice — which would start two dev servers for
 * the same preview.
 */
async function adoptInstance(id: string): Promise<Instance | null> {
    const existing = instances.get(id);
    if (existing) return existing;

    const dir = path.join(config.dataDir, 'instances', id);
    const meta = readPersistedMeta(dir);
    if (!meta) return null;

    const instance = instanceFromMeta(meta, dir);
    // The persisted port may be held by something else now: the dev server
    // would fail to bind and the preview would never come up.
    if (!(await isPortFree(instance.port))) {
        const port = await allocatePort();
        if (port === null) return null; // No free port.
        instance.port = port;
        persistInstanceMeta(instance);
    }
    instances.set(instance.id, instance);
    return instance;
}

/**
 * Adopt the instances left on the volume by a previous pod, and bring their
 * dev servers back up.
 *
 * A preview URL is a promise to the user: it must keep working across a
 * rollout, an OOM kill or a node drain. The workdirs survive on the volume,
 * so the instances are restored rather than dropped — the dev server is
 * simply started again from the same files and the same port.
 */
export async function rehydrateInstances(): Promise<void> {
    const root = path.join(config.dataDir, 'instances');
    let entries: string[] = [];
    try {
        entries = await fs.readdir(root);
    } catch {
        return; // No instances yet.
    }

    const adopted: Instance[] = [];
    for (const id of entries) {
        const instance = await adoptInstance(id);
        if (instance) adopted.push(instance);
    }

    // The most recently used first, and never more than the instance
    // limit: the restored servers each hold a V8 heap, so the surplus is
    // dropped rather than started.
    adopted.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    const keep = adopted.slice(0, config.maxInstances);
    for (const stale of adopted.slice(0, adopted.length - keep.length)) {
        instances.delete(stale.id);
        console.log(`[runner] dropping ${stale.id} (over the instance limit)`);
        await fs.rm(stale.dir, { recursive: true, force: true }).catch(() => undefined);
    }

    // The servers come up staggered: starting them all at once is what
    // exhausted the pod's memory before.
    for (const [index, instance] of keep.entries()) {
        if (index > 0) await new Promise((r) => setTimeout(r, RESTORE_STAGGER_MS));
        console.log(`[runner] restoring the instance ${instance.id} (its dev server died with the pod)`);
        void bootstrap(instance);
    }
}

/**
 * Restore a single instance on demand.
 *
 * The boot restore covers the instances that were running; this covers the
 * ones that were dropped by the limit, and the window where the pod is
 * still bringing its servers up.
 */
export async function restoreInstanceById(id: string): Promise<Instance | null> {
    const instance = await adoptInstance(id);
    if (!instance) return null;
    if (instance.devProcess || booting.has(instance.id)) return instance; // Already running.
    console.log(`[runner] restoring the instance ${instance.id} on demand`);
    void bootstrap(instance);
    return instance;
}

// The dev command. Vite apps get a base: previews live at
// /p/<instanceId>/ under the runner's own host, and vite rewrites its
// injected asset URLs to the base only when it is started with --base.
// Everything else runs the command the platform sent as-is.
function devCommandFor(instance: Instance): string {
    const prefix = `/p/${instance.id}/`;
    const scriptOrCommand = `${instance.initCommand}`;
    let isVite = /vite/.test(scriptOrCommand);
    try {
        const pkg = JSON.parse(readFileSync(path.join(instance.dir, 'package.json'), 'utf8'));
        const devScript = pkg?.scripts?.dev ?? '';
        if (/vite/.test(devScript)) isVite = true;
    } catch { /* no readable package.json: fall through */ }
    if (!isVite) return scriptOrCommand;
    // Run vite directly (bun x resolves the project's local binary) with
    // the port and base we need; the script's own flags are superseded.
    return `bun x vite --host 0.0.0.0 --port ${instance.port} --strictPort --base ${prefix}`;
}

function startDevProcess(instance: Instance): ChildProcess {
    // Vite runs under the preview prefix; root-serving apps (plain
    // workers, static trees) keep null and the proxy strips for them.
    instance.basePath = /vite/.test(devCommandFor(instance)) ? `/p/${instance.id}/` : null;
    const child = spawn(
        '/bin/sh',
        ['-c', devCommandFor(instance)],
        {
            cwd: instance.dir,
            detached: true,
            env: {
                ...process.env,
                ...instance.envVars,
                PORT: String(instance.port),
                // Vite honours these for the dev server host/port.
                HMR_PORT: String(instance.port),
                // The dev server's heap is bounded: workerd's V8 isolate
                // grows without limit and the pod gets OOM-killed.
                NODE_OPTIONS: process.env.INSTANCE_NODE_OPTIONS ?? '--max-old-space-size=768',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    child.stdout?.on('data', (c) => void appendLog('stdout', instance, c.toString()));
    child.stderr?.on('data', (c) => void appendLog('stderr', instance, c.toString()));
    child.once('exit', (code) => {
        if (instance.devProcess === child) {
            instance.devProcess = null;
            instance.phase = 'failed';
            instance.stderr += `\n[runner] dev server exited (code ${code})\n`;
        }
    });
    return child;
}

async function bootstrap(instance: Instance): Promise<void> {
    if (booting.has(instance.id)) return; // Already on its way up.
    booting.add(instance.id);
    try {
        await bootstrapInstance(instance);
    } finally {
        booting.delete(instance.id);
    }
}

async function bootstrapInstance(instance: Instance): Promise<void> {
    const run = (command: string, timeoutMs: number): Promise<number> =>
        new Promise((resolve) => {
            const child = execFile(
                '/bin/sh',
                ['-c', command],
                { cwd: instance.dir, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (stdout) void appendLog('stdout', instance, stdout.toString());
                    if (stderr) void appendLog('stderr', instance, stderr.toString());
                    resolve(error && typeof (error as ExecException).code === 'number' ? (error as ExecException).code as number : error ? 1 : 0);
                }
            );
            child.removeAllListeners('error'); // handled by the callback
            void child;
        });

    try {
        // Only a project with dependencies needs installing. A published
        // bundle (the built worker of a Workers app) has no package.json at
        // all, and `bun install` would fail on it before the dev server ever
        // starts.
        const hasPackageJson = existsSync(path.join(instance.dir, 'package.json'));
        if (hasPackageJson) {
            instance.phase = 'installing';
            const installExit = await run('bun install', 240_000);
            if (installExit !== 0) {
                instance.phase = 'failed';
                instance.stderr += '\n[runner] bun install failed\n';
                return;
            }
        } else {
            console.log(`[runner] no package.json for ${instance.id}; skipping install`);
        }

        instance.phase = 'starting';
        const child = startDevProcess(instance);
        instance.devProcess = child;

        // The dev server is healthy when its port answers.
        for (let attempt = 0; attempt < 90; attempt++) {
            await new Promise((r) => setTimeout(r, 2000));
            if (instance.devProcess !== child) return; // exited or replaced
            if (await isPortServing(instance.port)) {
                instance.phase = 'serving';
                instance.startedAt = new Date().toISOString();
                return;
            }
        }
        if (instance.phase === 'starting') instance.phase = 'failed';
    } catch (error) {
        instance.phase = 'failed';
        instance.stderr += `\n[runner] bootstrap error: ${String(error)}\n`;
    }
}

/** Local dev state and dependencies are not source: they never ship. */
const skippedPublishPaths = ['.wrangler', '.git', 'node_modules'];

export async function writeFilesTo(instance: Instance, files: InstanceFile[]): Promise<Array<{ file: string; success: boolean; error?: string }>> {
    const results: Array<{ file: string; success: boolean; error?: string }> = [];
    for (const file of files) {
        if (skippedPublishPaths.some((prefix) => file.filePath === prefix || file.filePath.startsWith(`${prefix}/`))) {
            continue;
        }
        const target = inInstanceDir(instance, file.filePath);
        if (!target) {
            results.push({ file: file.filePath, success: false, error: 'path escapes instance directory' });
            continue;
        }
        try {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, file.fileContents, 'utf8');
            results.push({ file: file.filePath, success: true });
        } catch (error) {
            results.push({ file: file.filePath, success: false, error: String(error) });
        }
    }
    return results;
}

export async function readInstanceFiles(instance: Instance, filePaths?: string[]): Promise<Array<{ filePath: string; fileContents: string }>> {
    let wanted = filePaths;
    if (!wanted || wanted.length === 0) {
        // No paths: walk the workdir, skipping noise directories.
        const all: string[] = [];
        const skip = new Set(['node_modules', '.git', 'dist', '.wrangler', 'build']);
        async function walk(dir: string, prefix: string): Promise<void> {
            let entries: import('node:fs').Dirent[];
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch { return; }
            for (const entry of entries) {
                if (entry.isDirectory() && skip.has(entry.name)) continue;
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
                else if (entry.isFile()) all.push(rel);
            }
        }
        await walk(instance.dir, '');
        wanted = all.slice(0, 400);
    }
    const files: Array<{ filePath: string; fileContents: string }> = [];
    for (const rel of wanted) {
        const target = inInstanceDir(instance, rel);
        if (!target) continue;
        try {
            const stat = await fs.stat(target);
            if (!stat.isFile() || stat.size > 1024 * 1024) continue;
            files.push({ filePath: rel, fileContents: await fs.readFile(target, 'utf8') });
        } catch { /* missing file: skip */ }
    }
    return files;
}

export function executeCommand(instance: Instance, command: string, timeoutSeconds: number): Promise<{ command: string; success: boolean; output: string; error?: string; exitCode?: number }> {
    return new Promise((resolve) => {
        execFile(
            '/bin/sh',
            ['-c', command],
            { cwd: instance.dir, timeout: timeoutSeconds * 1000, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => {
                const output = [stdout?.toString(), stderr?.toString()].filter(Boolean).join('\n').slice(0, 256 * 1024);
                if (stdout) void appendLog('stdout', instance, stdout.toString());
                if (stderr) void appendLog('stderr', instance, stderr.toString());
                const timedOut = error && (error as ExecException).killed === true;
                resolve({
                    command,
                    success: !error,
                    output,
                    error: timedOut ? 'timeout' : error ? String(error.message ?? error).slice(0, 2000) : undefined,
                    exitCode: typeof (error as ExecException | undefined)?.code === 'number' ? (error as ExecException).code as number : error ? 1 : 0,
                });
            }
        );
    });
}

export async function restartDevServer(instance: Instance): Promise<void> {
    if (instance.devProcess) {
        killTree(instance.devProcess);
        instance.devProcess = null;
    }
    instance.phase = 'starting';
    const child = startDevProcess(instance);
    instance.devProcess = child;
    for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (instance.devProcess !== child) return;
        if (await isPortServing(instance.port)) {
            instance.phase = 'serving';
            instance.startedAt = new Date().toISOString();
            return;
        }
    }
}

export async function shutdownInstance(id: string): Promise<boolean> {
    const instance = instances.get(id);
    if (!instance) return false;
    if (instance.devProcess) killTree(instance.devProcess);
    instances.delete(id);
    errorDedupe.delete(id);
    await fs.rm(instance.dir, { recursive: true, force: true }).catch(() => {});
    return true;
}

export function findPortByPreviewHost(host: string): number | null {
    const suffix = `.${config.previewDomain}`;
    if (!config.previewDomain || !host.endsWith(suffix)) return null;
    const id = host.slice(0, -suffix.length);
    return findPortByInstanceId(id);
}

/** The port an instance's dev server listens on, by instance id. */
export function findPortByInstanceId(id: string): number | null {
    const instance = instances.get(id);
    return instance ? instance.port : null;
}

/**
 * The prefix to strip before forwarding to the instance's dev server —
 * `/p/<id>/` for root-serving apps (plain workers, static trees);
 * undefined for vite apps, which serve under the base and need the path
 * forwarded as-is.
 */
export function findBasePath(id: string): string | undefined {
    const instance = instances.get(id);
    if (!instance || instance.basePath) return undefined;
    // Without the trailing slash: a health check asks for `/p/<id>` exactly,
    // and the prefix has to come off that too.
    return `/p/${instance.id}`;
}
