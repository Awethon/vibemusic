<script lang="ts">
	import { isRadio } from '../library/queries.ts';
	import { lyricsState } from '../player/lyricsState.svelte.ts';
	import { currentTrack, playerQueue } from '../player/player.svelte.ts';
	import { COVER_PX, LYRICS } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';
	import LyricsLines from './LyricsLines.svelte';
	import { setFullScreen } from './shell.ts';
	import { ui } from './state.svelte.ts';
	import TrackLinks from './TrackLinks.svelte';

	const track = $derived(currentTrack());
	const noLyrics = $derived(!!lyricsState.trackId && !lyricsState.loading && !lyricsState.lyrics);
</script>

<section id="classic" aria-label="Now playing">
	<header class="cl-head">
		<span class="eyebrow">{playerQueue().sourceName ? `Playing from ${playerQueue().sourceName}` : 'Now playing'}</span>
		<button class="icon-btn" type="button" aria-label="Exit full screen" onclick={() => setFullScreen(false)}><Icon name="collapse" /></button>
	</header>
	<div class="cl-stage" class:solo={noLyrics}>
		<div class="cl-left">
			<Cover albumId={track?.albumId} icon={isRadio(track?.id) ? 'radio' : undefined} size={COVER_PX.nowClassic} eager />
			<h1>{track?.title ?? ''}</h1>
			<p>{#if track}<TrackLinks {track} />{/if}</p>
		</div>
		<LyricsLines outerClass="cl-lyrics" innerClass="cl-lines" outerId="clLyrics" focusRatio={LYRICS.focusLineRatio.classic} visible={ui.fullScreen && ui.fullScreenStyle === 'classic'} />
	</div>
</section>
