// The data plane: the deployed apps' traffic.
//
// A published app is served at a path under the publisher's own host
// (`/<appId>/…`), so one hostname and one certificate cover every app. The
// app behind it serves at its root, so the prefix is stripped on the way
// in, and the root-absolute paths the app's HTML carries are rewritten to
// relative ones on the way out.
//
// The runner's proxy does the same for its own instances
// (runner/src/server.ts). The two are separate services with separate
// build contexts, so neither borrows the other's code.

import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'

export interface ProxyTarget {
	host: string;
	port: number;
}

/** How large a rewritten body may be. */
const MAX_REWRITE_BYTES = 8 * 1024 * 1024

/**
 * Rewrite root-absolute paths to relative ones.
 *
 * `/style.css` under the prefix `/my-app/` must reach the same file as
 * `/my-app/style.css`, and the browser only asks for that when the page
 * says `style.css` instead.
 */
export function rewriteRootPaths(body: string, contentType: string): string {
	if (contentType.includes('text/html')) {
		return body.replace(/\b(href|src)=(["'])\/(?!\/)([^"']*)\2/g, '$1=$2$3$2')
	}
	if (contentType.includes('text/css')) {
		return body.replace(/url\((['"]?)\/(?!\/)/g, 'url($1')
	}
	return body
}

/**
 * Proxy one request to an app.
 *
 * `stripPrefix` is the path the app is addressed under; it is removed
 * before the request goes on, and the app answers as if it were alone.
 */
export function proxyToApp(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	target: ProxyTarget,
	stripPrefix: string,
): void {
	const url = req.url ?? '/';
	if (url === stripPrefix || url.startsWith(`${stripPrefix}/`)) {
		req.url = url.slice(stripPrefix.length) || '/';
	}

	const headers = { ...req.headers, host: `${target.host}:${target.port}` };
	delete headers.connection
	delete headers['transfer-encoding']
	// The body is rewritten below, so it has to arrive decoded.
	headers['accept-encoding'] = 'identity'

	const upstream = http.request(
		{
			host: target.host,
			port: target.port,
			path: req.url,
			method: req.method,
			headers,
		},
		(upstreamRes) => {
			const upstreamHeaders = upstreamRes.headers;
			const contentType = String(upstreamHeaders['content-type'] ?? '');
			const rewrite = /text\/html|text\/css/.test(contentType);
			if (!rewrite) {
				res.writeHead(upstreamRes.statusCode ?? 502, {
					...upstreamHeaders,
					'access-control-allow-origin': '*',
				});
				upstreamRes.pipe(res);
				upstreamRes.on('error', () => res.end());
				return;
			}

			const chunks: Buffer[] = [];
			let size = 0;
			let failed = false;
			upstreamRes.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_REWRITE_BYTES) {
					failed = true;
					upstreamRes.destroy();
					return;
				}
				chunks.push(chunk);
			});
			upstreamRes.on('end', () => {
				if (failed) {
					if (!res.headersSent) {
						res.writeHead(502, { 'content-type': 'application/json' });
						res.end(JSON.stringify({ success: false, error: 'the app answered with a body too large to rewrite' }));
					} else {
						res.end();
					}
					return;
				}
				const body = rewriteRootPaths(Buffer.concat(chunks).toString('utf8'), contentType);
				const forwarded = { ...upstreamHeaders };
				// The body below is decoded, so the upstream's framing headers
				// must not leak through.
				delete forwarded['content-encoding']
				delete forwarded['transfer-encoding']
				res.writeHead(upstreamRes.statusCode ?? 502, {
					...forwarded,
					'content-length': Buffer.byteLength(body),
					'access-control-allow-origin': '*',
				});
				res.end(body);
			});
			upstreamRes.on('error', () => res.end());
		},
	);
	upstream.on('error', () => {
		if (!res.headersSent) {
			res.writeHead(502, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ success: false, error: 'the app is not answering' }));
		} else {
			res.end();
		}
	});
	req.on('error', () => upstream.destroy());
	req.pipe(upstream);
	res.on('close', () => upstream.destroy());
}

/** Proxy a protocol upgrade to an app. */
export function proxyUpgradeToApp(req: http.IncomingMessage, socket: Duplex, head: Buffer, target: ProxyTarget): void {
	const upstream = net.connect({ port: target.port, host: target.host }, () => {
		const headers = { ...req.headers, host: `${target.host}:${target.port}` };
		const lines = [`${req.method} ${req.url} HTTP/1.1`];
		for (const [key, value] of Object.entries(headers)) {
			if (value === undefined) continue;
			lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
		}
		lines.push('', '');
		upstream.write(lines.join('\r\n'));
		if (head.length) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	upstream.on('error', () => socket.destroy());
	socket.on('error', () => upstream.destroy());
}
