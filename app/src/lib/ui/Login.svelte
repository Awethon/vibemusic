<script lang="ts">
	import { logIn } from '../navidrome/session.ts';
	import { session, signedIn } from '../session.svelte.ts';

	let username = $state(session.credentials?.username ?? '');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			signedIn(await logIn(username, password));
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			busy = false;
		}
	}
</script>

<main class="login">
	<form onsubmit={submit}>
		<h1>vibe<span>music</span></h1>
		<p class="note">{session.expired ? 'Your session expired. Sign in again.' : `Navidrome at ${NAVIDROME_TARGET}`}</p>
		<label>Username <input bind:value={username} autocomplete="username" required /></label>
		<label>Password <input type="password" bind:value={password} autocomplete="current-password" required /></label>
		{#if error}<p class="error">{error}</p>{/if}
		<button class="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
	</form>
</main>
