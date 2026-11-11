// The Cloudflare email module, on Node.
//
// The `agents` SDK imports `EmailMessage` from "cloudflare:email" for the
// email binding. The host does not send email: the application's mail goes
// through Verity, not through a Workers binding.
//
// The class is here so the SDK loads; sending is what fails, and it fails
// with a message that says why.

export class EmailMessage {
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: unknown;

	constructor(from: string, to: string, raw: unknown) {
		this.from = from;
		this.to = to;
		this.raw = raw;
		this.headers = new Headers();
	}

	/** The host does not send email. */
	async send(): Promise<void> {
		throw new Error(
			'Email is not available on the host runtime: the builder sends its mail through Verity.',
		);
	}

	setHeader(key: string, value: string): void {
		this.headers.set(key, value);
	}

	getHeader(key: string): string | null {
		return this.headers.get(key);
	}

	addHeader(key: string, value: string): void {
		this.headers.append(key, value);
	}
}

export { EmailMessage as default };
