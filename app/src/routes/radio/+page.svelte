<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { radioTracks } from '#lib/library/queries.ts';
	import { player, playerQueue, playTrackInList, togglePlay } from '#lib/player/player.svelte.ts';
	import { radioNow } from '#lib/player/radioNow.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const stations = live(radioTracks, []);

	function choose(index: number) {
		if (playerQueue().currentTrackId === stations.value[index]?.id) togglePlay();
		else playTrackInList(stations.value, index, 'Radio', 'radio');
	}
</script>

<section class="view" {@attach viewEnter}>
	<div class="vhead"><div><h1 class="display">Radio</h1><p class="sub">{plural(stations.value.length, 'station')} from Navidrome</p></div></div>
	<div class="radio-grid">
		{#each stations.value as station, index (station.id)}
			{@const current = playerQueue().currentTrackId === station.id}
			{@const onAir = current && player.playing}
			<button class="radio-card" class:on={current} type="button" onclick={() => choose(index)}>
				<span class="radio-art"><span class="cover-icon"><Icon name="radio" /></span><span class="radio-play"><Icon name={onAir ? 'pause' : 'play'} /></span></span>
				<span class="radio-text">
					<b>{station.title}</b>
					<small>{station.artist}</small>
					{#if current && radioNow.stationId === station.id && radioNow.title}<span class="radio-song">{#if onAir}<span class="live-badge"><i></i></span>{/if}{radioNow.title}{radioNow.artist ? ` · ${radioNow.artist}` : ''}</span>{/if}
				</span>
			</button>
		{:else}
			{#if stations.loaded}<p class="q-empty">No stations yet. Add them in Navidrome under Radios.</p>{/if}
		{/each}
	</div>
</section>
