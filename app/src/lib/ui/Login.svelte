<script lang="ts">
	import { onMount } from 'svelte';
	import { AdminExistsError, createAdmin, isFirstRun, logIn } from '../navidrome/session.ts';
	import { session, signedIn } from '../session.svelte.ts';

	let username = $state(session.credentials?.username ?? '');
	let password = $state('');
	let confirmation = $state('');
	let error = $state('');
	let busy = $state(false);
	// A new Navidrome with no users: the form creates its first (admin) account instead.
	let firstRun = $state(false);

	onMount(() => {
		if (!session.credentials) void isFirstRun().then((first) => (firstRun = first));
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (firstRun && !username.trim()) {
			error = 'Choose a username';
			return;
		}
		if (firstRun && password !== confirmation) {
			error = 'The passwords don’t match';
			return;
		}
		busy = true;
		try {
			signedIn(firstRun ? await createAdmin(username.trim(), password) : await logIn(username, password));
		} catch (failure) {
			if (failure instanceof AdminExistsError) firstRun = false;
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			busy = false;
		}
	}
</script>

<main class="login">
	<form onsubmit={submit}>
		<h1>vibe<span>music</span></h1>
		{#if firstRun}
			<p class="note">
				Welcome! Create the first account. It’s also Navidrome’s admin, for managing users and settings in Navidrome’s own web UI.
			</p>
		{:else}
			<p class="note">{session.expired ? 'Your session expired. Sign in again.' : 'Sign in with your Navidrome account.'}</p>
		{/if}
		<p class="server">{new URL(NAVIDROME_TARGET).host}</p>
		<label>Username <input bind:value={username} autocomplete="username" required /></label>
		<label
			>Password <input
				type="password"
				bind:value={password}
				autocomplete={firstRun ? 'new-password' : 'current-password'}
				required
			/></label
		>
		{#if firstRun}
			<label>Confirm password <input type="password" bind:value={confirmation} autocomplete="new-password" required /></label>
		{/if}
		{#if error}<p class="error">{error}</p>{/if}
		<button class="btn" disabled={busy}>{busy ? (firstRun ? 'Creating…' : 'Signing in…') : firstRun ? 'Create account' : 'Sign in'}</button>
	</form>
</main>
