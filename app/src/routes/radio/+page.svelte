<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resyncLibrary } from '#lib/library/library.svelte.ts';
	import { RADIO_PREFIX, radioStations, radioTracks } from '#lib/library/queries.ts';
	import { player, playerQueue, playTrackInList, togglePlay } from '#lib/player/player.svelte.ts';
	import { radioNow } from '#lib/player/radioNow.svelte.ts';
	import { navidrome, session } from '#lib/session.svelte.ts';
	import { reportFailure } from '#lib/ui/actions.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { openMenu, type MenuItem } from '#lib/ui/menu.svelte.ts';
	import { showToast } from '#lib/ui/state.svelte.ts';

	type Draft = { id: string | null; name: string; streamUrl: string; homePageUrl: string };

	const stations = live(radioTracks, []);
	const details = live(radioStations, []);
	const admin = $derived(!!session.credentials?.isAdmin);
	let draft = $state<Draft | null>(null);
	let saving = $state(false);
	let problem = $state('');

	const stationId = (trackId: string) => trackId.slice(RADIO_PREFIX.length);
	const isWebAddress = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

	function choose(index: number) {
		if (playerQueue().currentTrackId === stations.value[index]?.id) togglePlay();
		else playTrackInList(stations.value, index, 'Radio', 'radio');
	}

	function startEditing(trackId: string | null) {
		const station = trackId ? details.value.find((candidate) => candidate.id === stationId(trackId)) : null;
		draft = station ? { ...station } : { id: null, name: '', streamUrl: '', homePageUrl: '' };
		problem = '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!draft || saving) return;
		const name = draft.name.trim();
		const streamUrl = draft.streamUrl.trim();
		const homepageUrl = draft.homePageUrl.trim();
		if (!name) return void (problem = 'Give the station a name.');
		if (!isWebAddress(streamUrl)) return void (problem = 'The stream address should start with http:// or https://.');
		if (homepageUrl && !isWebAddress(homepageUrl)) return void (problem = 'The website should start with http:// or https://.');
		saving = true;
		problem = '';
		try {
			if (draft.id) await navidrome().subsonic('updateInternetRadioStation', { id: draft.id, name, streamUrl, homepageUrl });
			else await navidrome().subsonic('createInternetRadioStation', { name, streamUrl, homepageUrl });
			showToast(draft.id ? 'Station saved' : `Added ${name}`);
			draft = null;
			await resyncLibrary();
		} catch {
			problem = 'Navidrome didn’t accept the station. Check the addresses and try again.';
		} finally {
			saving = false;
		}
	}

	async function remove(trackId: string, name: string) {
		if (!confirm(`Remove “${name}” from Navidrome? This removes it for everyone on the server.`)) return;
		try {
			await navidrome().subsonic('deleteInternetRadioStation', { id: stationId(trackId) });
		} catch (error) {
			reportFailure(`remove ${name}`, error);
			return;
		}
		showToast(`Removed ${name}`);
		await resyncLibrary();
	}

	function stationMenu(event: MouseEvent, index: number) {
		const station = stations.value[index];
		const items: MenuItem[] = [
			{ label: playerQueue().currentTrackId === station.id && player.playing ? 'Pause' : 'Play', run: () => choose(index) }
		];
		if (admin)
			items.push(
				{ separator: true },
				{ label: 'Edit station', run: () => startEditing(station.id) },
				{ label: 'Remove station', run: () => remove(station.id, station.title) }
			);
		openMenu(event, items);
	}
</script>

<section class="view" {@attach viewEnter}>
	<div class="vhead">
		<div>
			<h1 class="display">Radio</h1>
			<p class="sub">{plural(stations.value.length, 'station')} from Navidrome</p>
		</div>
	</div>
	<div class="radio-grid">
		{#each stations.value as station, index (station.id)}
			{@const current = playerQueue().currentTrackId === station.id}
			{@const onAir = current && player.playing}
			<button
				class="radio-card"
				class:on={current}
				type="button"
				onclick={() => choose(index)}
				oncontextmenu={(event) => stationMenu(event, index)}
			>
				<span class="radio-art"
					><span class="cover-icon"><Icon name="radio" /></span><span class="radio-play"><Icon name={onAir ? 'pause' : 'play'} /></span
					></span
				>
				<span class="radio-text">
					<b>{station.title}</b>
					<small>{station.artist}</small>
					{#if current && radioNow.stationId === station.id && radioNow.title}<span class="radio-song"
							>{#if onAir}<span class="live-badge"><i></i></span>{/if}{radioNow.title}{radioNow.artist ? ` · ${radioNow.artist}` : ''}</span
						>{/if}
				</span>
			</button>
		{/each}
		{#if admin && !draft}
			<button class="radio-card radio-add" type="button" onclick={() => startEditing(null)}>
				<span class="radio-art"><span class="cover-icon"><Icon name="plus" /></span></span>
				<span class="radio-text"><b>Add station</b><small>Any stream address</small></span>
			</button>
		{/if}
		{#if draft}
			<form class="radio-card radio-form" onsubmit={save}>
				<b>{draft.id ? 'Edit station' : 'New station'}</b>
				<label>Name <input bind:value={draft.name} placeholder="Station name" required /></label>
				<label>Stream address <input bind:value={draft.streamUrl} type="url" placeholder="https://radio.example/stream" required /></label>
				<label
					><span>Website <small>optional</small></span><input
						bind:value={draft.homePageUrl}
						type="url"
						placeholder="https://radio.example"
					/></label
				>
				{#if problem}<p class="radio-problem">{problem}</p>{/if}
				<div class="radio-form-actions">
					<button class="chip" type="button" onclick={() => (draft = null)}>Cancel</button>
					<button class="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save' : 'Add'}</button>
				</div>
			</form>
		{/if}
	</div>
	{#if stations.loaded && !stations.value.length && !admin}<p class="q-empty">No stations yet. A Navidrome admin can add them here.</p>{/if}
</section>
