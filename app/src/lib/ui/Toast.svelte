<script lang="ts">
	import { ui } from './state.svelte.ts';
</script>

<div id="toast" class:on={ui.toastVisible} role="status">{ui.toast}</div>
