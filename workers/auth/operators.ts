// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Operators reach `/ops/*` through Cloudflare Access. Access identities are
 * never app users: an Access JWT grants nothing outside `/ops`, and an app
 * session grants nothing inside it.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../types";

export type Operator = { email: string; sub: string };

function readCookie(header: string | null, name: string): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf("=");
		if (eq === -1 || trimmed.slice(0, eq) !== name) continue;
		try {
			return decodeURIComponent(trimmed.slice(eq + 1));
		} catch {
			return trimmed.slice(eq + 1);
		}
	}
	return undefined;
}

function accessUrls(teamDomain: string) {
	const certsPath = "/cdn-cgi/access/certs";
	const teamUrl = new URL(teamDomain);
	const issuer = teamUrl.origin;
	const certsUrl = teamUrl.pathname.endsWith(certsPath) ? teamUrl : new URL(certsPath, issuer);
	return { issuer, certsUrl };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The Access-authenticated operator for these headers, or null (fail closed). */
export async function verifyOperator(env: Env, headers: Headers): Promise<Operator | null> {
	const { POLICY_AUD, TEAM_DOMAIN } = env;
	if (!POLICY_AUD || !TEAM_DOMAIN) return null;
	const token =
		headers.get("cf-access-jwt-assertion") || readCookie(headers.get("cookie"), "CF_Authorization");
	if (!token) return null;
	try {
		const { issuer, certsUrl } = accessUrls(TEAM_DOMAIN);
		let jwks = jwksCache.get(certsUrl.href);
		if (!jwks) {
			jwks = createRemoteJWKSet(certsUrl);
			jwksCache.set(certsUrl.href, jwks);
		}
		const { payload } = await jwtVerify(token, jwks, { issuer, audience: POLICY_AUD });
		const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
		const sub = typeof payload.sub === "string" ? payload.sub : "";
		if (!email && !sub) return null;
		return { email, sub };
	} catch {
		return null;
	}
}
