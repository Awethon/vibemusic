import { player, playerQueue } from '../player/player.svelte.ts';
import { IDLE } from '../tuning.ts';
import { formFactor } from '../ui/formFactor.svelte.ts';
import { anyMenuOpen } from '../ui/menu.svelte.ts';
import { ui } from '../ui/state.svelte.ts';
import { bodyHasClass, setBodyClass } from './dom.ts';
import { settlePalette } from './palette.ts';

export const idle = $state({ isIdle: false, isResting: false });

let lastActivityAt = performance.now();
const idleDelayMs = Number(new URLSearchParams(location.search).get('idle')) || IDLE.defaultDelayMs;

export function wakeFromIdle() {
	lastActivityAt = performance.now();
	if (idle.isIdle) {
		idle.isIdle = false;
		setBodyClass('idle', false);
		if (!bodyHasClass('now-open')) settlePalette(false);
	}
	if (idle.isResting) {
		idle.isResting = false;
		setBodyClass('rest', false);
	}
}

const somethingKeepsUiAwake = () => formFactor.phone || ui.searchOpen || ui.panelOpen || ui.queuePressed || anyMenuOpen() || document.activeElement?.matches('input, textarea');

function enterIdleOrRest() {
	if (bodyHasClass('now-open')) {
		if (ui.fullScreenStyle === 'minimal') {
			idle.isResting = true;
			setBodyClass('rest', true);
		}
		return;
	}
	idle.isIdle = true;
	setBodyClass('idle', true);
	settlePalette(true);
}

function checkIdle() {
	if (idle.isIdle || idle.isResting || !playerQueue().currentTrackId || !player.playing) return;
	if (somethingKeepsUiAwake() || performance.now() - lastActivityAt <= idleDelayMs) return;
	enterIdleOrRest();
}

const wakeOnBrowseScroll = (event: Event) => {
	if (event.target instanceof Element && event.target.closest('#chrome')) wakeFromIdle();
};

export function installIdleTracking() {
	const options = { passive: true } as const;
	addEventListener('pointermove', wakeFromIdle, options);
	addEventListener('pointerdown', wakeFromIdle, { passive: true, capture: true });
	addEventListener('touchmove', wakeFromIdle, options);
	addEventListener('scroll', wakeOnBrowseScroll, { passive: true, capture: true });
	addEventListener('wheel', wakeFromIdle, options);
	addEventListener('keydown', wakeFromIdle, options);
	const timer = setInterval(checkIdle, IDLE.checkIntervalMs);
	return () => {
		removeEventListener('pointermove', wakeFromIdle);
		removeEventListener('pointerdown', wakeFromIdle, { capture: true });
		removeEventListener('touchmove', wakeFromIdle);
		removeEventListener('scroll', wakeOnBrowseScroll, { capture: true });
		removeEventListener('wheel', wakeFromIdle);
		removeEventListener('keydown', wakeFromIdle);
		clearInterval(timer);
	};
}
