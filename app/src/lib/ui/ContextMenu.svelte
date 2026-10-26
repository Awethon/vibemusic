<script lang="ts">
	import { POPOVER } from '../tuning.ts';
	import { closeMenu, menu, type MenuItem } from './menu.svelte.ts';

	let element = $state<HTMLElement | null>(null);
	let position = $state({ left: 0, top: 0 });

	$effect(() => {
		if (!menu.open || !element) return;
		const { width, height } = element.getBoundingClientRect();
		position = {
			left: Math.min(menu.x, innerWidth - width - POPOVER.edgeMarginPx),
			top: Math.min(menu.y, innerHeight - height - POPOVER.edgeMarginPx)
		};
	});

	function run(item: MenuItem) {
		closeMenu();
		if ('run' in item) void item.run();
	}
</script>

<svelte:window onpointerdown={(event) => menu.open && !element?.contains(event.target as Node) && closeMenu()} onblur={closeMenu} />

{#if menu.open}
	<div class="menu" bind:this={element} style:left="{position.left}px" style:top="{position.top}px" role="menu">
		{#each menu.items as item, index (index)}
			{#if 'separator' in item}
				<hr />
			{:else}
				<button role="menuitem" disabled={item.disabled} onclick={() => run(item)}>{item.label}</button>
			{/if}
		{/each}
	</div>
{/if}
