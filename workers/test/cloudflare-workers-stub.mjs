/**
 * Node stand-in for `cloudflare:workers` (see ts-ext-hooks.mjs). Only the
 * base classes libraries test against with `instanceof` / `extends`.
 */
export class WorkerEntrypoint {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}
}

export class DurableObject {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}
}
