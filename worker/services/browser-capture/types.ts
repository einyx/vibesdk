/**
 * Shared types for the browser console-log capture service.
 *
 * Two implementations satisfy `BrowserCaptureClient`:
 *  - `BindingCaptureClient` — production path, drives Chromium via the
 *    `BROWSER` binding using `@cloudflare/puppeteer`.
 *  - `SidecarCaptureClient` — dev path, calls a local Node sidecar over
 *    HTTP. The sidecar drives Chromium locally with `puppeteer` and
 *    shares the same `runCapture` core.
 *
 * `CapturePage` is a structural type satisfied by both
 * `puppeteer.Page` and `@cloudflare/puppeteer.Page`, so `runCapture`
 * works against either runtime without a hard dependency on either
 * library's exported types.
 */

export interface CapturePayload {
	url: string;
	/** Seconds to wait after navigation finishes to catch late logs. Caller clamps to a sane range. */
	waitSeconds: number;
	viewport: { width: number; height: number };
	/** Optional JS string evaluated in the page after load (e.g. trigger an interaction). */
	interactScript?: string;
}

/**
 * A screenshot request.
 *
 * Same shape of work as the console capture — navigate, settle, then read
 * the page — but the result is an image rather than a list of events.
 */
export interface ScreenshotPayload {
	url: string;
	viewport: { width: number; height: number };
	/** Seconds to wait after navigation finishes before the shot is taken. */
	waitSeconds: number;
}

export interface BrowserScreenshotResult {
	url: string;
	capturedAt: string;
	/** The PNG bytes. */
	image: Uint8Array;
	/**
	 * Populated when the dev sidecar is unavailable, or the capture could
	 * not be taken. The caller reports it rather than throwing.
	 */
	warning?: string;
}

export interface BrowserConsoleEntry {
	level: string;
	text: string;
	location?: {
		url?: string;
		lineNumber?: number;
		columnNumber?: number;
	};
}

export interface BrowserConsolePageError {
	message: string;
	stack?: string;
}

export interface BrowserConsoleRequestFailure {
	url: string;
	method?: string;
	failure: string;
	status?: number;
}

export interface BrowserConsoleCaptureResult {
	url: string;
	capturedAt: string;
	logs: BrowserConsoleEntry[];
	pageErrors: BrowserConsolePageError[];
	requestFailures: BrowserConsoleRequestFailure[];
	/**
	 * Populated when the dev sidecar is unavailable. The tool returns
	 * the result intact so the LLM sees the warning and moves on
	 * instead of being thrown a hard error.
	 */
	warning?: string;
}

/**
 * Minimal structural subset of `puppeteer.Page` / `@cloudflare/puppeteer.Page`
 * that `runCapture` depends on. Both libraries' Page types satisfy this.
 */
export interface CaptureConsoleMessage {
	type(): string;
	text(): string;
	location(): {
		url?: string;
		lineNumber?: number;
		columnNumber?: number;
	};
}

export interface CaptureHttpRequest {
	url(): string;
	method(): string;
	failure(): { errorText: string } | null;
}

export interface CaptureHttpResponse {
	status(): number;
	url(): string;
	request(): { method(): string };
}

export interface CapturePage {
	on(event: 'console', cb: (msg: CaptureConsoleMessage) => void): unknown;
	on(event: 'pageerror', cb: (err: { message: string; stack?: string }) => void): unknown;
	on(event: 'requestfailed', cb: (req: CaptureHttpRequest) => void): unknown;
	on(event: 'response', cb: (res: CaptureHttpResponse) => void): unknown;
	setViewport(v: { width: number; height: number }): Promise<void>;
	goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
	evaluate(script: string): Promise<unknown>;
	screenshot(opts?: { type?: string; fullPage?: boolean }): Promise<Uint8Array>;
	close(): Promise<void>;
}

export interface BrowserCaptureClient {
	captureConsoleLogs(payload: CapturePayload): Promise<BrowserConsoleCaptureResult>;
	captureScreenshot(payload: ScreenshotPayload): Promise<BrowserScreenshotResult>;
}
