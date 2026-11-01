import { setBodyClass } from '../engine/dom.ts';
import { LAYOUT } from '../tuning.ts';

const phoneQuery = matchMedia(LAYOUT.phoneMediaQuery);

export const formFactor = $state({ phone: phoneQuery.matches });

// Set at import time, before installFormFactor runs, so the first render already has the right layout.
setBodyClass('phone', phoneQuery.matches);

export function installFormFactor(): () => void {
	const update = () => {
		formFactor.phone = phoneQuery.matches;
		setBodyClass('phone', phoneQuery.matches);
	};
	update();
	phoneQuery.addEventListener('change', update);
	return () => phoneQuery.removeEventListener('change', update);
}
