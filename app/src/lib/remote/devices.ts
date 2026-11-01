import type { IconName } from '../ui/icons.ts';
import { relay, type Device } from './relay.svelte.ts';

export const deviceIcon = (device: Device | null): IconName =>
	!device ? 'speaker' : /iPhone|Android/.test(device.name) ? 'phone' : 'laptop';

export function deviceLabels(): Map<string, string> {
	const counts = new Map<string, number>();
	const labels = new Map<string, string>();
	for (const device of relay.devices) {
		const seen = (counts.get(device.name) ?? 0) + 1;
		counts.set(device.name, seen);
		labels.set(device.id, seen > 1 ? `${device.name} (${seen})` : device.name);
	}
	return labels;
}

export const deviceLabel = (id: string | null) => (id ? (deviceLabels().get(id) ?? '') : '');
