<script lang="ts">
	import { checkConnection, connection } from '../connection.svelte.ts';
	import { library, resyncLibrary } from '../library/library.svelte.ts';
	import { relativeTime } from './format.ts';

	let retrying = $state(false);

	const message = $derived.by(() => {
		if (!library.meta) return '';
		if (connection.unreachable) return 'Navidrome isn’t reachable · showing your saved library';
		if (library.error) return `Couldn’t update your library · last synced ${relativeTime(library.meta.syncedAt)}`;
		return '';
	});

	async function retry() {
		retrying = true;
		try {
			if (connection.unreachable) await checkConnection();
			else await resyncLibrary();
		} finally {
			retrying = false;
		}
	}
</script>

{#if message}
	<div id="connection-note" role="status">
		<span class="cn-dot"></span>
		<span>{message}</span>
		<button type="button" disabled={retrying} onclick={retry}>{retrying ? 'Retrying…' : 'Retry'}</button>
	</div>
{/if}
