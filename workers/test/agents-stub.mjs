/**
 * Node stand-in for the `agents` package (see ts-ext-hooks.mjs).
 * Mock namespaces have no partyserver name handshake, so return the stub.
 */
export async function getAgentByName(namespace, name) {
	return namespace.get(namespace.idFromName(name));
}
