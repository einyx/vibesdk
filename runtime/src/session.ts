// The session runtime.
//
// A Durable Object is three things at once: a stateful session with its own
// storage, a WebSocket endpoint, and a target other code calls into. This
// is the Node equivalent — one process, many sessions.
//
// A session is named. The name is its address: `idFromName` and `get` are
// how the SDK reaches another session, and it is the same name the
// workspace, the git history and the preview use.
//
// Sessions are lazy: a session is created when something asks for it, and
// it keeps its state in a SQLite file on a volume, so a restarted process
// finds the state where it left it.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeContext } from './context.ts';
import { SqliteStorage } from './storage.ts';

export interface SessionInstance {
	fetch?(request: Request): Response | Promise<Response>;
	webSocketMessage?(socket: unknown, message: string | ArrayBuffer): void;
	webSocketClose?(socket: unknown, code: number, reason: string): void;
	webSocketError?(socket: unknown, error: unknown): void;
	alarm?(): void | Promise<void>;
}

export type SessionConstructor = new (ctx: unknown, env: unknown) => SessionInstance;

export interface SessionNamespace {
	idFromName(name: string): { name: string };
	idFromString(id: string): { name: string };
	get(id: { name: string }): SessionStub;
	getByName(name: string): SessionStub;
}

export interface SessionStub {
	readonly name: string;
	/** Every method call on a stub goes to the session that owns the name. */
	[method: string]: unknown;
}

export interface SessionRuntimeOptions {
	/** Where the sessions' SQLite files live. */
	dataDir: string;
	/** The environment the sessions are given. */
	env: Record<string, unknown>;
}

export class SessionRuntime {
	private readonly options: SessionRuntimeOptions;
	private readonly sessions = new Map<string, { instance: SessionInstance; context: NodeContext }>();
	private readonly sockets = new Map<unknown, string>();
	private readonly databases = new Map<string, DatabaseSync>();

	constructor(options: SessionRuntimeOptions) {
		this.options = options;
		mkdirSync(this.options.dataDir, { recursive: true });
	}

	/** The namespace a session class is reached through. */
	namespace(constructor: SessionConstructor): SessionNamespace {
		const className = constructor.name;

		return {
			idFromName: (name: string) => ({ name }),
			idFromString: (id: string) => ({ name: id }),
			get: (id: { name: string }) => this.stub(className, id.name),
			getByName: (name: string) => this.stub(className, name),
		};
	}

	/** A stub: a reference to a session, by name. */
	private stub(className: string, name: string): SessionStub {
		return new Proxy({ name } as SessionStub, {
			get: (_target: SessionStub, property: string) => {
				if (property === 'name') return name;
				if (typeof property !== 'string') return undefined;
				const instance = this.session(className, name) as unknown as Record<string, unknown>;
				const value = instance[property];
				// A method is called on the session; anything else — a
				// getter, a field — is the session's own.
				if (typeof value !== 'function') return value;
				return (...args: unknown[]) => value.apply(instance, args);
			},
		});
	}

	/** The session with this name, created if it is not there yet. */
	session(className: string, name: string): SessionInstance {
		const key = `${className}/${name}`;
		const existing = this.sessions.get(key);
		if (existing) return existing.instance;

		const database = this.database(className, name);
		const storage = new SqliteStorage(database);
		const context = new NodeContext(name, storage, (reason) => {
			this.sessions.delete(key);
			this.sockets.clear();
			void reason;
		});
		const Constructor = this.constructorFor(className);
		const instance = new Constructor(context, this.options.env);
		this.sessions.set(key, { instance, context });
		return instance;
	}

	/** The classes the runtime can hold sessions of. */
	private constructors = new Map<string, SessionConstructor>();

	/** Register a session class, so a stub can find it by name. */
	register(constructor: SessionConstructor): SessionNamespace {
		this.constructors.set(constructor.name, constructor);
		return this.namespace(constructor);
	}

	private constructorFor(className: string): SessionConstructor {
		const constructor = this.constructors.get(className);
		if (!constructor) throw new Error(`no session class named ${className} is registered`);
		return constructor;
	}

	/** A session's database, on disk. */
	private database(className: string, name: string): DatabaseSync {
		const key = `${className}/${name}`;
		const existing = this.databases.get(key);
		if (existing) return existing;
		const directory = path.join(this.options.dataDir, className);
		mkdirSync(directory, { recursive: true });
		const database = new DatabaseSync(path.join(directory, `${name}.sqlite`));
		this.databases.set(key, database);
		return database;
	}

	/** Hand a request to the session that owns the name in the path. */
	async fetch(className: string, name: string, request: Request): Promise<Response> {
		const instance = this.session(className, name);
		if (!instance.fetch) return new Response('Not implemented', { status: 501 });
		return instance.fetch(request);
	}

	/** A message arrived on a socket: give it to the session that holds it. */
	async webSocketMessage(socket: unknown, message: string | ArrayBuffer): Promise<void> {
		const key = this.sockets.get(socket);
		if (!key) return;
		const [className, name] = key.split('/', 2);
		const instance = this.session(className, name);
		instance.webSocketMessage?.(socket, message);
	}

	/** A socket closed. */
	async webSocketClose(socket: unknown, code: number, reason: string): Promise<void> {
		const key = this.sockets.get(socket);
		if (!key) return;
		const [className, name] = key.split('/', 2);
		const instance = this.session(className, name);
		instance.webSocketClose?.(socket, code, reason);
	}

	/** Remember which session a socket belongs to. */
	bind(socket: unknown, className: string, name: string): void {
		this.sockets.set(socket, `${className}/${name}`);
	}

	/** The sessions this runtime is holding. */
	names(): string[] {
		return [...this.sessions.keys()];
	}

	/** Close every session's database. */
	close(): void {
		for (const database of this.databases.values()) database.close();
		this.databases.clear();
		this.sessions.clear();
	}
}
