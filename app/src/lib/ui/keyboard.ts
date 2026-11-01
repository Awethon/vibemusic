import { bodyHasClass } from '../engine/dom.ts';
import { previewPalette } from '../engine/palette.ts';
import { playNextTrack, playPreviousTrack, seekBy, togglePlay } from '../player/player.svelte.ts';
import { PLAYBACK } from '../tuning.ts';
import { anyMenuOpen, closeAllMenus } from './menu.svelte.ts';
import { setFullScreen, toggleFullScreen, togglePanel, togglePanelTab } from './shell.ts';
import { ui } from './state.svelte.ts';

// Escape peels off one layer at a time, top layer first.
function closeTopmost() {
	if (ui.searchOpen) {
		ui.searchOpen = false;
		previewPalette(null);
		return true;
	}
	if (anyMenuOpen()) {
		closeAllMenus();
		return true;
	}
	if (bodyHasClass('now-open')) {
		setFullScreen(false);
		return true;
	}
	if (bodyHasClass('panel-open')) {
		togglePanel(false);
		return true;
	}
	return false;
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && closeTopmost()) return;
	// Leave typing and the browser's own Cmd/Ctrl shortcuts alone.
	if ((event.target instanceof Element && event.target.matches('input, textarea')) || event.metaKey || event.ctrlKey || ui.searchOpen)
		return;
	if (event.key === '/') ui.searchOpen = true;
	else if (event.code === 'Space') togglePlay();
	else if (event.shiftKey && event.key === 'ArrowRight') playNextTrack();
	else if (event.shiftKey && event.key === 'ArrowLeft') playPreviousTrack();
	else if (event.altKey && event.key === 'ArrowRight') seekBy(PLAYBACK.seekStepSeconds);
	else if (event.altKey && event.key === 'ArrowLeft') seekBy(-PLAYBACK.seekStepSeconds);
	else if (event.key === 'q') togglePanelTab('queue');
	else if (event.key === 'l') togglePanelTab('lyrics');
	else if (event.key === 'f') toggleFullScreen();
	else return;
	event.preventDefault();
}

export function installKeyboard(): () => void {
	addEventListener('keydown', onKeydown);
	return () => removeEventListener('keydown', onKeydown);
}
