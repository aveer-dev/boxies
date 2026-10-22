// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail } from "./index";
import { handleEmailSendingQueueBatch } from "./lib/email-sending-queue";
import {
	handleOutboundSendBatch,
	handleOutboundSendDeadLetterBatch,
	OUTBOUND_SEND_DLQ,
	OUTBOUND_SEND_QUEUE,
} from "./lib/outbound-send-queue";
import { EmailMCP } from "./mcp";
import { createMcpOAuth, registerMcpOAuthRoutes, registerMcpRoutes } from "./mcp/oauth";
import { strictMailboxId } from "./lib/mailbox-routing";
import { authDb, authorizeMailboxAccess } from "./auth/authz";
import type { RequestPrincipal } from "./auth/principal";
import type { Operator } from "./auth/operators";
import { operatorMiddleware, sessionMiddleware } from "./auth/middleware";
import { handleBetterAuthRequest } from "./routes/better-auth";
import { registerOpsRoutes } from "./routes/ops";
import { runScheduledMaintenance } from "./lib/maintenance";
import { mailboxIdFromAgentsUrl } from "../shared/agent-conversations";
import { AUTH_BASE_PATH } from "./auth";
import { webHostRedirect } from "./lib/web-host-redirect";
import type { Env } from "./types";
import type { McpConsentView } from "../shared/mcp-consent";

export { MailboxDO } from "./durableObject";
export { ExportJobDO } from "./durableObject/export-job";
export { EmailAgent } from "./agent";
export { EmailMCP } from "./mcp";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
		/**
		 * Set only by the Worker's GET /authorize after it validated the OAuth
		 * request and the session (workers/mcp/oauth.ts); app/routes/authorize.tsx
		 * renders it. Absent on every other request.
		 */
		mcpConsent?: McpConsentView;
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

import { isPublicAuthPath } from "./lib/auth-paths";
import { serviceEndedErrorForMailbox } from "./lib/domain-service";

export { isPublicAuthPath };

type AppVariables = { principal?: RequestPrincipal; operator?: Operator };
// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// The web app lives on APP_BASE_URL; old hosts (inboxies.email) send browsers there.
app.use("*", async (c, next) => webHostRedirect(c.env, c.req.raw) ?? next());

// Better Auth (AUTH_DB): an allowlisted subset of its routes.
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => handleBetterAuthRequest(c.env, c.req.raw));

// Operators: Cloudflare Access only, and only on /ops/*.
app.use("/ops/*", operatorMiddleware);
registerOpsRoutes(app);

// MCP server endpoint — used by AI coding tools (ProtoAgent, Claude Code, Cursor, etc.)
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });

// OAuth 2.1 for /mcp (AVE-67, workers/mcp/oauth.ts): metadata, /token,
// /register and /authorize answer before the session middleware (anything
// they don't own falls through unchanged), and a /mcp 401 names the resource
// metadata so OAuth clients can discover the authorization server.
const mcpOAuth = createMcpOAuth(mcpHandler, {
	// The consent page is the web app's /authorize route (AVE-68), rendered
	// with the view the Worker built; the Worker adds the security headers.
	renderConsent: (request, env, ctx, view) =>
		requestHandler(request, { cloudflare: { env, ctx }, mcpConsent: view }),
});
registerMcpOAuthRoutes(app, mcpOAuth);

// Everyone else: a Better Auth session.
app.use("*", sessionMiddleware);

// /mcp: an OAuth access token goes to the resource server; anything else
// already went through the session middleware (Bearer session token or
// cookie), unchanged. Must be before API routes and React Router catch-all.
registerMcpRoutes(app, mcpOAuth, mcpHandler);

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing - must be before React Router catch-all
app.all("/agents/*", async (c) => {
	const mailboxId = mailboxIdFromAgentsUrl(c.req.url);
	// The agent's tools act on this raw string, so it must already be the
	// canonical id that gets authorized: no %-escapes, +tags or <brackets>.
	if (!mailboxId || strictMailboxId(mailboxId) !== mailboxId) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const authz = await authorizeMailboxAccess(authDb(c.env.AUTH_DB), c.get("principal")?.userId, mailboxId);
	if (!authz.ok) {
		return c.json({ error: authz.error }, authz.status);
	}
	// The AI agent is part of the service, which ends with the subscription.
	const ended = await serviceEndedErrorForMailbox(c.env, authz.mailboxId);
	if (ended) return c.json(ended, 403);
	const response = await routeAgentRequest(c.req.raw, c.env);
	if (response) return response;
	return c.text("Agent not found", 404);
});

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

// Export the Hono app as the default export with email + queue handlers
export default {
	fetch: app.fetch,
	async email(
		message: ForwardableEmailMessage,
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await receiveEmail(message, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
	async queue(batch: MessageBatch<unknown>, env: Env) {
		switch (batch.queue) {
			case OUTBOUND_SEND_QUEUE:
				await handleOutboundSendBatch(batch, env);
				return;
			case OUTBOUND_SEND_DLQ:
				await handleOutboundSendDeadLetterBatch(batch, env);
				return;
			default:
				// email-sending-events (Email Sending lifecycle events).
				await handleEmailSendingQueueBatch(batch, env);
		}
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduledMaintenance(env, new Date(controller.scheduledTime)));
	},
};
