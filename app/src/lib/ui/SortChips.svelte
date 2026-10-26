<script lang="ts" generics="T extends string">
	let { options, value, onchange }: { options: readonly (readonly [T, string])[]; value: T; onchange: (value: T) => void } = $props();
</script>

<div class="chips">
	{#each options as [key, label] (key)}
		<button class="chip" class:on={value === key} type="button" onclick={() => onchange(key)}>{label}</button>
	{/each}
</div>
