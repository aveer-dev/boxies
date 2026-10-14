// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * DNS TXT proof of domain control before a bring-your-own domain is provisioned.
 *
 * The expected value is an HMAC over the domain and the claimant (the sign-up
 * username + password, or the admin's account key), keyed with a server
 * secret. It is stateless, and someone who copies a TXT value the real owner
 * published can't reuse it for their own claim.
 */

export const DOMAIN_VERIFICATION_LABEL = "_inboxies-verify";
const VALUE_PREFIX = "inboxies-verify=";

export interface DomainVerificationChallenge {
	recordName: string;
	recordType: "TXT";
	recordValue: string;
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Claimant for public sign-up: never stores the password, only binds to it. */
export async function signupClaimant(username: string, password: string): Promise<string> {
	return `signup:${username.trim().toLowerCase()}:${await sha256Hex(password)}`;
}

export async function domainVerificationChallenge(
	secret: string,
	domain: string,
	claimant: string,
): Promise<DomainVerificationChallenge> {
	const normalized = domain.trim().toLowerCase();
	const mac = await hmacHex(secret, `inboxies-domain-verification|${normalized}|${claimant}`);
	return {
		recordName: `${DOMAIN_VERIFICATION_LABEL}.${normalized}`,
		recordType: "TXT",
		recordValue: `${VALUE_PREFIX}${mac.slice(0, 32)}`,
	};
}

/** TXT strings published at `name`, via DNS-over-HTTPS. Empty on any failure. */
export async function lookupTxtRecords(name: string): Promise<string[]> {
	try {
		const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
		const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
		if (!res.ok) return [];
		const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
		return (body.Answer ?? [])
			.filter((a) => a.type === 16)
			.map((a) =>
				// TXT data arrives as one or more quoted chunks: "abc" "def"
				(a.data.match(/"((?:[^"\\]|\\.)*)"/g) ?? [a.data])
					.map((chunk) => chunk.replace(/^"|"$/g, ""))
					.join(""),
			);
	} catch {
		return [];
	}
}

export async function isDomainVerified(
	challenge: DomainVerificationChallenge,
): Promise<boolean> {
	const values = await lookupTxtRecords(challenge.recordName);
	return values.some((v) => v.trim() === challenge.recordValue);
}

/** Body for a 428 telling the client exactly which record to publish. */
export function verificationRequiredBody(
	domain: string,
	challenge: DomainVerificationChallenge,
) {
	return {
		error: `Verify you own ${domain}: add a TXT record named ${challenge.recordName} with value ${challenge.recordValue}, then try again.`,
		code: "domain_verification_required",
		verification: challenge,
	};
}
