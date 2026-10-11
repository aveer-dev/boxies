/**
 * Node ESM loader: stand in for the `cloudflare:workers` runtime module so
 * tests can load packages built on it (e.g. partyserver, which the Agents
 * SDK's Agent class and getAgentByName sit on).
 */
const STUB_URL = "inboxies-test:cloudflare-workers";

const STUB_SOURCE = `
export class DurableObject {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}
}
export const env = {};
`;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "cloudflare:workers") {
		return { url: STUB_URL, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url === STUB_URL) {
		return { format: "module", source: STUB_SOURCE, shortCircuit: true };
	}
	return nextLoad(url, context);
}
