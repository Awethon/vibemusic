<script lang="ts">
	import { GROUPS, PRESETS, decodeLabLink, type GlassSlider } from '#lib/glass/params.ts';
	import { applyGlassParams, applyGlassPreset, glass, setGlassEnabled, setGlassParam } from '#lib/glass/settings.svelte.ts';
	import { albumWall } from '#lib/library/queries.ts';
	import Cover from '#lib/ui/Cover.svelte';
	import { live } from '#lib/ui/live.svelte.ts';
	import { openMenu } from '#lib/ui/menu.svelte.ts';
	import Slider from '#lib/ui/Slider.svelte';
	import { viewEnter } from '#lib/ui/viewEnter.ts';

	const WALL_COVERS = 24;
	const LAB_URL = 'https://awethon.com/liquid-glass-lab/';

	const covers = live(async () => (await albumWall('mostPlayed', { genres: [], decades: [] })).slice(0, WALL_COVERS), []);
	let link = $state('');
	let linkNote = $state('');

	const ratioOf = (control: GlassSlider) => (glass.params[control.key] - control.min) / (control.max - control.min);
	const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step)));
	const valueAt = (control: GlassSlider, ratio: number) => {
		const raw = control.min + ratio * (control.max - control.min);
		return +(Math.round((raw - control.min) / control.step) * control.step + control.min).toFixed(decimals(control.step));
	};
	const shown = (control: GlassSlider) => `${glass.params[control.key].toFixed(decimals(control.step))}${control.unit}`;

	function importLink() {
		try {
			const { params, preset } = decodeLabLink(link);
			applyGlassParams(params, preset);
			if (!glass.enabled) setGlassEnabled(true);
			linkNote = 'Imported from the lab.';
			link = '';
		} catch (error) {
			linkNote = error instanceof Error ? error.message : 'That doesn’t look like a lab link.';
		}
	}

	function sampleMenu(event: MouseEvent) {
		const noop = () => {};
		openMenu(event, [
			{ label: 'Play', run: noop },
			{ label: 'Play next', hint: '12 tracks', run: noop },
			{ label: 'Add to queue', run: noop },
			{ separator: true },
			{ label: 'Go to artist', run: noop }
		]);
	}
</script>

<section class="view glass-tuner" {@attach viewEnter}>
	<div class="gt-controls">
		<div class="vhead">
			<div>
				<p class="eyebrow">Settings</p>
				<h1 class="display">Liquid glass</h1>
				<p class="sub">Real refracting glass for the player bar, side panels, pop-ups and menus. Changes apply as you move the sliders and are kept in this browser.</p>
			</div>
		</div>
		<button type="button" class="set-row gt-switch" class:on={glass.enabled} onclick={() => setGlassEnabled(!glass.enabled)}>
			<span>Liquid glass<small>{glass.enabled ? 'On' : 'Off · surfaces use the plain blur'}</small></span><span class="switch"></span>
		</button>

		<p class="pop-title">Looks</p>
		<div class="chips gt-presets">
			{#each PRESETS.filter((preset) => preset.id !== 'css') as preset (preset.id)}
				<button type="button" class="chip" class:on={glass.preset === preset.id} onclick={() => applyGlassPreset(preset.id)}>{preset.name}</button>
			{/each}
		</div>

		{#each GROUPS as group (group.title)}
			<p class="pop-title">{group.title}</p>
			<div class="gt-group">
				{#each group.controls as control (control.key)}
					{#if 'toggle' in control}
						<button type="button" class="set-row" class:on={glass.params[control.key] < 0} onclick={() => setGlassParam(control.key, glass.params[control.key] < 0 ? 1 : -1)}>
							<span>{control.label}</span><span class="switch"></span>
						</button>
					{:else}
						<div class="gt-slider" title={control.note}>
							<span class="gt-label">{control.label}<b>{shown(control)}</b></span>
							<Slider ratio={ratioOf(control)} onchange={(ratio) => setGlassParam(control.key, valueAt(control, ratio))} />
							{#if control.note}<small>{control.note}</small>{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/each}

		<p class="pop-title">From the lab</p>
		<form
			class="gt-link"
			onsubmit={(event) => {
				event.preventDefault();
				importLink();
			}}
		>
			<input bind:value={link} placeholder="Paste a liquid glass lab link" spellcheck="false" />
			<button class="ghost" type="submit" disabled={!link.trim()}>Import</button>
		</form>
		<p class="gt-note">{linkNote || 'Tune a look in the lab, copy its link, and paste it here.'} <a href={LAB_URL} target="_blank" rel="noreferrer">Open the lab</a></p>
		<button type="button" class="ghost gt-menu" onclick={sampleMenu}>Open a sample menu</button>
	</div>
	<div class="gt-wall" aria-hidden="true">
		{#each covers.value as album (album.id)}<Cover albumId={album.id} size={240} />{/each}
	</div>
</section>
