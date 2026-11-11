// The RPC target.
//
// Cloudflare's Durable Objects call each other over RPC: a stub is a
// reference to another object, and a method call on it is a message. The
// base class is a marker — the transport is the runtime's business.
//
// In this runtime the transport is the session registry: a stub is a
// session's name, and a method call is routed to the session that owns it.

export class RpcTarget {
	/** The name of the session this target belongs to, when it has one. */
	readonly __sessionName: string | undefined;

	constructor(sessionName?: string) {
		this.__sessionName = sessionName;
	}
}
