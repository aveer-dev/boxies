/**
 * Node ESM loader: resolve extensionless relative imports to `.ts`.
 * Lets tests import the Wrangler/Vite worker graph under strip-types.
 *
 * `agents` imports `cloudflare:workers`, which Node cannot load, so it
 * resolves to a stand-in that addresses mock DO namespaces directly.
 * Other packages importing `cloudflare:workers` directly (the OAuth provider)
 * get a stub with its base classes.
 */
const AGENTS_STUB = new URL("./agents-stub.mjs", import.meta.url).href;
const CLOUDFLARE_WORKERS_STUB = new URL("./cloudflare-workers-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "agents") {
		return { url: AGENTS_STUB, shortCircuit: true };
	}
	if (specifier === "cloudflare:workers") {
		return { url: CLOUDFLARE_WORKERS_STUB, shortCircuit: true };
	}
	if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
		try {
			return await nextResolve(`${specifier}.ts`, context);
		} catch {
			try {
				return await nextResolve(`${specifier}/index.ts`, context);
			} catch {
				return nextResolve(specifier, context);
			}
		}
	}
	return nextResolve(specifier, context);
}
