<script lang="ts">
	import { resolve } from '$app/paths';
	import { isRadio } from '../library/queries.ts';
	import { currentTrack, player, playNextTrack, playPreviousTrack, seekTo, setVolume, toggleMute, togglePlay } from '../player/player.svelte.ts';
	import { deviceById, isActiveElsewhere, relay } from '../remote/relay.svelte.ts';
	import { deviceIcon, deviceLabel } from '../remote/devices.ts';
	import Cover from './Cover.svelte';
	import { clock } from './format.ts';
	import Icon from './Icon.svelte';
	import LikeButton from './LikeButton.svelte';
	import { toggleFullScreen, togglePanel } from './shell.ts';
	import Slider from './Slider.svelte';
	import { ui } from './state.svelte.ts';
	import { COVER_PX } from '../tuning.ts';

	let scrubRatio = $state<number | null>(null);
	const track = $derived(currentTrack());
	const live = $derived(isRadio(track?.id));
	const duration = $derived(player.duration);
	const position = $derived(scrubRatio !== null ? scrubRatio * duration : player.position);
	const seekRatio = $derived(duration ? Math.min(1, position / duration) : 0);
	const level = $derived(player.muted ? 0 : player.volume);
	const remote = $derived(isActiveElsewhere());
	const showDevices = $derived(relay.connected && (relay.devices.length > 1 || remote));
</script>

<div id="dock">
	<div id="capsule" role="region" aria-label="Player">
		<div class="cap-left">
			<button class="cap-cover" type="button" aria-label="Open full screen" onclick={toggleFullScreen}><Cover albumId={track?.albumId} size={COVER_PX.card} eager /></button>
			<div class="cap-meta">
				<button class="cap-title" type="button" onclick={toggleFullScreen}>{track?.title ?? ''}</button>
				<p class="cap-sub">{#if live}{track?.artist}{:else if track}<a href={resolve('/artist/[id]', { id: track.albumArtistId || track.artistId })}>{track.artist}</a>{/if}{#if remote}<span class="cap-device"> · on {deviceLabel(relay.active)}</span>{/if}</p>
			</div>
			{#if !live}<LikeButton className="cap-like" />{/if}
		</div>
		<div class="cap-center">
			<div class="cap-ctrl">
				<button class="icon-btn" type="button" aria-label="Previous" onclick={playPreviousTrack}><Icon name="prev" /></button>
				<button class="play" type="button" aria-label={player.playing ? 'Pause' : 'Play'} onclick={togglePlay}><Icon name={player.playing ? 'pause' : 'play'} /></button>
				<button class="icon-btn" type="button" aria-label="Next" onclick={playNextTrack}><Icon name="next" /></button>
			</div>
			<div class="cap-seek" class:live>
				{#if live}<span class="live-badge"><i></i>Live</span>{:else}
				<span class="time">{clock(position)}</span>
				<Slider
					ratio={seekRatio}
					id="seek"
					onchange={(ratio) => {
						if (track) scrubRatio = ratio;
					}}
					onrelease={(ratio) => {
						if (track) seekTo(ratio * duration);
						scrubRatio = null;
					}}
				/>
				<span class="time">{clock(duration)}</span>
				{/if}
			</div>
		</div>
		<div class="cap-right">
			<button class="icon-btn" type="button" aria-label="Mute" onclick={toggleMute}><Icon name={level === 0 ? 'mute' : 'vol'} /></button>
			<Slider ratio={level} className="vol" onchange={setVolume} />
			{#if showDevices}<button class="icon-btn" class:on={ui.devicesOpen} id="bDevice" type="button" aria-label="Devices" onclick={() => (ui.devicesOpen = !ui.devicesOpen)}><Icon name={remote ? deviceIcon(deviceById(relay.active)) : 'speaker'} /></button>{/if}
			<button class="icon-btn" class:on={ui.panelOpen} id="bPanel" type="button" aria-label="Queue and lyrics" onclick={() => togglePanel()}><Icon name="queue" /></button>
			<button class="icon-btn" type="button" aria-label="Full screen" onclick={toggleFullScreen}><Icon name={ui.fullScreen ? 'collapse' : 'expand'} /></button>
		</div>
	</div>
</div>
