/**
 * Node ESM loader: resolve extensionless relative imports to `.ts`.
 * Lets tests import the Wrangler/Vite worker graph under strip-types.
 */
export async function resolve(specifier, context, nextResolve) {
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
