// Reactive result of a local-library query: reruns whenever the library is resynced
// (library.revision) or a table it reads is edited locally (library.patched). `reads` names those
// tables; the default covers likes and play counts, [] is for queries that show neither.
// Uses $effect, so call it during component initialisation.
import { library, type PatchedTable } from '../library/library.svelte.ts';

export function live<T>(load: () => Promise<T>, initial: T, reads: readonly PatchedTable[] = ['track', 'album']) {
	const state = $state({ value: initial, loaded: false });
	$effect(() => {
		if (library.status !== 'ready') return;
		void library.revision;
		for (const table of reads) void library.patched[table];
		// Ignore a slow earlier query that resolves after a newer one has started.
		let current = true;
		load().then(
			(value) => {
				if (!current) return;
				state.value = value;
				state.loaded = true;
			},
			() => {
				if (current) state.loaded = true;
			}
		);
		return () => {
			current = false;
		};
	});
	return state;
}
