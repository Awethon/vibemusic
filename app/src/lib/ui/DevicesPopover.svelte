<script lang="ts">
	import { formFactor } from './formFactor.svelte.ts';
	import { player, playOn } from '../player/player.svelte.ts';
	import { deviceIcon, deviceLabels } from '../remote/devices.ts';
	import { onlineDevices, relay, type Device } from '../remote/relay.svelte.ts';
	import { POPOVER } from '../tuning.ts';
	import Icon from './Icon.svelte';
	import { ui } from './state.svelte.ts';

	let element = $state<HTMLElement | null>(null);
	let position = $state({ right: 0, bottom: 0 });
	const labels = $derived(deviceLabels());
	const devices = $derived(onlineDevices().toSorted((a, b) => Number(b.id === relay.deviceId) - Number(a.id === relay.deviceId)));

	$effect(() => {
		if (!ui.devicesOpen || !element) return;
		const anchor = document.getElementById('bDevice')?.getBoundingClientRect();
		if (!anchor) return;
		position = { right: Math.max(POPOVER.edgeMarginPx, innerWidth - anchor.right), bottom: innerHeight - anchor.top + POPOVER.anchorGapPx };
	});

	function status(device: Device) {
		const here = device.id === relay.deviceId;
		if (device.id === relay.active) {
			if (!device.online) return 'Offline';
			if (player.waitingForTap) return here ? 'Tap anywhere to start' : 'Waiting for a tap';
			return `${player.playing ? 'Playing' : 'Paused'}${here ? ' in this tab' : ''}`;
		}
		return here ? 'This tab' : 'Ready';
	}

	function choose(device: Device) {
		ui.devicesOpen = false;
		playOn(device.id);
	}
</script>

<svelte:window
	onpointerdown={(event) =>
		ui.devicesOpen &&
		!element?.contains(event.target as Node) &&
		!(event.target as Element).closest('#bDevice') &&
		(ui.devicesOpen = false)}
/>

<div
	id="devices"
	class="pop"
	class:open={ui.devicesOpen}
	role="dialog"
	aria-label="Devices"
	bind:this={element}
	style:right={formFactor.phone ? undefined : `${position.right}px`}
	style:bottom={formFactor.phone ? undefined : `${position.bottom}px`}
>
	<p class="pop-title">Play on</p>
	{#each devices as device (device.id)}
		{@const current = device.id === relay.active}
		<div class="dev" class:cur={current} class:offline={!device.online}>
			<span class="di"><Icon name={deviceIcon(device)} /></span>
			<div><b>{labels.get(device.id)}</b><small>{status(device)}</small></div>
			{#if current && device.online && player.playing}
				<span class="eqi" aria-hidden="true"><i></i><i></i><i></i></span>
			{:else if !current && device.online}
				<button type="button" onclick={() => choose(device)}>{device.id === relay.deviceId ? 'Play here' : 'Play there'}</button>
			{/if}
		</div>
	{/each}
</div>
