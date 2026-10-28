<script lang="ts" module>
	const photos = new Map<string, Promise<string | null>>();

	function photoOf(url: string) {
		let photo = photos.get(url);
		if (!photo) {
			photo = fetch(url)
				.then(async (response) => (response.ok && response.headers.has('etag') ? URL.createObjectURL(await response.blob()) : null))
				.catch(() => null);
			photos.set(url, photo);
		}
		return photo;
	}
</script>

<script lang="ts">
	import { artistPhotoUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import Cover from './Cover.svelte';

	let { artistId, fallbackAlbumId, size }: { artistId: string; fallbackAlbumId: string; size: number } = $props();

	let photo = $state<string | null | undefined>(undefined);

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
	<img src={photo} alt="" decoding="async" draggable="false" />
{:else if photo === null}
	<Cover albumId={fallbackAlbumId} {size} />
{:else}
	<img alt="" draggable="false" />
{/if}
