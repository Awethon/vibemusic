<script lang="ts" module>
	import { COVER_RETRY } from '../tuning.ts';

	// Fetched by hand instead of <img src> so we can retry 429s from Navidrome's cover throttle
	// and look at the headers. Navidrome serves its "no artist photo" placeholder without an ETag
	// (real artwork carries one), so a response without an ETag means "no photo" and we show
	// an album cover instead. Results are cached per URL for the session.
	const photos = new Map<string, Promise<string | null>>();

	async function loadPhoto(url: string, attempt = 0): Promise<string | null> {
		const response = await fetch(url);
		if (response.status === 429 && attempt < COVER_RETRY.attempts) {
			await new Promise((resolve) => setTimeout(resolve, COVER_RETRY.baseDelayMs * 2 ** attempt + Math.random() * COVER_RETRY.jitterMs));
			return loadPhoto(url, attempt + 1);
		}
		return response.ok && response.headers.has('etag') ? URL.createObjectURL(await response.blob()) : null;
	}

	function photoOf(url: string) {
		let photo = photos.get(url);
		if (!photo) {
			photo = loadPhoto(url).catch(() => null);
			photos.set(url, photo);
		}
		return photo;
	}
</script>

<script lang="ts">
	import { albumArt, artistArt, artistPhotoUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import Cover from './Cover.svelte';
	import { placeholderStyle } from './placeholder.ts';

	let { artistId, fallbackAlbumId, size }: { artistId: string; fallbackAlbumId: string; size: number } = $props();

	let photo = $state<string | null | undefined>(undefined);
	const placeholder = $derived(placeholderStyle(artistArt.get(artistId) ?? albumArt.get(fallbackAlbumId)));

	$effect(() => {
		const credentials = session.credentials;
		if (!credentials) return;
		let current = true;
		photo = undefined;
		void photoOf(artistPhotoUrl(credentials, artistId, size)).then((found) => {
			if (current) photo = found;
		});
		return () => {
			current = false;
		};
	});
</script>

{#if photo}
	<img src={photo} style={placeholder} alt="" decoding="async" draggable="false" />
{:else if photo === null}
	<Cover albumId={fallbackAlbumId} {size} />
{:else}
	<span class="photo-pending" style={placeholder}></span>
{/if}
