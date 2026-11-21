/**
 * An in-memory KV namespace with the subset of the API
 * @cloudflare/workers-oauth-provider uses (get, getWithMetadata, put, delete,
 * list with prefix/cursor, expirations), for the MCP OAuth tests.
 */

export function memoryKV() {
	const store = new Map(); // key → { value, metadata, expiration }
	const live = (key) => {
		const entry = store.get(key);
		if (!entry) return null;
		if (entry.expiration && entry.expiration <= Date.now() / 1000) {
			store.delete(key);
			return null;
		}
		return entry;
	};
	const decode = (value, type) => {
		const t = typeof type === "string" ? type : type?.type;
		return t === "json" ? JSON.parse(value) : value;
	};
	return {
		store,
		async get(key, type) {
			const entry = live(key);
			return entry ? decode(entry.value, type) : null;
		},
		async getWithMetadata(key, type) {
			const entry = live(key);
			return entry ? { value: decode(entry.value, type), metadata: entry.metadata ?? null } : { value: null, metadata: null };
		},
		async put(key, value, opts = {}) {
			const expiration = opts.expiration ?? (opts.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined);
			store.set(key, { value: typeof value === "string" ? value : JSON.stringify(value), metadata: opts.metadata, expiration });
		},
		async delete(key) {
			store.delete(key);
		},
		async list({ prefix = "", limit = 1000, cursor } = {}) {
			const names = [...store.keys()].filter((k) => k.startsWith(prefix) && live(k)).sort();
			const start = cursor ? Number(cursor) : 0;
			const page = names.slice(start, start + limit);
			const done = start + limit >= names.length;
			return {
				keys: page.map((name) => ({ name, metadata: store.get(name).metadata, expiration: store.get(name).expiration })),
				list_complete: done,
				...(done ? {} : { cursor: String(start + limit) }),
			};
		},
	};
}
