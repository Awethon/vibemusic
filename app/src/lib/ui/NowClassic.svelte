<script lang="ts">
	import { currentTrack, playerQueue } from '../player/player.svelte.ts';
	import { COVER_PX, LYRICS } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';
	import LyricsLines from './LyricsLines.svelte';
	import { setFullScreen } from './shell.ts';
	import { ui } from './state.svelte.ts';
	import TrackLinks from './TrackLinks.svelte';

	const track = $derived(currentTrack());
</script>

<section id="classic" aria-label="Now playing">
	<header class="cl-head">
		<span class="eyebrow">{playerQueue().sourceName ? `Playing from ${playerQueue().sourceName}` : 'Now playing'}</span>
		<button class="icon-btn" type="button" aria-label="Exit full screen" onclick={() => setFullScreen(false)}><Icon name="collapse" /></button>
	</header>
	<div class="cl-stage">
		<div class="cl-left">
			<Cover albumId={track?.albumId} size={COVER_PX.nowClassic} eager />
			<h1>{track?.title ?? ''}</h1>
			<p>{#if track}<TrackLinks {track} />{/if}</p>
		</div>
		<LyricsLines outerClass="cl-lyrics" innerClass="cl-lines" outerId="clLyrics" focusRatio={LYRICS.focusLineRatio.classic} visible={ui.fullScreen && ui.fullScreenStyle === 'classic'} />
	</div>
</section>
