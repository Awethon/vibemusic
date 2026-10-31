<script lang="ts">
	import { isRadio } from '../library/queries.ts';
	import { currentTrack, player, togglePlay } from '../player/player.svelte.ts';
	import { deviceById, isActiveElsewhere, relay } from '../remote/relay.svelte.ts';
	import { deviceIcon, deviceLabel } from '../remote/devices.ts';
	import { COVER_PX } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';
	import LikeButton from './LikeButton.svelte';
	import { setFullScreen } from './shell.ts';
	import { ui } from './state.svelte.ts';

	const track = $derived(currentTrack());
	const live = $derived(isRadio(track?.id));
	const remote = $derived(isActiveElsewhere());
	const showDevices = $derived(relay.connected && (relay.devices.length > 1 || remote));
	const progress = $derived(player.duration ? Math.min(1, player.position / player.duration) : 0);
</script>

{#if track}
	<div id="phoneDock" role="region" aria-label="Player">
		<button class="pd-open" type="button" aria-label="Open now playing" onclick={() => setFullScreen(true)}>
			<span class="pd-cover"><Cover albumId={track.albumId} icon={live ? 'radio' : undefined} size={COVER_PX.card} eager /></span>
			<span class="pd-meta">
				{#if remote}
					<b>{track.title}<i> · {track.artist}</i></b>
					<small class="pd-device">{deviceLabel(relay.active)}</small>
				{:else}
					<b>{track.title}</b>
					<small>{track.artist}</small>
				{/if}
			</span>
		</button>
		{#if showDevices}<button class="icon-btn" class:on={ui.devicesOpen} id={ui.fullScreen ? undefined : 'bDevice'} type="button" aria-label="Devices" onclick={() => (ui.devicesOpen = !ui.devicesOpen)}><Icon name={remote ? deviceIcon(deviceById(relay.active)) : 'speaker'} /></button>{/if}
		{#if !live}<LikeButton className="pd-like" />{/if}
		<button class="pd-play" type="button" aria-label={player.playing ? 'Pause' : 'Play'} onclick={togglePlay}><Icon name={player.playing ? 'pause' : 'play'} /></button>
		{#if !live}<i class="pd-progress" style:transform="scaleX({progress})"></i>{/if}
	</div>
{/if}
