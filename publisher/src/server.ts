// The Publisher service: one process, two faces.
//
//   POST   /publish          apply an app's stack to the cluster
//   GET    /publish/:appId   how the app is doing
//   DELETE /publish/:appId   take the app's stack away
//   GET    /bundles/:appId   the bundle, for the app's seed container
//   GET    /healthz          liveness, for the readiness probe
//
// and, beside the API, the traffic of the deployed apps:
//
//   GET /<appId>/…           the app, served by its own runtime
//
// The control plane is bearer-token gated. The app traffic is not: it is
// the app, and it is addressed publicly.

import http from 'node:http'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'
import { KubeClient, describe } from './kube.ts'
import { buildAppStack, stackObjects } from './stack.ts'
import { proxyToApp, proxyUpgradeToApp } from './proxy.ts'
import type { PublishFile, PublishRequest, PublishResponse, PublishStatusResponse } from '../protocol.ts'

const kube = new KubeClient(config.kubeApiUrl, config.kubeTokenFile);

// ---------- helpers ----------

function send(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(payload),
	});
	res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > config.maxBodyBytes) {
				reject(new Error('the body is too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** The API key, compared in constant time. */
function authorized(req: http.IncomingMessage, expected: string): boolean {
	const header = req.headers.authorization ?? '';
	const wanted = `Bearer ${expected}`;
	if (header.length !== wanted.length) return false;
	let diff = 0;
	for (let i = 0; i < wanted.length; i++) diff |= header.charCodeAt(i) ^ wanted.charCodeAt(i);
	return diff === 0;
}

/** An app's id is a DNS label: it names the objects and the service. */
export function sanitizeAppId(raw: string): string {
	const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
	return cleaned || 'app';
}

/** A file's path stays inside the bundle. */
function safeFilePath(raw: string): string {
	const cleaned = raw.replace(/^\/+/, '');
	if (!cleaned) throw new Error('a file has no path');
	if (cleaned.split('/').some((segment) => segment === '..')) {
		throw new Error(`a file points outside the bundle: ${raw}`);
	}
	return cleaned;
}

/**
 * The request, checked by hand.
 *
 * The publisher has no dependencies, so the schemas in protocol.ts are the
 * worker's side of the contract and the types the publisher's answers are
 * checked against — the same arrangement the runner has.
 */
export function parsePublishRequest(body: unknown): PublishRequest {
	if (typeof body !== 'object' || body === null) throw new Error('the body is not an object');
	const record = body as Record<string, unknown>;

	const appId = typeof record.appId === 'string' ? record.appId.trim() : '';
	if (!appId) throw new Error('appId is required');

	const rawFiles = Array.isArray(record.files) ? record.files : [];
	const files: PublishFile[] = [];
	for (const raw of rawFiles) {
		if (typeof raw !== 'object' || raw === null) throw new Error('a file is not an object');
		const file = raw as Record<string, unknown>;
		if (typeof file.filePath !== 'string' || typeof file.fileContents !== 'string') {
			throw new Error('a file is malformed');
		}
		files.push({ filePath: safeFilePath(file.filePath), fileContents: file.fileContents });
	}
	if (files.length === 0) throw new Error('the bundle has no files');

	const env: Record<string, string> = {};
	if (typeof record.env === 'object' && record.env !== null) {
		for (const [name, value] of Object.entries(record.env as Record<string, unknown>)) {
			if (typeof value === 'string') env[name] = value;
		}
	}

	return {
		appId: sanitizeAppId(appId),
		name: typeof record.name === 'string' ? record.name : undefined,
		files,
		env,
		revision: typeof record.revision === 'string' ? record.revision : undefined,
	};
}

// ---------- the bundle store ----------

/**
 * The bundle's fingerprint.
 *
 * It goes on the pod template, so a republished app gets a new pod: the
 * bundle is fetched by the pod's init container, and a pod that stays is
 * a pod with the old bundle.
 */
export function hashBundle(files: PublishFile[]): string {
	const hash = createHash('sha256');
	for (const file of [...files].sort((a, b) => a.filePath.localeCompare(b.filePath))) {
		hash.update(file.filePath);
		hash.update('\0');
		hash.update(file.fileContents);
		hash.update('\0');
	}
	return hash.digest('hex').slice(0, 32);
}

function bundlePath(appId: string): string {
	return path.join(config.dataDir, 'bundles', `${appId}.json`);
}

async function saveBundle(appId: string, files: PublishFile[]): Promise<void> {
	const target = bundlePath(appId);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, JSON.stringify({ files }), 'utf8');
}

async function readBundle(appId: string): Promise<PublishFile[] | null> {
	try {
		const raw = await fs.readFile(bundlePath(appId), 'utf8');
		const parsed = JSON.parse(raw) as { files?: PublishFile[] };
		return Array.isArray(parsed.files) ? parsed.files : null;
	} catch {
		return null;
	}
}

// ---------- the stack ----------

async function applyStack(request: PublishRequest): Promise<void> {
	await saveBundle(request.appId, request.files);

	const objects = buildAppStack({
		appId: request.appId,
		name: request.name ?? '',
		namespace: config.namespace,
		image: config.appImage,
		bundleUrl: `http://publisher.${config.namespace}.svc.cluster.local/bundles/${request.appId}`,
		appPort: config.appPort,
		cpuLimit: config.appCpuLimit,
		memoryLimit: config.appMemoryLimit,
		cpuRequest: config.appCpuRequest,
		memoryRequest: config.appMemoryRequest,
		storage: config.appStorage,
		env: request.env ?? {},
		bundleHash: hashBundle(request.files),
		revision: request.revision,
	});

	for (const entry of objects) {
		await kube.apply(entry.group, config.namespace, entry.resource, entry.object);
	}
}

async function deploymentReady(appId: string): Promise<boolean> {
	const deployment = await kube.get('apps', config.namespace, 'deployments', appId);
	if (!deployment) return false;
	const status = (deployment.status ?? {}) as { readyReplicas?: number };
	return (status.readyReplicas ?? 0) > 0;
}

async function waitForApp(appId: string): Promise<boolean> {
	const deadline = Date.now() + config.readyTimeoutMs;
	while (Date.now() < deadline) {
		if (await deploymentReady(appId)) return true;
		await new Promise((resolve) => setTimeout(resolve, config.readyPollMs));
	}
	return false;
}

async function removeStack(appId: string): Promise<void> {
	for (const entry of stackObjects(appId)) {
		await kube.remove(entry.group, config.namespace, entry.resource, entry.name);
	}
	await fs.rm(bundlePath(appId), { force: true });
}

function appUrl(appId: string): string {
	return `https://${config.publishHost}/${appId}/`;
}

// ---------- the API ----------

async function handleApi(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	url: URL,
): Promise<void> {
	const method = req.method ?? 'GET';

	if (url.pathname === '/healthz') {
		send(res, 200, { ok: true });
		return;
	}

	// The bundle is fetched by the app's own seed container, with the
	// namespace's token rather than the control plane's key.
	const bundleMatch = url.pathname.match(/^\/bundles\/([a-z0-9-]+)$/);
	if (bundleMatch) {
		if (!authorized(req, config.bundleToken)) {
			send(res, 401, { success: false, error: 'unauthorized' });
			return;
		}
		const files = await readBundle(sanitizeAppId(bundleMatch[1]));
		if (!files) {
			send(res, 404, { success: false, error: 'bundle not found' });
			return;
		}
		send(res, 200, { files });
		return;
	}

	if (!authorized(req, config.apiKey)) {
		send(res, 401, { success: false, error: 'unauthorized' });
		return;
	}

	if (url.pathname === '/publish' && method === 'POST') {
		let request: PublishRequest;
		try {
			request = parsePublishRequest(JSON.parse((await readBody(req)) || '{}'));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			send(res, 400, { success: false, appId: '', error: message });
			return;
		}
		try {
			await applyStack(request);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[publisher] the stack was not applied', request.appId, message);
			send(res, 500, { success: false, appId: request.appId, error: message });
			return;
		}
		const ready = await waitForApp(request.appId);
		const response: PublishResponse = {
			success: true,
			appId: request.appId,
			url: appUrl(request.appId),
			state: ready ? 'ready' : 'applying',
			message: ready
				? 'the app is serving'
				: 'the stack is applied; the app is still starting',
		};
		send(res, 200, response);
		return;
	}

	const appMatch = url.pathname.match(/^\/publish\/([a-z0-9-]+)$/);
	if (appMatch) {
		const appId = sanitizeAppId(appMatch[1]);
		if (method === 'DELETE') {
			await removeStack(appId);
			send(res, 200, { success: true, appId, message: 'the app was taken away' });
			return;
		}
		const ready = await deploymentReady(appId);
		const response: PublishStatusResponse = {
			success: true,
			appId,
			url: appUrl(appId),
			state: ready ? 'ready' : 'applying',
			ready,
			message: ready ? 'the app is serving' : 'the app is not serving yet',
		};
		send(res, 200, response);
		return;
	}

	send(res, 404, { success: false, error: 'unknown endpoint' });
}

// ---------- the server ----------

/** The paths the control plane answers; everything else is an app's traffic. */
function isControlPlane(pathname: string): boolean {
	return (
		pathname === '/healthz' ||
		pathname === '/publish' ||
		pathname.startsWith('/publish/') ||
		pathname.startsWith('/bundles/')
	);
}

/** Where an app's service is, from the cluster's own DNS. */
function appTarget(appId: string): { host: string; port: number } {
	return { host: `${appId}.${config.namespace}.svc.cluster.local`, port: 80 };
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'publisher'}`);
	void (async () => {
		try {
			if (isControlPlane(url.pathname)) {
				await handleApi(req, res, url);
				return;
			}
			// The app's traffic: `/<appId>/…` is the app, and the app serves
			// at its own root.
			const match = url.pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/);
			if (!match) {
				send(res, 404, { success: false, error: 'no app is published at this address' });
				return;
			}
			proxyToApp(req, res, appTarget(match[1]), `/${match[1]}`);
		} catch (error) {
			console.error('[publisher] handler error', req.method, url.pathname, error);
			if (!res.headersSent) {
				send(res, 500, { success: false, error: describe(error) });
			} else {
				res.end();
			}
		}
	})();
});

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'publisher'}`);
	const match = url.pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/);
	if (!match) {
		socket.destroy();
		return;
	}
	proxyUpgradeToApp(req, socket, head, {
		host: `${match[1]}.${config.namespace}.svc.cluster.local`,
		port: 80,
	});
});

server.listen(config.port, () => {
	console.log(`[publisher] listening on ${config.port} for ${config.namespace}`);
});
