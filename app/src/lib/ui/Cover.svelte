<script lang="ts">
	import { coverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';

	let { albumId, size = 300, round = false }: { albumId: string | null | undefined; size?: number; round?: boolean } = $props();
</script>

{#if albumId && session.credentials}
	<img class="cover" class:round src={coverUrl(session.credentials, albumId, size)} alt="" loading="lazy" decoding="async" draggable="false" />
{:else}
	<div class="cover empty" class:round></div>
{/if}
