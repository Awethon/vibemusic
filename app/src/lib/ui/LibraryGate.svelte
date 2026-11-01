<script lang="ts">
	import type { Snippet } from 'svelte';
	import { checkConnection, connection } from '../connection.svelte.ts';
	import { library, resyncLibrary } from '../library/library.svelte.ts';
	import FirstSync from './FirstSync.svelte';

	let { children }: { children: Snippet } = $props();
</script>

{#if library.status === 'ready' && library.meta?.tracks === 0}
	<div class="first-run-problem">
		<h1 class="display">Your library is empty</h1>
		<p>
			Navidrome hasn’t found any music yet. Add albums to its music folder and run a scan in Navidrome — vibemusic picks them up within a
			minute.
		</p>
	</div>
{:else if library.status === 'ready'}
	{@render children()}
{:else if library.status === 'error'}
	<div class="first-run-problem">
		<h1 class="display">{connection.unreachable ? 'Can’t reach Navidrome' : 'Couldn’t load your library'}</h1>
		<p>{connection.unreachable ? `vibemusic is trying ${new URL(NAVIDROME_TARGET).host} again every few seconds.` : library.error}</p>
		<button class="ghost" type="button" onclick={() => (connection.unreachable ? void checkConnection() : void resyncLibrary())}
			>Retry</button
		>
	</div>
{:else if library.status === 'syncing'}
	<FirstSync />
{/if}
