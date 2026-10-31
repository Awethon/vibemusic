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

export function startServices() {
	watchConnection();
	installBrokenImageRetry();
	startPlayer();
	void startLibrary();
}

export function installShell(): () => void {
	setRailExpanded(ui.railExpanded, true);
	applyFullScreenStyleClass();
	const cleanups = [installFormFactor(), installGestureRecognizer(), installIdleTracking(), installResizeRelayout(), installScreenEdges(), installKeyboard(), installLongPress()];
	return () => cleanups.forEach((cleanup) => cleanup());
}

export function libraryReady() {
	void restoreSavedQueue();
	startRemoteControl();
	if (!history.items.length) void recentlyPlayedAlbums(HISTORY.maxLength).then((albums) => seedHistory(albums.map((album) => album.id)));
}
