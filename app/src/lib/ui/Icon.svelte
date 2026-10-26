<script lang="ts">
	import { ICONS, type IconName } from './icons.ts';

	let { name }: { name: IconName } = $props();
</script>

{@html ICONS[name]}
