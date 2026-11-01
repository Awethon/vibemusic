<script lang="ts">
	import { albumArt, coverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import { COVER_PX } from '../tuning.ts';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';
	import { placeholderStyle } from './placeholder.ts';
	import { retryCover } from './retryCover.ts';

	let {
		albumId,
		size = COVER_PX.fallback,
		eager = false,
		icon
	}: { albumId: string | null | undefined; size?: number; eager?: boolean; icon?: IconName } = $props();
</script>

{#if albumId && session.credentials}
	<img
		src={coverUrl(session.credentials, albumId, size)}
		style={placeholderStyle(albumArt.get(albumId))}
		{@attach retryCover}
		alt=""
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		draggable="false"
	/>
{:else}
	<span class="cover-icon"
		>{#if icon}<Icon name={icon} />{/if}</span
	>
{/if}
