<script lang="ts">
	import { formFactor } from './formFactor.svelte.ts';
	import { POPOVER } from '../tuning.ts';
	import { closeMenu, menu, type MenuItem } from './menu.svelte.ts';

	let element = $state<HTMLElement | null>(null);
	let position = $state({ left: 0, top: 0 });

	$effect(() => {
		if (!menu.open || !element) return;
		void menu.items;
		position = { left: 0, top: 0 };
		requestAnimationFrame(() => {
			if (!element) return;
			const size = element.getBoundingClientRect();
			position = {
				left: Math.min(menu.x, innerWidth - size.width - POPOVER.edgeMarginPx),
				top: Math.max(POPOVER.edgeMarginPx, Math.min(menu.y, innerHeight - size.height - POPOVER.edgeMarginPx))
			};
		});
	});

	function run(item: MenuItem) {
		closeMenu();
		if ('run' in item) void item.run();
	}
</script>

<svelte:window onpointerdown={(event) => menu.open && !element?.contains(event.target as Node) && closeMenu()} onblur={closeMenu} />

{#snippet button(item: MenuItem)}
	{#if 'run' in item}
		<button type="button" role="menuitem" onclick={() => run(item)}
			>{item.label}{#if item.hint}<span>{item.hint}</span>{/if}</button
		>
	{/if}
{/snippet}

<div
	id="ctx"
	class="menu"
	class:open={menu.open}
	role="menu"
	bind:this={element}
	style:left={formFactor.phone ? undefined : `${position.left}px`}
	style:top={formFactor.phone ? undefined : `${position.top}px`}
>
	{#each menu.items as item, index (index)}
		{#if 'separator' in item}
			<hr />
		{:else if 'heading' in item}
			<p class="mh">{item.heading}</p>
		{:else if 'group' in item}
			<div class="mscroll">
				{#each item.group as child, childIndex (childIndex)}{@render button(child)}{/each}
			</div>
		{:else}
			{@render button(item)}
		{/if}
	{/each}
</div>
