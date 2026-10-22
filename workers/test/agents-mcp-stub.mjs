/**
 * Node stand-in for `agents/mcp` (see ts-ext-hooks.mjs). The real McpAgent is
 * a Durable Object that pulls in `cloudflare:email`; tests only need a base
 * class whose `env` and `props` they set before calling `init()`, then connect
 * `server` to an in-memory MCP client.
 */
export class McpAgent {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}
}
