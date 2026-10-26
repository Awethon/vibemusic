<script lang="ts">
	import { library } from '../library/library.svelte.ts';
	import { formatCount } from './format.ts';

	const progress = $derived(library.progress);
	const share = $derived.by(() => {
		if (!progress) return 0;
		if (progress.building) return 0.96;
		const parts = [
			[progress.tracks, progress.trackTotal, 0.7],
			[progress.albums, progress.albumTotal, 0.15],
			[progress.playlists, progress.playlistTotal, 0.1]
		] as const;
		return parts.reduce((sum, [done, total, weight]) => sum + (total ? (done / total) * weight : 0), 0);
	});
	const counted = (done: number, total: number) => (done < total ? `${formatCount(done)} of ${formatCount(total)}` : formatCount(total));
</script>

<div class="first-sync">
	<h1 class="display">Getting your library</h1>
	<p>The first sync copies your library into this browser, so everything after it opens instantly.</p>
	<div class="fs-bar"><i style:transform="scaleX({Math.max(0.03, share)})"></i></div>
	<ul>
		<li><span>Tracks</span>{progress?.trackTotal ? counted(progress.tracks, progress.trackTotal) : '…'}</li>
		<li><span>Albums</span>{progress?.albumTotal ? counted(progress.albums, progress.albumTotal) : '…'}</li>
		<li><span>Playlists</span>{progress ? counted(progress.playlists, progress.playlistTotal) : '…'}</li>
	</ul>
	<p class="fs-stage">{progress?.building ? 'Putting it together…' : 'Downloading from Navidrome…'}</p>
</div>
