<script lang="ts">
	import { library, resyncLibrary } from '../library/library.svelte.ts';
	import { session, signOut } from '../session.svelte.ts';
	import { relativeTime } from './format.ts';
	import { FULL_SCREEN_STYLES, setFullScreenStyle, setRipples, ui } from './state.svelte.ts';

	const styleNames = { canvas: 'Canvas', classic: 'Classic', minimal: 'Minimal' } as const;
</script>

<div class="settings">
	<h3>Full screen</h3>
	<div class="chips">
		{#each FULL_SCREEN_STYLES as style (style)}
			<button class="chip" class:active={ui.fullScreenStyle === style} onclick={() => setFullScreenStyle(style)}>{styleNames[style]}</button>
		{/each}
	</div>
	<h3>Background</h3>
	<label><input type="checkbox" checked={ui.ripples} onchange={(event) => setRipples(event.currentTarget.checked)} /> Ripples</label>
	<p class="meta">Renderer: {ui.fieldRenderer || 'none'}</p>
	<h3>Library</h3>
	{#if library.meta}<p class="meta">Synced {relativeTime(library.meta.syncedAt)}{library.leader ? ' · this tab syncs' : ''}</p>{/if}
	{#if library.error}<p class="error">{library.error}</p>{/if}
	<button onclick={() => resyncLibrary()} disabled={library.status === 'syncing'}>Resync now</button>
	<h3>Account</h3>
	<p class="meta">Signed in as {session.credentials?.username}</p>
	<button onclick={signOut}>Sign out</button>
</div>
