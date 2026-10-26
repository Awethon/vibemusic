<script lang="ts">
	import { coverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';

	let { albumId, size = 300, eager = false }: { albumId: string | null | undefined; size?: number; eager?: boolean } = $props();
</script>

{#if albumId && session.credentials}
	<img src={coverUrl(session.credentials, albumId, size)} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable="false" />
{:else}
	<img alt="" draggable="false" />
{/if}
