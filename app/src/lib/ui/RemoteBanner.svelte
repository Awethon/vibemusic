<script lang="ts">
	import { setBodyClass } from '../engine/dom.ts';
	import { player, playOn } from '../player/player.svelte.ts';
	import { deviceLabel } from '../remote/devices.ts';
	import { isActiveElsewhere, relay } from '../remote/relay.svelte.ts';

	const remote = $derived(isActiveElsewhere());

	$effect(() => {
		setBodyClass('remote', remote);
		setBodyClass('tap-to-play', player.waitingForTap && !remote);
	});
</script>

<div id="remoteBanner" aria-hidden={!remote && !player.waitingForTap}>
	<span class="pulse"></span>
	{#if !remote}
		<span>Tap anywhere to start playing here</span>
	{:else}
		<span class="rb-text"
			>{#if player.waitingForTap}Tap the screen on <b>{deviceLabel(relay.active)}</b> to start playing there{:else}Playing on <b
					>{deviceLabel(relay.active)}</b
				><span class="rb-extra"> · this tab is a remote</span>{/if}</span
		>
		<button type="button" onclick={() => playOn(relay.deviceId)}>Play here</button>
	{/if}
</div>
