// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_ISSUERS = [
	"accounts.google.com",
	"https://accounts.google.com",
] as const;

const GOOGLE_JWKS = createRemoteJWKSet(
	new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export interface GoogleIdentityClaims {
	sub: string;
	email?: string;
	emailVerified?: boolean;
	name?: string;
}

/**
 * Verify a Google ID token from Credential Manager / Sign in with Google.
 * `audience` must be the OAuth Web client ID (GOOGLE_CLIENT_ID).
 */
export async function verifyGoogleIdentityToken(
	idToken: string,
	audience: string,
): Promise<GoogleIdentityClaims> {
	const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
		issuer: [...GOOGLE_ISSUERS],
		audience,
	});

	if (typeof payload.sub !== "string" || !payload.sub) {
		throw new Error("Google identity token missing subject");
	}

	return {
		sub: payload.sub,
		email: typeof payload.email === "string" ? payload.email : undefined,
		emailVerified:
			payload.email_verified === true || payload.email_verified === "true",
		name: typeof payload.name === "string" ? payload.name : undefined,
	};
}
