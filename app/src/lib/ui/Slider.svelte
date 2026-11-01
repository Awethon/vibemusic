<script lang="ts">
	import { setBodyClass } from '../engine/dom.ts';

	let {
		ratio,
		onchange,
		onrelease,
		className = '',
		id
	}: { ratio: number; onchange: (ratio: number) => void; onrelease?: (ratio: number) => void; className?: string; id?: string } = $props();

	let dragging = $state(false);

	function ratioOf(element: HTMLElement, event: PointerEvent) {
		const rect = element.getBoundingClientRect();
		return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
	}

	function down(event: PointerEvent) {
		if (event.button !== 0) return;
		const element = event.currentTarget as HTMLElement;
		dragging = true;
		setBodyClass('no-select', true);
		element.setPointerCapture(event.pointerId);
		onchange(ratioOf(element, event));
	}

	function move(event: PointerEvent) {
		if (!dragging) return;
		if (event.buttons === 0) return release(event);
		onchange(ratioOf(event.currentTarget as HTMLElement, event));
	}

	function release(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		setBodyClass('no-select', false);
		onrelease?.(ratioOf(event.currentTarget as HTMLElement, event));
	}
</script>

<div
	class="slider {className}"
	class:drag={dragging}
	{id}
	role="slider"
	tabindex="-1"
	aria-valuenow={Math.round(ratio * 100)}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={release}
	onpointercancel={release}
	onlostpointercapture={release}
>
	<div class="rail"><div class="fill" style:transform="scaleX({ratio})"></div></div>
	<div class="knob" style:left="{ratio * 100}%"></div>
</div>
