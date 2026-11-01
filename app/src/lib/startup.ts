// App start-up, split by what each step depends on: signed-in credentials, the DOM shell,
// or a loaded library.

import { watchConnection } from './connection.svelte.ts';
import { installGestureRecognizer } from './engine/gestures.ts';
import { installIdleTracking } from './engine/idle.svelte.ts';
import { installLongPress } from './engine/longPress.ts';
import { installResizeRelayout } from './engine/layout.svelte.ts';
import { setRailExpanded } from './engine/rail.ts';
import { history, seedHistory } from './history.svelte.ts';
import { startLibrary } from './library/library.svelte.ts';
import { recentlyPlayedAlbums } from './library/queries.ts';
import { restoreSavedQueue, startPlayer, startRemoteControl } from './player/player.svelte.ts';
import { HISTORY } from './tuning.ts';
import { installBrokenImageRetry } from './ui/brokenImages.ts';
import { installFormFactor } from './ui/formFactor.svelte.ts';
import { installKeyboard } from './ui/keyboard.ts';
import { installScreenEdges } from './ui/screenEdges.ts';
import { applyFullScreenStyleClass } from './ui/shell.ts';
import { ui } from './ui/state.svelte.ts';

// Background services that only need credentials: run once after sign-in.
export function startServices() {
	watchConnection();
	installBrokenImageRetry();
	startPlayer();
	void startLibrary();
}

// Global DOM listeners for the app shell. Returns a cleanup for the layout's teardown.
export function installShell(): () => void {
	setRailExpanded(ui.railExpanded, true);
	applyFullScreenStyleClass();
	const cleanups = [
		installFormFactor(),
		installGestureRecognizer(),
		installIdleTracking(),
		installResizeRelayout(),
		installScreenEdges(),
		installKeyboard(),
		installLongPress()
	];
	return () => cleanups.forEach((cleanup) => cleanup());
}

// Work that reads the local library database, so it waits until the first snapshot is loaded.
export function libraryReady() {
	void restoreSavedQueue();
	startRemoteControl();
	// First run on this browser: fill "jump back in" from the server's play history.
	if (!history.items.length) void recentlyPlayedAlbums(HISTORY.maxLength).then((albums) => seedHistory(albums.map((album) => album.id)));
}
