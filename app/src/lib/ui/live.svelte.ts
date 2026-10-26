import { library } from '../library/library.svelte.ts';

export function live<T>(load: () => Promise<T>, initial: T) {
	const state = $state({ value: initial, loaded: false });
	$effect(() => {
		if (library.status !== 'ready') return;
		void library.revision;
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
