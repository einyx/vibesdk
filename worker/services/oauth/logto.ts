/**
 * Logto (Verity / prysm.sh) OAuth Provider
 * OIDC authentication against the tenant's own issuer.
 *
 * Dropped into the vibesdk fork at worker/services/oauth/logto.ts. It follows
 * google.ts's shape on purpose: a BaseOAuthProvider subclass whose create()
 * reads the deployment's environment and derives the redirect URI.
 *
 * Endpoints come from the issuer, and Logto's issuer is the origin plus
 * /oidc: authorize {issuer}/auth, token {issuer}/token, identity {issuer}/me.
 */

import { BaseOAuthProvider } from './base';
import type { OAuthUserInfo } from '../../types/auth-types';
import { createLogger } from '../../logger';

const logger = createLogger('LogtoOAuth');

/**
 * Logto OIDC Provider implementation
 */
export class LogtoOAuthProvider extends BaseOAuthProvider {
    protected readonly provider = 'logto';
    protected readonly authorizationUrl: string;
    protected readonly tokenUrl: string;
    protected readonly userInfoUrl: string;
    // The scopes authentication needs. offline_access is what keeps a
    // refresh token coming back, the same thing base.ts asks for with
    // access_type=offline.
    protected readonly scopes = ['openid', 'email', 'profile', 'offline_access'];

    constructor(
        clientId: string,
        clientSecret: string,
        redirectUri: string,
        issuer: string
    ) {
        super(clientId, clientSecret, redirectUri);
        this.authorizationUrl = `${issuer}/auth`;
        this.tokenUrl = `${issuer}/token`;
        this.userInfoUrl = `${issuer}/me`;
    }

    /**
     * Get the authorization URL.
     *
     * The base class sends prompt=consent to force a refresh token out of
     * Google. Logto needs no forcing — offline_access does that — and its
     * consent screen is for scopes the app does not ask. The parameters the
     * base class sets are dropped here, so a signed-in user passes through
     * without a click.
     */
    async getAuthorizationUrl(state: string, codeVerifier?: string): Promise<string> {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: this.scopes.join(' '),
            state
        });

        if (codeVerifier) {
            const challenge = await this.generateCodeChallenge(codeVerifier);
            params.append('code_challenge', challenge);
            params.append('code_challenge_method', 'S256');
        }

        return `${this.authorizationUrl}?${params.toString()}`;
    }

    /**
     * Get user info. The OIDC identity endpoint answers the standard claims,
     * so no provider SDK is involved.
     */
    async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
        try {
            const response = await fetch(this.userInfoUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const error = await response.text();
                logger.error('Failed to get user info', { error });
                throw new Error(`Failed to get user info: ${error}`);
            }

            const data = await response.json() as {
                sub: string;
                email?: string;
                name?: string;
                username?: string;
                picture?: string;
                email_verified?: boolean;
            };

            return {
                id: data.sub,
                email: data.email ?? `${data.username}@users.prysm.sh`,
                name: data.name ?? data.username,
                picture: data.picture,
                emailVerified: data.email_verified ?? false
            };
        } catch (error) {
            logger.error('Error getting user info', error);
            throw error;
        }
    }

    /**
     * Create Logto provider instance
     */
    static create(env: Env, baseUrl: string): LogtoOAuthProvider {
        if (!env.LOGTO_CLIENT_ID || !env.LOGTO_CLIENT_SECRET || !env.LOGTO_ISSUER) {
            throw new Error('Logto OAuth credentials not configured');
        }

        const redirectUri = `${baseUrl}/api/auth/callback/logto`;

        return new LogtoOAuthProvider(
            env.LOGTO_CLIENT_ID,
            env.LOGTO_CLIENT_SECRET,
            redirectUri,
            env.LOGTO_ISSUER
        );
    }
}
