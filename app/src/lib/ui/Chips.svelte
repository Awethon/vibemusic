<script lang="ts" generics="T extends string">
	let { options, value, onchange }: { options: { value: T; label: string }[]; value: T; onchange: (value: T) => void } = $props();
</script>

<div class="chips">
	{#each options as option (option.value)}
		<button class="chip" class:active={option.value === value} onclick={() => onchange(option.value)}>{option.label}</button>
	{/each}
</div>
