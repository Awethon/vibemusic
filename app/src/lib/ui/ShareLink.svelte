<script lang="ts">
	// Shown when a share link couldn't be copied automatically (plain http, where the browser only
	// allows copying right after a click). Pressing Copy is a fresh click, so copying works here.
	import { copyWithSelection } from './clipboard.ts';
	import { closeShareLink, showToast, ui } from './state.svelte.ts';

	let field = $state<HTMLInputElement>();
	let card = $state<HTMLElement>();
	let hint = $state('');

	$effect(() => {
		if (!ui.shareLink || !field) return;
		hint = '';
		field.focus();
		field.select();
		const outside = (event: PointerEvent) => {
			if (card && !card.contains(event.target as Node)) closeShareLink();
		};
		document.addEventListener('pointerdown', outside, true);
		return () => document.removeEventListener('pointerdown', outside, true);
	});

	function copy() {
		if (copyWithSelection(ui.shareLink)) {
			closeShareLink();
			showToast('Share link copied');
			return;
		}
		field?.select();
		hint = navigator.platform.startsWith('Mac') ? 'Press ⌘C to copy' : 'Press Ctrl+C to copy';
	}
</script>

<div id="shareLink" class="pop" class:open={!!ui.shareLink} role="dialog" aria-label="Share link" bind:this={card}>
	<p class="pop-title">Share link</p>
	<div class="share-link-row">
		<input bind:this={field} value={ui.shareLink} readonly spellcheck="false" onfocus={(event) => event.currentTarget.select()} />
		<button type="button" class="btn" onclick={copy}>Copy</button>
	</div>
	{#if hint}<p class="share-link-hint">{hint}</p>{/if}
</div>
