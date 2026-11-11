/**
 * Production capture client. Drives a remote Chromium via the
 * Cloudflare `BROWSER` binding using `@cloudflare/puppeteer`, then
 * delegates to the shared `runCapture` core.
 */

import puppeteer from '@cloudflare/puppeteer';
import type { StructuredLogger } from '../../logger';
import { runCapture, runScreenshot } from './capture-core';
import type {
	BrowserCaptureClient,
	BrowserConsoleCaptureResult,
	BrowserScreenshotResult,
	CapturePage,
	CapturePayload,
	ScreenshotPayload,
} from './types';

export class BindingCaptureClient implements BrowserCaptureClient {
	constructor(
		private readonly env: Env,
		private readonly logger: StructuredLogger,
	) {}

	async captureConsoleLogs(
		payload: CapturePayload,
	): Promise<BrowserConsoleCaptureResult> {
		this.logger.info('Launching Browser Run via BROWSER binding', {
			url: payload.url,
		});
		// @cloudflare/puppeteer's launch accepts the BrowserWorker fetcher.
		// Cast at the boundary; the API surface puppeteer exposes is identical.
		const browser = await puppeteer.launch(
			this.env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0],
		);
		try {
			const page = (await browser.newPage()) as unknown as CapturePage;
			return await runCapture(page, payload);
		} finally {
			try {
				await browser.close();
			} catch (e) {
				this.logger.warn('Failed to close remote Browser Run session', {
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}

	/**
	 * Screenshot the preview with the same remote Chromium the console
	 * capture uses.
	 *
	 * The Browser Rendering REST API would do the same job, but it needs an
	 * API token with the Browser Rendering scope — a token the worker does
	 * not have. The BROWSER binding is already bound and already works.
	 */
	async captureScreenshot(
		payload: ScreenshotPayload,
	): Promise<BrowserScreenshotResult> {
		this.logger.info('Capturing a screenshot via the BROWSER binding', {
			url: payload.url,
			viewport: payload.viewport,
		});
		const browser = await puppeteer.launch(
			this.env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0],
		);
		try {
			const page = (await browser.newPage()) as unknown as CapturePage;
			const image = await runScreenshot(page, payload);
			return {
				url: payload.url,
				capturedAt: new Date().toISOString(),
				image,
			};
		} finally {
			try {
				await browser.close();
			} catch (e) {
				this.logger.warn('Failed to close remote Browser Run session', {
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}
}
