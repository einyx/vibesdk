import { BaseController } from '../baseController';
import type { ControllerResponse, ApiResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { ScreenshotSecurity } from '../../../utils/screenshot-security';

// -------------------------
// Helpers
// -------------------------
function isValidAppId(id: string): boolean {
    // Allow alphanumeric, underscore, dash. Prevent dots and slashes.
    // Length 1-128.
    return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function validateFileName(file: string): string | null {
    // Reject any traversal or path separators
    if (file.includes('..') || file.includes('/') || file.includes('\\') || file.includes('\0')) {
        return null;
    }
    // Enforce simple filename pattern
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(file)) {
        return null;
    }
    // Disallow leading dot files
    if (file.startsWith('.')) {
        return null;
    }
    // Validate extension
    const extIndex = file.lastIndexOf('.');
    if (extIndex <= 0 || extIndex === file.length - 1) {
        return null;
    }
    const ext = file.substring(extIndex + 1).toLowerCase();
    const allowed = new Set(['png', 'jpg', 'jpeg', 'webp']);
    if (!allowed.has(ext)) {
        return null;
    }
    return file;
}

function getMimeByExtension(file: string): string | undefined {
    const ext = file.substring(file.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        default: return undefined;
    }
}

/**
 * The bytes of an image, whatever shape the database handed them back in.
 *
 * A blob column comes out of D1 as a plain array of byte values; other
 * paths hand back an ArrayBuffer, a typed array or base64 text.
 */
function toBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value as number[]);
    if (typeof value === 'string') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    return new Uint8Array(0);
}
export class ScreenshotsController extends BaseController {
    static logger = createLogger('ScreenshotsController');
    static async serveScreenshot(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const appId = context.pathParams.id;
            const file = context.pathParams.file;

            if (!appId || !file) {
                return ScreenshotsController.createErrorResponse('Missing path parameters', 400);
            }

            // Validate and sanitize path parameters
            if (!isValidAppId(appId)) {
                return ScreenshotsController.createErrorResponse('Invalid app id', 400);
            }

            const validatedFile = validateFileName(file);
            if (!validatedFile) {
                return ScreenshotsController.createErrorResponse('Invalid file name', 400);
            }

            // Verify screenshot access token
            const url = new URL(request.url);
            const token = url.searchParams.get('token');

            if (!token) {
                return ScreenshotsController.createErrorResponse('Screenshot not found', 404);
            }

            const security = new ScreenshotSecurity(env);
            const isValidToken = await security.verifyToken(token, appId);
            if (!isValidToken) {
                return ScreenshotsController.createErrorResponse('Screenshot not found', 404);
            }

            const key = `screenshots/${appId}/${validatedFile}`;
            // R2 is where a screenshot normally lives; a deployment without a
            // bucket bound keeps it in the database instead.
            let body: BodyInit | null = null;
            let contentType: string | undefined;
            if (env.TEMPLATES_BUCKET) {
                const obj = await env.TEMPLATES_BUCKET.get(key);
                if (!obj || !obj.body) {
                    return ScreenshotsController.createErrorResponse('Screenshot not found', 404);
                }
                body = obj.body;
                contentType = obj.httpMetadata?.contentType;
            } else {
                const row = await env.DB.prepare(
                    'SELECT mime_type, image FROM app_screenshots WHERE app_id = ?',
                )
                    .bind(appId)
                    .first<{ mime_type: string; image: unknown }>();
                if (!row || !row.image) {
                    return ScreenshotsController.createErrorResponse('Screenshot not found', 404);
                }
                body = toBytes(row.image);
                contentType = row.mime_type;
            }

            const resolvedType = contentType || getMimeByExtension(validatedFile) || 'image/png';
            const headers = new Headers({
                'Content-Type': resolvedType,
                'Cache-Control': 'public, max-age=21600',
                'X-Content-Type-Options': 'nosniff',
            });

			// We return a naked Response because our controller helper types expect JSON, but this route is binary.
			// It's safe because the router uses this Response directly.
			return new Response(body, {
				headers,
			}) as unknown as ControllerResponse<ApiResponse<never>>;
		        } catch (error) {
            this.logger.error('Error serving screenshot', { error });
            return ScreenshotsController.createErrorResponse('Internal server error', 500);
        }
    }
}
