<script lang="ts">
	import { page } from '$app/state';
	import { medianCut } from '#lib/library/medianCut.ts';
	import { PALETTE } from '#lib/tuning.ts';
	import { accentFromPalette } from '#lib/ui/accent.ts';
	import { clock } from '#lib/ui/format.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Slider from '#lib/ui/Slider.svelte';

	type ShareTrack = { id: string; title: string; artist: string; album: string; duration: number };
	type Share = { id: string; description: string; tracks: ShareTrack[] };

	const VOLUME_KEY = 'vibemusic.share.volume';
	const RESTART_AFTER_SECONDS = 3;

	const id = $derived(page.params.id ?? '');
	let share = $state<Share | null>(null);
	let problem = $state('');
	let index = $state(0);
	let playing = $state(false);
	let position = $state(0);
	let duration = $state(0);
	let scrubRatio = $state<number | null>(null);
	const initialVolume = storedVolume();
	let volume = $state(initialVolume);
	let queueOpen = $state(false);
	let accent = $state('');

	const audio = new Audio();
	audio.preload = 'metadata';
	audio.volume = initialVolume * initialVolume;

	const track = $derived(share?.tracks[index] ?? null);
	const several = $derived((share?.tracks.length ?? 0) > 1);
	const total = $derived(duration || track?.duration || 0);
	const shown = $derived(scrubRatio !== null ? scrubRatio * total : position);

	const coverUrl = (trackId: string, size: number) => `/share/img/${encodeURIComponent(trackId)}?size=${size}&square=true`;

	function storedVolume() {
		try {
			return Number(localStorage.getItem(VOLUME_KEY) ?? 0.8);
		} catch {
			return 0.8;
		}
	}

	$effect(() => {
		const shareId = id;
		share = null;
		problem = '';
		void fetch(`/relay/share/${encodeURIComponent(shareId)}`).then(async (response) => {
			if (response.ok) {
				share = (await response.json()) as Share;
				if (!share.tracks?.length) problem = 'This share is empty.';
				else load(0, false);
			} else problem = response.status === 410 ? 'This link has expired.' : response.status === 404 ? 'This link doesn’t exist.' : 'Couldn’t open this link. Try again in a moment.';
		}, () => (problem = 'Couldn’t open this link. Try again in a moment.'));
	});

	$effect(() => {
		const sync = () => {
			playing = !audio.paused && !audio.ended;
			position = audio.currentTime || 0;
			duration = Number.isFinite(audio.duration) ? audio.duration : 0;
		};
		const events = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'emptied'];
		for (const name of events) audio.addEventListener(name, sync);
		const ended = () => (index + 1 < (share?.tracks.length ?? 0) ? load(index + 1, true) : sync());
		audio.addEventListener('ended', ended);
		return () => {
			for (const name of events) audio.removeEventListener(name, sync);
			audio.removeEventListener('ended', ended);
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
		};
	});

	$effect(() => {
		if (!track || !('mediaSession' in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork: [{ src: coverUrl(track.id, 512), sizes: '512x512', type: 'image/jpeg' }] });
		navigator.mediaSession.setActionHandler('play', () => void audio.play());
		navigator.mediaSession.setActionHandler('pause', () => audio.pause());
		navigator.mediaSession.setActionHandler('previoustrack', previous);
		navigator.mediaSession.setActionHandler('nexttrack', several ? next : null);
	});

	async function coverAccent(url: string) {
		const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { resizeWidth: PALETTE.coverSamplePx, resizeHeight: PALETTE.coverSamplePx });
		const canvas = new OffscreenCanvas(PALETTE.coverSamplePx, PALETTE.coverSamplePx);
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const rgb = accentFromPalette(medianCut(context.getImageData(0, 0, PALETTE.coverSamplePx, PALETTE.coverSamplePx).data));
		return rgb ? `rgb(${rgb.map(Math.round).join(' ')})` : '';
	}

	$effect(() => {
		if (!track) return;
		let current = true;
		void coverAccent(coverUrl(track.id, PALETTE.coverSamplePx * 2)).then(
			(color) => current && color && (accent = color),
			() => {}
		);
		return () => (current = false);
	});

	function load(at: number, autoplay: boolean) {
		const chosen = share?.tracks[at];
		if (!chosen) return;
		index = at;
		position = 0;
		duration = chosen.duration;
		audio.src = `/share/s/${encodeURIComponent(chosen.id)}`;
		if (autoplay) void audio.play().catch(() => {});
	}

	function toggle() {
		if (!track) return;
		if (audio.paused) void audio.play().catch(() => {});
		else audio.pause();
	}

	function previous() {
		if (audio.currentTime > RESTART_AFTER_SECONDS || index === 0) audio.currentTime = 0;
		else load(index - 1, true);
	}

	function next() {
		if (share && index + 1 < share.tracks.length) load(index + 1, true);
	}

	function setVolume(level: number) {
		volume = level;
		audio.volume = level * level;
		try {
			localStorage.setItem(VOLUME_KEY, String(level));
		} catch {
			return;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
		if (event.key === ' ') {
			event.preventDefault();
			toggle();
		} else if (event.key === 'Escape') queueOpen = false;
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>{track ? `${track.title} · ${track.artist}` : share?.description || 'vibemusic'}</title>
</svelte:head>

<div class="share-page" class:queue-open={queueOpen && several} style:--accent={accent || undefined}>
	{#if track}<div class="share-backdrop" style:background-image="url({coverUrl(track.id, 300)})" aria-hidden="true"></div>{/if}
	<header class="share-top">
		<span class="share-brand">vibe<span>music</span></span>
		{#if several && share?.description}<span class="share-from">{share.description}</span>{/if}
	</header>

	<main class="share-stage">
		{#if problem}
			<p class="share-problem">{problem}</p>
		{:else if track}
			<button class="share-cover" type="button" aria-label={playing ? 'Pause' : 'Play'} onclick={toggle}>
				<img src={coverUrl(track.id, 1000)} alt="" draggable="false" />
				{#if !playing}<span class="share-cover-play"><Icon name="play" /></span>{/if}
			</button>
			<div class="share-meta">
				<h1>{track.title}</h1>
				<p>{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
			</div>
		{/if}
	</main>

	{#if several && share}
		<aside class="share-queue" aria-label="Tracks" inert={!queueOpen}>
			<header><b>{share.description || 'Shared tracks'}</b><span>{share.tracks.length} tracks</span></header>
			<ol>
				{#each share.tracks as item, position (item.id)}
					<li>
						<button type="button" class:on={position === index} onclick={() => load(position, true)}>
							<span class="n">{position + 1}</span>
							<span class="t"><b>{item.title}</b><small>{item.artist}</small></span>
							<span class="d">{clock(item.duration)}</span>
						</button>
					</li>
				{/each}
			</ol>
		</aside>
	{/if}

	{#if track}
		<div class="share-bar" role="region" aria-label="Player">
			<div class="sb-left">
				<span class="sb-cover"><img src={coverUrl(track.id, 120)} alt="" draggable="false" /></span>
				<div class="sb-meta"><b>{track.title}</b><small>{track.artist}</small></div>
			</div>
			<div class="sb-center">
				<div class="sb-ctrl">
					<button class="icon-btn" type="button" aria-label="Previous" onclick={previous}><Icon name="prev" /></button>
					<button class="play" type="button" aria-label={playing ? 'Pause' : 'Play'} onclick={toggle}><Icon name={playing ? 'pause' : 'play'} /></button>
					<button class="icon-btn" type="button" aria-label="Next" disabled={!several || index + 1 >= (share?.tracks.length ?? 0)} onclick={next}><Icon name="next" /></button>
				</div>
				<div class="sb-seek">
					<span class="time">{clock(shown)}</span>
					<Slider
						ratio={total ? Math.min(1, shown / total) : 0}
						onchange={(ratio) => (scrubRatio = ratio)}
						onrelease={(ratio) => {
							if (total) audio.currentTime = ratio * total;
							scrubRatio = null;
						}}
					/>
					<span class="time">{clock(total)}</span>
				</div>
			</div>
			<div class="sb-right">
				<button class="icon-btn sb-mute" type="button" aria-label="Mute" onclick={() => setVolume(volume ? 0 : 0.8)}><Icon name={volume === 0 ? 'mute' : 'vol'} /></button>
				<Slider ratio={volume} className="vol" onchange={setVolume} />
				{#if several}<button class="icon-btn" class:on={queueOpen} type="button" aria-label="Tracks" onclick={() => (queueOpen = !queueOpen)}><Icon name="queue" /></button>{/if}
			</div>
		</div>
	{/if}
</div>
