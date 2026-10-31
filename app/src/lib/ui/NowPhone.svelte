<script lang="ts">
	import { isRadio } from '../library/queries.ts';
	import { currentLyricIndex, lyricsState } from '../player/lyricsState.svelte.ts';
	import { currentTrack, player, playerQueue, playNextTrack, playPreviousTrack, seekTo, togglePlay } from '../player/player.svelte.ts';
	import { deviceById, isActiveElsewhere, relay } from '../remote/relay.svelte.ts';
	import { deviceIcon, deviceLabel } from '../remote/devices.ts';
	import { COVER_PX } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import { clock } from './format.ts';
	import Icon from './Icon.svelte';
	import LikeButton from './LikeButton.svelte';
	import { setFullScreen, togglePanel } from './shell.ts';
	import Slider from './Slider.svelte';
	import { ui } from './state.svelte.ts';
	import TrackLinks from './TrackLinks.svelte';

	let scrubRatio = $state<number | null>(null);
	const track = $derived(currentTrack());
	const live = $derived(isRadio(track?.id));
	const remote = $derived(isActiveElsewhere());
	const showDevices = $derived(relay.connected && (relay.devices.length > 1 || remote));
	const duration = $derived(player.duration);
	const position = $derived(scrubRatio !== null ? scrubRatio * duration : player.position);
	const lyricLines = $derived.by(() => {
		const lyrics = lyricsState.lyrics;
		if (!lyrics?.synced || !lyrics.lines.length) return null;
		const index = currentLyricIndex();
		const text = (at: number) => (at >= 0 && at < lyrics.lines.length ? lyrics.lines[at].text.trim() || '♪' : '');
		return { key: index, current: text(index), next: text(index + 1) };
	});
</script>

<section id="nowPhone" aria-label="Now playing">
	<header class="nf-head">
		<button class="icon-btn" type="button" aria-label="Close now playing" onclick={() => setFullScreen(false)}><Icon name="down" /></button>
		<span class="eyebrow">{playerQueue().sourceName ? `Playing from ${playerQueue().sourceName}` : 'Now playing'}</span>
		<span class="nf-spacer"></span>
	</header>
	<div class="nf-stage">
		<div class="nf-cover"><Cover albumId={track?.albumId} icon={live ? 'radio' : undefined} size={COVER_PX.nowCanvas} eager /></div>
	</div>
	<div class="nf-info">
		<div class="nf-meta">
			<div class="nf-text">
				<h1>{track?.title ?? ''}</h1>
				<p>{#if track}<TrackLinks {track} />{/if}</p>
			</div>
			{#if !live}<LikeButton className="nf-like" />{/if}
		</div>
		<div class="nf-lyrics" aria-live="off">
			{#if lyricLines}
				{#key lyricLines.key}
					<p class="nf-line">{lyricLines.current}</p>
					<p class="nf-line next">{lyricLines.next}</p>
				{/key}
			{/if}
		</div>
		<div class="nf-seek" class:live>
			{#if live}
				<span class="live-badge"><i></i>Live</span>
			{:else}
				<Slider
					ratio={duration ? Math.min(1, position / duration) : 0}
					onchange={(ratio) => (scrubRatio = ratio)}
					onrelease={(ratio) => {
						if (track) seekTo(ratio * duration);
						scrubRatio = null;
					}}
				/>
				<div class="nf-times"><span>{clock(position)}</span><span>{clock(duration)}</span></div>
			{/if}
		</div>
		<div class="nf-ctrl">
			<button class="icon-btn" type="button" aria-label="Previous" onclick={playPreviousTrack}><Icon name="prev" /></button>
			<button class="play" type="button" aria-label={player.playing ? 'Pause' : 'Play'} onclick={togglePlay}><Icon name={player.playing ? 'pause' : 'play'} /></button>
			<button class="icon-btn" type="button" aria-label="Next" onclick={playNextTrack}><Icon name="next" /></button>
		</div>
		<div class="nf-foot">
			{#if showDevices}
				<button class="nf-device" class:on={remote} id={ui.fullScreen ? 'bDevice' : undefined} type="button" onclick={() => (ui.devicesOpen = !ui.devicesOpen)}><Icon name={remote ? deviceIcon(deviceById(relay.active)) : 'speaker'} /><span>{remote ? deviceLabel(relay.active) : 'This device'}</span></button>
			{:else}
				<span></span>
			{/if}
			<button class="icon-btn" type="button" aria-label="Queue and lyrics" onclick={() => togglePanel(true, 'queue')}><Icon name="queue" /></button>
		</div>
	</div>
</section>
