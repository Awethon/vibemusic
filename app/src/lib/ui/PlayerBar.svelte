<script lang="ts">
	import { resolve } from '$app/paths';
	import { currentTrack, player, playNextTrack, playPreviousTrack, seekTo, setVolume, toggleLike, toggleMute, togglePlay } from '../player/player.svelte.ts';
	import Cover from './Cover.svelte';
	import { clock } from './format.ts';
	import { setFullScreen, togglePanel, ui } from './state.svelte.ts';

	let scrub = $state<number | null>(null);
	const track = $derived(currentTrack());
	const shownPosition = $derived(scrub ?? player.position);
</script>

<footer class="player-bar">
	<div class="now">
		{#if track}
			<Cover albumId={track.albumId} size={96} round />
			<div class="titles">
				<a class="title" href={resolve('/album/[id]', { id: track.albumId })}>{track.title}</a>
				<a class="artist" href={resolve('/artist/[id]', { id: track.albumArtistId || track.artistId })}>{track.artist}</a>
			</div>
			<button class="icon-button" class:liked={track.starred} onclick={() => toggleLike(track)} title="Like">{track.starred ? '♥' : '♡'}</button>
		{/if}
	</div>
	<div class="controls">
		<div class="buttons">
			<button class="icon-button" onclick={playPreviousTrack} title="Previous">⏮</button>
			<button class="play" onclick={togglePlay} title={player.playing ? 'Pause' : 'Play'}>{player.playing ? '⏸' : '▶'}</button>
			<button class="icon-button" onclick={playNextTrack} title="Next">⏭</button>
		</div>
		<div class="seek">
			<span>{clock(shownPosition)}</span>
			<input
				type="range"
				min="0"
				max={player.duration || 1}
				step="0.1"
				value={shownPosition}
				oninput={(event) => (scrub = Number(event.currentTarget.value))}
				onchange={(event) => {
					seekTo(Number(event.currentTarget.value));
					scrub = null;
				}}
			/>
			<span>{clock(player.duration)}</span>
		</div>
		{#if player.error}<span class="error">{player.error}</span>{/if}
	</div>
	<div class="extras">
		<button class="icon-button" onclick={toggleMute} title="Mute">{player.muted || player.volume === 0 ? '🔇' : '🔊'}</button>
		<input class="volume" type="range" min="0" max="1" step="0.01" value={player.muted ? 0 : player.volume} oninput={(event) => setVolume(Number(event.currentTarget.value))} />
		<button class="icon-button" class:active={ui.panelOpen && ui.panelTab === 'queue'} onclick={() => togglePanel('queue')} title="Queue">☰</button>
		<button class="icon-button" class:active={ui.panelOpen && ui.panelTab === 'lyrics'} onclick={() => togglePanel('lyrics')} title="Lyrics">❝</button>
		<button class="icon-button" class:active={ui.fullScreen} onclick={() => setFullScreen(!ui.fullScreen)} title="Full screen">⛶</button>
	</div>
</footer>
