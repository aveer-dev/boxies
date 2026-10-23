// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * OAuth 2.1 for the MCP server (AVE-67), on `@cloudflare/workers-oauth-provider`.
 *
 * Roles, all in this Worker:
 * - Authorization server, issuer `APP_BASE_URL` (the web app's origin, where
 *   the Better Auth cookie and /login live):
 *     GET  /.well-known/oauth-authorization-server   RFC 8414 metadata
 *     POST /register                                 RFC 7591 dynamic client registration
 *     POST /token                                    code + refresh exchange, RFC 7009 revocation
 *     GET  /authorize                                ours: signed-in user + consent page
 *     POST /authorize                                ours: Approve / Deny (CSRF-bound)
 * - Protected resource `/mcp` on the issuer origin and on each
 *   `WEB_REDIRECT_HOSTS` host (inboxies.email keeps /mcp, see
 *   lib/web-host-redirect.ts). Each serves RFC 9728 metadata at
 *   /.well-known/oauth-protected-resource/mcp and accepts only tokens issued
 *   for itself (audience-bound).
 *
 * PKCE is required for every client and only S256 is accepted; redirect URIs
 * must match a registered one exactly and be https or http on loopback.
 *
 * `/mcp` keeps accepting Better Auth session tokens (Bearer or cookie) through
 * the session middleware, unchanged; see lib/mcp-oauth-token.ts for how a
 * request picks its path. That legacy path is deprecated later.
 *
 * Storage: KV namespace `OAUTH_KV`. Without the binding, OAuth is off: the
 * endpoints fall through (404) and OAuth-shaped tokens get a 401.
 */

import {
	AuthorizationError,
	authorizationErrorRedirect,
	CimdFetchError,
	OAuthAuthorizationServer,
	OAuthResourceServer,
	type AuthRequest,
	type OAuthResourceTokenValidation,
} from "@cloudflare/workers-oauth-provider";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import {
	CONSENT_FIELDS,
	initialConsentScopes,
	MCP_OAUTH_SCOPES,
	validateConsentSelection,
	type McpConsentView,
} from "../../shared/mcp-consent";
import { authDb, listMailboxesForUser } from "../auth/authz";
import { hasSessionCredentials } from "../auth/middleware";
import { principalFromHeaders, type RequestPrincipal } from "../auth/principal";
import * as schema from "../auth/schema";
import { isOAuthMcpRequest } from "../lib/mcp-oauth-token";
import type { Env } from "../types";

export const MCP_PATH = "/mcp";
export const OAUTH_AUTHORIZE_PATH = "/authorize";
export const OAUTH_TOKEN_PATH = "/token";
export const OAUTH_REGISTER_PATH = "/register";
export const OAUTH_AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const OAUTH_PRM_PREFIX = "/.well-known/oauth-protected-resource";

/**
 * Everything this server can grant (planned in AVE-36); the user picks a
 * subset on the consent page (AVE-68, shared/mcp-consent.ts).
 * Enforced per tool in workers/mcp/index.ts (table: workers/mcp/scopes.ts, AVE-69).
 */
export { MCP_OAUTH_SCOPES };

/** Encrypted grant props, stored by the library and handed back with each token. */
export type McpGrantProps = {
	v: 1;
	userId: string;
	/**
	 * Mailboxes this grant may use, chosen on the consent page (AVE-68).
	 * null means every mailbox the user can access; only grants approved
	 * before AVE-68 have it. workers/mcp/index.ts enforces the list.
	 */
	mailboxIds: string[] | null;
};

/** What `/mcp` handlers see as `ctx.props` (EmailMCP's props). */
export type McpRequestProps = {
	principal?: RequestPrincipal;
	oauth?: { clientId: string; scopes: string[]; mailboxIds: string[] | null };
};

/**
 * Whether the request's OAuth grant may use `mailboxId`. Session-token
 * requests (no `oauth`) and grants without a mailbox list (approved before
 * AVE-68) are limited only by the user's own access, checked separately.
 */
export function grantCoversMailbox(oauth: McpRequestProps["oauth"] | undefined, mailboxId: string): boolean {
	if (!oauth || oauth.mailboxIds === null) return true;
	return oauth.mailboxIds.includes(mailboxId);
}

type McpFetchHandler = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

/**
 * Renders the consent page (the web app's /authorize route, given `view`
 * through the load context). The Worker adds the security headers and the
 * consent binding cookie to whatever this returns.
 */
export type RenderConsent = (
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	view: McpConsentView,
) => Response | Promise<Response>;

type OAuthConfig = { issuer: string; resources: string[]; defaultResource: string };

/** https, or http on a loopback host (wrangler / vite dev). Lowercase origin. */
function canonicalOrigin(value: string | undefined | null): string | null {
	if (!value) return null;
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
	return url.origin.toLowerCase();
}

/**
 * Issuer and resources for this deployment. The issuer is APP_BASE_URL (or
 * the request origin when it is unset, like Better Auth's base URL).
 */
export function mcpOAuthConfig(env: Env, requestUrl: URL): OAuthConfig | null {
	const issuer = canonicalOrigin(env.APP_BASE_URL?.trim() || requestUrl.origin);
	if (!issuer) return null;
	const defaultResource = `${issuer}${MCP_PATH}`;
	const resources = [defaultResource];
	for (const host of (env.WEB_REDIRECT_HOSTS ?? "").split(",")) {
		const origin = canonicalOrigin(host.trim() ? `https://${host.trim()}` : null);
		if (origin && !resources.includes(`${origin}${MCP_PATH}`)) resources.push(`${origin}${MCP_PATH}`);
	}
	return { issuer, resources, defaultResource };
}

function oauthEnabled(env: Env): boolean {
	return Boolean((env as { OAUTH_KV?: unknown }).OAUTH_KV);
}

/** The authorization server for one configuration. Holds config only, no request state. */
function newAuthorizationServer(config: OAuthConfig): OAuthAuthorizationServer<Env> {
	return new OAuthAuthorizationServer<Env>({
		issuer: config.issuer,
		resources: config.resources,
		defaultResource: config.defaultResource,
		authorizeEndpoint: OAUTH_AUTHORIZE_PATH,
		tokenEndpoint: OAUTH_TOKEN_PATH,
		clientRegistrationEndpoint: OAUTH_REGISTER_PATH,
		scopesSupported: [...MCP_OAUTH_SCOPES],
		// Defaults, spelled out: 1h access tokens, 30-day refresh, 90-day DCR clients.
		accessTokenTTL: 60 * 60,
		refreshTokenTTL: 30 * 24 * 60 * 60,
		// No private-use (custom scheme) redirect URIs and no Client ID
		// Metadata Documents for now: https or loopback http, registered via DCR.
		allowPrivateUseRedirectUris: false,
		clientIdMetadataDocumentEnabled: false,
		allowTokenExchangeGrant: false,
	});
}

/**
 * The OAuth machinery for one `/mcp` handler. Instances are cached per
 * configuration (they hold only config, no request state).
 */
export function createMcpOAuth(mcpHandler: McpFetchHandler, options: { renderConsent: RenderConsent }) {
	type Bundle = {
		config: OAuthConfig;
		authorizationServer: OAuthAuthorizationServer<Env>;
		resourceServers: Map<string, OAuthResourceServer<Env, McpRequestProps>>;
	};
	const bundles = new Map<string, Bundle>();

	function bundleFor(env: Env, requestUrl: URL): Bundle | null {
		if (!oauthEnabled(env)) return null;
		const config = mcpOAuthConfig(env, requestUrl);
		if (!config) return null;
		const key = JSON.stringify(config);
		const cached = bundles.get(key);
		if (cached) return cached;

		const authorizationServer = newAuthorizationServer(config);

		const resourceServers = new Map<string, OAuthResourceServer<Env, McpRequestProps>>();
		for (const resource of config.resources) {
			resourceServers.set(
				new URL(resource).origin,
				new OAuthResourceServer<Env, McpRequestProps>({
					resourceMetadata: {
						resource,
						authorization_servers: [config.issuer],
						resource_name: "Inboxies MCP",
					},
					// requiredScopes left unset on purpose: the consent page decides what is granted.
					validateToken: (env) => (res, token) => validateMcpAccessToken(authorizationServer, env, res, token),
					handler: { fetch: (request, env, ctx) => mcpHandler.fetch(request, env, ctx) },
				}),
			);
		}
		const bundle = { config, authorizationServer, resourceServers };
		bundles.set(key, bundle);
		return bundle;
	}

	return {
		/**
		 * Library-owned endpoints: AS metadata, /token, /register on the issuer
		 * origin, and protected-resource metadata on each resource origin.
		 * Null means "not ours", so the caller falls through to the app.
		 */
		async handleProtocolRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
			const url = new URL(request.url);
			const bundle = bundleFor(env, url);
			if (!bundle) return null;
			const path = url.pathname;
			if (path === OAUTH_PRM_PREFIX || path.startsWith(`${OAUTH_PRM_PREFIX}/`)) {
				const rs = bundle.resourceServers.get(url.origin);
				return rs ? rs.fetch(request, env, ctx) : null;
			}
			if (path !== OAUTH_AS_METADATA_PATH && path !== OAUTH_TOKEN_PATH && path !== OAUTH_REGISTER_PATH) return null;
			if (url.origin !== bundle.config.issuer) return null;
			return bundle.authorizationServer.fetch(request, env, ctx);
		},

		/** `/mcp` with an OAuth access token: validate, then hand off to the MCP handler. */
		async serveMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
			const url = new URL(request.url);
			const rs = bundleFor(env, url)?.resourceServers.get(url.origin);
			if (!rs) {
				return new Response(JSON.stringify({ error: "invalid_token" }), {
					status: 401,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
						"WWW-Authenticate": 'Bearer realm="OAuth", error="invalid_token"',
					},
				});
			}
			return rs.fetch(request, env, ctx);
		},

		/**
		 * The challenge for a `/mcp` 401 on the legacy path, so OAuth clients
		 * can discover the authorization server. Null when OAuth is off.
		 */
		challengeFor(request: Request, env: Env, invalidToken: boolean): string | null {
			const url = new URL(request.url);
			const bundle = bundleFor(env, url);
			if (!bundle) return null;
			const isResourceOrigin = bundle.resourceServers.has(url.origin);
			let challenge = 'Bearer realm="OAuth"';
			if (isResourceOrigin) challenge += `, resource_metadata="${url.origin}${OAUTH_PRM_PREFIX}${MCP_PATH}"`;
			if (invalidToken) challenge += ', error="invalid_token"';
			return challenge;
		},

		/** GET/POST /authorize. Null when OAuth is off or this isn't the issuer origin. */
		async handleAuthorize(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
			const url = new URL(request.url);
			const bundle = bundleFor(env, url);
			if (!bundle || url.origin !== bundle.config.issuer || url.pathname !== OAUTH_AUTHORIZE_PATH) return null;
			const oauth = bundle.authorizationServer.getOAuthApi(env);
			try {
				if (request.method === "GET") {
					return await showConsent(request, env, ctx, oauth, options.renderConsent);
				}
				if (request.method === "POST") {
					return await submitConsent(request, env, oauth, bundle.config.issuer);
				}
				return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
			} catch (error) {
				if (error instanceof AuthorizationError && error.redirectTo) {
					return redirect(error.redirectTo);
				}
				if (error instanceof AuthorizationError) {
					return page(400, "Can't continue", error.description || "This authorization request is invalid or has expired. Start again from your app.");
				}
				if (error instanceof CimdFetchError) {
					return page(400, "Can't continue", "This app could not be verified.");
				}
				throw error;
			}
		},
	};
}

type McpOAuth = ReturnType<typeof createMcpOAuth>;
type McpAppEnv = { Bindings: Env; Variables: { principal?: RequestPrincipal } };

/**
 * Before the session middleware: the library's endpoints and /authorize
 * (each falls through when it isn't ours), and the discovery challenge on a
 * `/mcp` 401 (status and body unchanged).
 */
export function registerMcpOAuthRoutes<E extends McpAppEnv>(app: Hono<E>, mcpOAuth: McpOAuth): void {
	app.on(
		["GET", "HEAD", "POST", "OPTIONS"],
		[OAUTH_AS_METADATA_PATH, OAUTH_PRM_PREFIX, `${OAUTH_PRM_PREFIX}/*`, OAUTH_TOKEN_PATH, OAUTH_REGISTER_PATH],
		async (c, next) =>
			(await mcpOAuth.handleProtocolRequest(c.req.raw, c.env, c.executionCtx as ExecutionContext)) ?? next(),
	);
	app.on(
		["GET", "POST"],
		OAUTH_AUTHORIZE_PATH,
		async (c, next) => (await mcpOAuth.handleAuthorize(c.req.raw, c.env, c.executionCtx as ExecutionContext)) ?? next(),
	);

	for (const path of [MCP_PATH, `${MCP_PATH}/*`]) {
		app.use(path, async (c, next) => {
			await next();
			if (c.res.status !== 401 || c.res.headers.has("WWW-Authenticate")) return;
			const presented = /^Bearer\s+\S/i.test(c.req.header("authorization") ?? "");
			const challenge = mcpOAuth.challengeFor(c.req.raw, c.env, presented);
			if (!challenge) return;
			const res = new Response(c.res.body, c.res); // headers may be immutable
			res.headers.set("WWW-Authenticate", challenge);
			c.res = res;
		});
	}
}

/**
 * After the session middleware: `/mcp` takes exactly one auth path
 * (lib/mcp-oauth-token.ts). An OAuth access token is validated by the
 * resource server; anything else already went through the session middleware
 * (which skipped only OAuth-shaped tokens) and arrives with its principal.
 */
export function registerMcpRoutes<E extends McpAppEnv>(app: Hono<E>, mcpOAuth: McpOAuth, mcpHandler: McpFetchHandler): void {
	const serve = async (c: Context<E>) => {
		const ctx = c.executionCtx as ExecutionContext & { props?: McpRequestProps };
		if (isOAuthMcpRequest(new URL(c.req.url).pathname, c.req.raw.headers)) {
			return mcpOAuth.serveMcp(c.req.raw, c.env, ctx);
		}
		const principal: RequestPrincipal | undefined = c.var.principal;
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		ctx.props = { principal };
		return mcpHandler.fetch(c.req.raw, c.env, ctx);
	};
	app.all(MCP_PATH, serve);
	app.all(`${MCP_PATH}/*`, serve);
}

/**
 * Token → `/mcp` props. The library checks the token's hash, expiry and
 * audience; we also require that the user still exists, and rebuild the same
 * `principal` the session middleware would set, so the tools are unchanged.
 */
export async function validateMcpAccessToken(
	authorizationServer: Pick<OAuthAuthorizationServer<Env>, "validateToken">,
	env: Env,
	resource: string,
	token: string,
): Promise<OAuthResourceTokenValidation<McpRequestProps> | null> {
	const validated = await authorizationServer.validateToken<McpGrantProps>(resource, token, env);
	if (!validated) return null;
	const props = validated.props;
	if (!props || props.v !== 1 || typeof props.userId !== "string" || props.userId !== validated.userId) return null;
	const row = await authDb(env.AUTH_DB)
		.select({ id: schema.user.id, email: schema.user.email })
		.from(schema.user)
		.where(eq(schema.user.id, props.userId))
		.get();
	if (!row) return null;
	const grantId = token.split(":")[1];
	return {
		...validated,
		props: {
			principal: { userId: row.id, sessionId: `oauth:${grantId}`, email: row.email, scope: null },
			oauth: {
				clientId: validated.clientId,
				scopes: [...validated.scope],
				mailboxIds: Array.isArray(props.mailboxIds) ? [...props.mailboxIds] : null,
			},
		},
	};
}

// ── /authorize ───────────────────────────────────────────────────

export type OAuthApi = ReturnType<OAuthAuthorizationServer<Env>["getOAuthApi"]>;

/**
 * OAuth helpers outside a `/mcp` request (Settings → Sessions lists and
 * revokes the user's grants, AVE-70). Null when OAuth is off.
 */
const apiServers = new Map<string, OAuthAuthorizationServer<Env>>();
export function mcpOAuthApi(env: Env, requestUrl: URL): OAuthApi | null {
	if (!oauthEnabled(env)) return null;
	const config = mcpOAuthConfig(env, requestUrl);
	if (!config) return null;
	const key = JSON.stringify(config);
	let server = apiServers.get(key);
	if (!server) {
		server = newAuthorizationServer(config);
		apiServers.set(key, server);
	}
	return server.getOAuthApi(env);
}

/** A full app session (not an extension/AutoFill scoped one) or null. */
async function signedInPrincipal(env: Env, request: Request): Promise<RequestPrincipal | null> {
	if (!hasSessionCredentials(request.headers)) return null;
	return principalFromHeaders(env, request.headers);
}

/** Our policy on top of the library's: PKCE (S256) for every client. */
function requirePkce(authRequest: AuthRequest): void {
	if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") {
		throw new AuthorizationError("invalid_request", {
			description: "PKCE with code_challenge_method=S256 is required",
		});
	}
}

/** Mailboxes the user can open right now, from AUTH_DB (the same rows the API and MCP use). */
async function accessibleMailboxes(env: Env, userId: string): Promise<Array<{ id: string; role: string }>> {
	const rows = await listMailboxesForUser(authDb(env.AUTH_DB), userId);
	return rows.map(({ mailboxId, role }) => ({ id: mailboxId, role }));
}

async function showConsent(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	oauth: OAuthApi,
	renderConsent: RenderConsent,
): Promise<Response> {
	const authRequest = await oauth.parseAuthRequest(request);
	try {
		requirePkce(authRequest);
	} catch (error) {
		// The client and its exact redirect URI are validated by now, so the error may go back to it.
		return redirect(authorizationErrorRedirect(authRequest, "invalid_request", (error as AuthorizationError).description));
	}

	const principal = await signedInPrincipal(env, request);
	if (!principal) {
		const url = new URL(request.url);
		return redirect(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	if (principal.scope) {
		return page(403, "Can't continue", "Sign in to Inboxies in this browser to connect an app.");
	}

	const details = await oauth.describeConsent(authRequest);
	const mailboxes = await accessibleMailboxes(env, principal.userId);
	const consent = await oauth.beginConsent(authRequest);
	const view: McpConsentView = {
		handle: consent.handle,
		account: principal.userId,
		email: principal.email,
		client: {
			name: details.clientName,
			domain: details.clientDomain ?? null,
			redirectHost: details.redirectHost,
			redirectIsLoopback: details.redirectIsLoopback,
		},
		requestedScopes: initialConsentScopes(details.scope),
		mailboxes,
	};

	const rendered = await renderConsent(request, env, ctx, view);
	const res = new Response(rendered.body, rendered); // headers may be immutable
	// The library's headers: the binding cookie, no-store and anti-framing.
	for (const [name, value] of consent.headers) {
		if (name.toLowerCase() === "set-cookie") continue;
		res.headers.set(name, value);
	}
	for (const cookie of consent.headers.getSetCookie()) res.headers.append("Set-Cookie", cookie);
	// The URL carries the OAuth request; keep it out of cross-origin Referers
	// (fonts, links). Not "no-referrer": browsers then send `Origin: null` on
	// the form post, which submitConsent's same-origin check refuses.
	res.headers.set("Referrer-Policy", "same-origin");
	return res;
}

async function submitConsent(request: Request, env: Env, oauth: OAuthApi, issuer: string): Promise<Response> {
	// Belt and braces on top of the library's browser-bound handle cookie:
	// a cross-site form post is refused outright.
	const origin = request.headers.get("origin");
	if (origin !== null && origin.toLowerCase() !== issuer) {
		return page(403, "Can't continue", "This request didn't come from Inboxies.");
	}
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite !== null && fetchSite !== "same-origin") {
		return page(403, "Can't continue", "This request didn't come from Inboxies.");
	}

	const principal = await signedInPrincipal(env, request);
	if (!principal || principal.scope) {
		return page(401, "Signed out", "Your session ended. Start again from your app.");
	}

	let form: FormData;
	try {
		form = await request.clone().formData();
	} catch {
		return page(400, "Can't continue", "This form is invalid. Start again from your app.");
	}
	const handle = String(form.get(CONSENT_FIELDS.handle) ?? "");
	const decision = String(form.get(CONSENT_FIELDS.decision) ?? "");
	if (!handle) return page(400, "Can't continue", "This form is invalid. Start again from your app.");
	if (String(form.get(CONSENT_FIELDS.account) ?? "") !== principal.userId) {
		return page(409, "Account changed", "You switched accounts after this page opened. Start again from your app.");
	}

	if (decision !== "approve") {
		const denied = await oauth.denyConsent(request, handle);
		return new Response(null, { status: 302, headers: denied.headers });
	}

	// What the user picked, checked against their mailboxes as of now (not
	// the list the page showed) before the handle is spent.
	const selection = validateConsentSelection(
		{
			scopes: form.getAll(CONSENT_FIELDS.scope).map(String),
			mailboxIds: form.getAll(CONSENT_FIELDS.mailbox).map(String),
		},
		(await accessibleMailboxes(env, principal.userId)).map((m) => m.id),
	);
	if (!selection.ok) {
		return page(400, "Can't continue", `${selection.error} Go back and try again.`);
	}

	const approved = await oauth.approveConsent(request, handle, { scope: [...selection.scopes] });
	requirePkce(approved.request);
	const props: McpGrantProps = { v: 1, userId: principal.userId, mailboxIds: selection.mailboxIds };
	const { redirectTo } = await oauth.completeAuthorization({
		request: approved.request,
		userId: principal.userId,
		metadata: {},
		scope: approved.request.scope,
		props,
	});
	approved.headers.set("Location", redirectTo);
	return new Response(null, { status: 302, headers: approved.headers });
}

function redirect(location: string): Response {
	return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Error pages only; the consent page itself is the web app's /authorize route. */
const PAGE_STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f1f1f}
@media (prefers-color-scheme:dark){:root{--bg:#191919;--fg:#ececec}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,-apple-system,system-ui,sans-serif}
main{max-width:440px;margin:0 auto;padding:48px 16px}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 12px}`;

function page(status: number, title: string, message: string): Response {
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
	return new Response(html, {
		status,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Content-Security-Policy": "frame-ancestors 'none'",
			"X-Frame-Options": "DENY",
		},
	});
}
