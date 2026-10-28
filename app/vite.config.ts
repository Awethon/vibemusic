import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { lookup } from 'node:dns/promises';
import { defineConfig } from 'vitest/config';

const navidrome = process.env.NAVIDROME_URL ?? 'http://127.0.0.1:4534';
const relay = process.env.RELAY_URL ?? 'http://127.0.0.1:4600';
const building = process.argv.includes('build');

async function navidromeProxy() {
	const navidromeUrl = new URL(navidrome);
	const { address } = await lookup(navidromeUrl.hostname, { family: 4 });
	const target = `${navidromeUrl.protocol}//${address}${navidromeUrl.port ? `:${navidromeUrl.port}` : ''}`;
	return { ...Object.fromEntries(['/auth', '/api', '/rest', '/share/s/', '/share/img/'].map((path) => [path, { target, headers: { host: navidromeUrl.host } }])), '/relay': { target: relay, ws: true }, '^/radio/': { target: relay } };
}

const proxied = building ? {} : await navidromeProxy();

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	define: { NAVIDROME_TARGET: building ? 'location.origin' : JSON.stringify(navidrome) },
	server: { port: 5190, strictPort: true, proxy: proxied },
	preview: { port: 5191, strictPort: true, proxy: proxied },
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
	worker: { format: 'es' },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
