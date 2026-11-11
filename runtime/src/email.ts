// The Cloudflare email module, for Node.
//
// The `agents` SDK sends email through the platform's `EmailMessage`. Here
// it is a plain object: the raw message and its headers, which is what the
// transport needs.

export class EmailMessage {
	readonly from: string;
	readonly to: string;
	raw: string;

	constructor(from: string, to: string, raw: string) {
		this.from = from;
		this.to = to;
		this.raw = raw;
	}

	/** The headers of the raw message, parsed out of it. */
	headers(): Record<string, string> {
		const headers: Record<string, string> = {};
		for (const line of this.raw.split('\n')) {
			if (line.trim() === '') break;
			const separator = line.indexOf(':');
			if (separator === -1) continue;
			headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
		}
		return headers;
	}

	setHeader(name: string, value: string): void {
		this.raw = `${name}: ${value}\n${this.raw}`;
	}

	getHeader(name: string): string | null {
		return this.headers()[name.toLowerCase()] ?? null;
	}
}
