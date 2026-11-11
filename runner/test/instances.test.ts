/**
 * The runner's pure behaviour.
 *
 * The service runs on node and reads its configuration from the
 * environment, so the environment is set before the modules are imported —
 * an import is hoisted above any statement in this file.
 */
process.env.API_KEY = 'test-api-key';
process.env.DATA_DIR = '/tmp/vibesdk-runner-test';
process.env.RUNNER_HOST = 'runner.test';

const { instanceDetail, previewUrlFor, sanitizeId } = await import(
	'../src/instances.ts'
);
const { GetInstanceResponseSchema } = await import('../protocol.ts');

describe('sanitizeId', () => {
	it('keeps a DNS-label-shaped id as it is', () => {
		expect(sanitizeId('b1fe358d-1876-43ae-b7c2-642c35a59bda')).toBe(
			'b1fe358d-1876-43ae-b7c2-642c35a59bda',
		);
	});

	it('lowercases and replaces what a DNS label cannot hold', () => {
		expect(sanitizeId('Todo List!')).toBe('todo-list');
	});

	it('cuts an id to the length a label can carry', () => {
		expect(sanitizeId('a'.repeat(80))).toHaveLength(40);
	});

	it('never returns an empty label', () => {
		expect(sanitizeId('!!!')).toBe('instance');
	});
});

describe('previewUrlFor', () => {
	it('ends the path-based URL in a slash', () => {
		// Without the slash a page served from /p/<id> resolves its
		// relative asset references against /p/, and the stylesheet is
		// asked for as /p/styles.css — which is not a preview path.
		expect(previewUrlFor('abc')).toBe('https://runner.test/p/abc/');
	});
});

describe('instanceDetail', () => {
	it('is a payload the protocol accepts', () => {
		const instance = {
			id: 'abc',
			projectName: 'Todos',
			createdAt: new Date().toISOString(),
			dir: '/data/instances/abc',
			phase: 'serving',
			errors: [],
			port: 4173,
			devProcess: undefined,
			envVars: {},
			initCommand: 'bun run dev',
			lastAccessedAt: Date.now(),
			stdout: '',
			stderr: '',
			basePath: null,
		};

		const parsed = GetInstanceResponseSchema.parse({
			success: true,
			instance: instanceDetail(instance as never),
		});

		expect(parsed.instance?.previewURL).toBe('https://runner.test/p/abc/');
	});
});
