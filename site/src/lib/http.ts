// Small request helpers shared by the site's POST endpoints (/api/contact and
// /api/requests). No imports, so test/requests.test.mjs can load them in node.

/**
 * The body, or null once it runs past `limit`. Stops reading there, so an
 * oversized post is never held in memory (a chunked post has no content-length).
 */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

/**
 * Who a rate limit counts. An IPv6 visitor holds a whole /64 and can rotate
 * through it, so the key is that prefix; IPv4 (and IPv4-mapped) as is.
 */
export function rateKey(ip: string | null): string {
	if (!ip) return "anon";
	if (!ip.includes(":") || ip.includes(".")) return ip;
	const [head, tail] = ip.toLowerCase().split("::");
	const groups = head ? head.split(":") : [];
	if (tail !== undefined) {
		const rest = tail ? tail.split(":") : [];
		groups.push(...Array<string>(Math.max(0, 8 - groups.length - rest.length)).fill("0"), ...rest);
	}
	return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function hostOf(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}
