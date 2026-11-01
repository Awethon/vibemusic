<script lang="ts">
	import { GROUPS, LOOKS, encodeLookCode, lookFromCode, type GlassSlider } from '#lib/glass/params.ts';
	import {
		applyGlassParams,
		applyGlassPreset,
		glass,
		glassLookIsDefault,
		resetGlassLook,
		setGlassEnabled,
		setGlassParam
	} from '#lib/glass/settings.svelte.ts';
	import { albumWall } from '#lib/library/queries.ts';
	import { copyText } from '#lib/ui/clipboard.ts';
	import Cover from '#lib/ui/Cover.svelte';
	import { live } from '#lib/ui/live.svelte.ts';
	import { openMenu } from '#lib/ui/menu.svelte.ts';
	import Slider from '#lib/ui/Slider.svelte';
	import { showToast } from '#lib/ui/state.svelte.ts';
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { COVER_PX, GLASS_TUNER } from '#lib/tuning.ts';

	const LAB_URL = 'https://awethon.com/liquid-glass-lab/';

	// A wall of covers behind the controls, so there is something to look at through the glass.
	const covers = live(async () => (await albumWall('mostPlayed', { genres: [], decades: [] })).slice(0, GLASS_TUNER.wallCovers), []);
	let pasted = $state('');
	let codeNote = $state('');
	let codeField = $state<HTMLInputElement>();
	const code = $derived(encodeLookCode(glass.params));

	const ratioOf = (control: GlassSlider) => (glass.params[control.key] - control.min) / (control.max - control.min);
	const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step)));
	const valueAt = (control: GlassSlider, ratio: number) => {
		const raw = control.min + ratio * (control.max - control.min);
		return +(Math.round((raw - control.min) / control.step) * control.step + control.min).toFixed(decimals(control.step));
	};
	const shown = (control: GlassSlider) => `${glass.params[control.key].toFixed(decimals(control.step))}${control.unit}`;

	function applyCode() {
		try {
			const { params, preset } = lookFromCode(pasted);
			applyGlassParams(params, preset);
			if (!glass.enabled) setGlassEnabled(true);
			codeNote = 'Look applied.';
			pasted = '';
		} catch {
			codeNote = 'That isn’t a look code or a lab link.';
		}
	}

	async function copyCode() {
		if (await copyText(code)) {
			codeNote = '';
			showToast('Look code copied');
			return;
		}
		codeField?.select();
		codeNote = navigator.platform.startsWith('Mac') ? 'Press ⌘C to copy' : 'Press Ctrl+C to copy';
	}

	// Items do nothing: the menu only previews how glass looks on a menu.
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
				<p class="sub">
					Real refracting glass for the player bar, side panels, pop-ups and menus. Changes apply as you move the sliders and are kept in
					this browser.
				</p>
			</div>
		</div>
		<button type="button" class="set-row gt-switch" class:on={glass.enabled} onclick={() => setGlassEnabled(!glass.enabled)}>
			<span>Liquid glass<small>{glass.enabled ? 'On' : 'Off · surfaces use the plain blur'}</small></span><span class="switch"></span>
		</button>

		<p class="pop-title">Looks</p>
		<div class="chips gt-presets">
			{#each LOOKS as preset (preset.id)}
				<button type="button" class="chip" class:on={glass.preset === preset.id} onclick={() => applyGlassPreset(preset.id)}
					>{preset.name}</button
				>
			{/each}
		</div>
		<button type="button" class="ghost gt-reset" disabled={glassLookIsDefault()} onclick={resetGlassLook}>Reset to default look</button>

		{#each GROUPS as group (group.title)}
			<p class="pop-title">{group.title}</p>
			<div class="gt-group">
				{#each group.controls as control (control.key)}
					<!-- Toggles are shader signs (±1); -1 means on. -->
					{#if 'toggle' in control}
						<button
							type="button"
							class="set-row"
							class:on={glass.params[control.key] < 0}
							onclick={() => setGlassParam(control.key, glass.params[control.key] < 0 ? 1 : -1)}
						>
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

		<p class="pop-title">Look code</p>
		<div class="gt-link">
			<input
				class="gt-code"
				bind:this={codeField}
				value={code}
				readonly
				spellcheck="false"
				aria-label="This look’s code"
				onfocus={(event) => event.currentTarget.select()}
			/>
			<button class="ghost" type="button" onclick={copyCode}>Copy</button>
		</div>
		<form
			class="gt-link gt-paste"
			onsubmit={(event) => {
				event.preventDefault();
				applyCode();
			}}
		>
			<input bind:value={pasted} placeholder="Paste a look code" spellcheck="false" />
			<button class="ghost" type="submit" disabled={!pasted.trim()}>Apply</button>
		</form>
		<p class="gt-note">
			{codeNote || 'A code carries every setting above. Links from the liquid glass lab work too.'}
			<a href={LAB_URL} target="_blank" rel="noreferrer">Open the lab</a>
		</p>
		<button type="button" class="ghost gt-menu" onclick={sampleMenu}>Open a sample menu</button>
	</div>
	<div class="gt-wall" aria-hidden="true">
		{#each covers.value as album (album.id)}<Cover albumId={album.id} size={COVER_PX.glassWall} />{/each}
	</div>
</section>
