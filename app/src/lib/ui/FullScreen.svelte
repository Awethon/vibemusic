<script lang="ts">
	import { resolve } from '$app/paths';
	import { albumById } from '../library/queries.ts';
	import { currentLineIndex, lyricsFor, type Lyrics } from '../player/lyrics.ts';
	import { currentTrack, player, toggleLike } from '../player/player.svelte.ts';
	import { IDLE, LYRICS, QUEUE } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import { live } from './live.svelte.ts';
	import LyricsView from './LyricsView.svelte';
	import UpNext from './UpNext.svelte';
	import { setFullScreen, togglePanel, ui } from './state.svelte.ts';

	const track = $derived(currentTrack());
	const album = live(() => (track ? albumById(track.albumId) : Promise.resolve(null)), null);

	let minimalLyrics = $state<Lyrics | null>(null);
	$effect(() => {
		const id = track?.id;
		minimalLyrics = null;
		if (id) void lyricsFor(id).then((result) => (minimalLyrics = result));
	});
	const ambientLine = $derived.by(() => {
		const index = currentLineIndex(minimalLyrics, player.position);
		return index >= 0 ? minimalLyrics!.lines[index].text : '';
	});

	let lastActivity = $state(performance.now());
	let now = $state(performance.now());
	const resting = $derived(ui.fullScreenStyle === 'minimal' && player.playing && now - lastActivity > IDLE.defaultDelayMs);

	$effect(() => {
		const timer = setInterval(() => (now = performance.now()), IDLE.checkIntervalMs);
		const wake = () => (lastActivity = performance.now());
		const events = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
		events.forEach((name) => window.addEventListener(name, wake, { passive: true }));
		return () => {
			clearInterval(timer);
			events.forEach((name) => window.removeEventListener(name, wake));
		};
	});

	$effect(() => {
		document.body.classList.toggle('resting', resting);
		return () => document.body.classList.remove('resting');
	});
</script>

<div class="fullscreen style-{ui.fullScreenStyle}" class:resting>
	<button class="close" onclick={() => setFullScreen(false)} title="Leave full screen (Esc)">✕</button>
	{#if !track}
		<p class="empty-state">Nothing playing.</p>
	{:else if ui.fullScreenStyle === 'canvas'}
		<section class="fs-now selectable">
			<Cover albumId={track.albumId} size={600} />
			<h1>{track.title}</h1>
			<p class="meta">{track.artist} · {track.album}{album.value?.year ? ` · ${album.value.year}` : ''}</p>
			<button class="icon-button" class:liked={track.starred} onclick={() => toggleLike(track)}>{track.starred ? '♥' : '♡'}</button>
		</section>
		<section class="fs-lyrics"><LyricsView focusRatio={LYRICS.focusLineRatio.canvas} large /></section>
		<section class="fs-queue">
			<h3>Up next</h3>
			<UpNext limit={QUEUE.fullScreenUpNextCount} combined />
			<button class="link" onclick={() => togglePanel('queue')}>Open queue</button>
		</section>
	{:else if ui.fullScreenStyle === 'classic'}
		<header class="fs-top"><span class="kicker">Playing from {player.queue.sourceName || 'queue'}</span></header>
		<section class="fs-classic-now selectable">
			<Cover albumId={track.albumId} size={800} />
			<h1>{track.title}</h1>
			<p class="meta">
				<a href={resolve('/artist/[id]', { id: track.albumArtistId || track.artistId })} onclick={() => setFullScreen(false)}>{track.artist}</a> ·
				<a href={resolve('/album/[id]', { id: track.albumId })} onclick={() => setFullScreen(false)}>{track.album}</a>
			</p>
		</section>
		<section class="fs-lyrics"><LyricsView focusRatio={LYRICS.focusLineRatio.classic} large /></section>
	{:else}
		<section class="fs-minimal selectable">
			<Cover albumId={track.albumId} size={600} />
			<p class="meta">{track.artist} — {track.album}</p>
			<h1>{track.title}</h1>
			<p class="ambient-line">{ambientLine}</p>
		</section>
	{/if}
</div>
