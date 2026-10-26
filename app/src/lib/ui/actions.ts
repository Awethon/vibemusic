import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { resyncLibrary, query } from '../library/library.svelte.ts';
import { albumTracks, artistTracks, ownPlaylists, playlistTracks, type Album, type Artist, type Playlist, type Track } from '../library/queries.ts';
import { navidrome, requireCredentials } from '../session.svelte.ts';
import * as queue from '../player/queue.ts';
import { editQueue, playQueuedAt, playSourceNow, playTracks, player, queueLast, queueNext } from '../player/player.svelte.ts';
import type { MenuItem } from './menu.svelte.ts';
import { showToast } from './state.svelte.ts';

export const openAlbum = (id: string) => goto(resolve('/album/[id]', { id }));
export const openArtist = (id: string) => goto(resolve('/artist/[id]', { id }));
export const openPlaylist = (id: string) => goto(resolve('/playlist/[id]', { id }));

export function playNextWithToast(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	const wasEmpty = !player.queue.currentTrackId;
	queueNext(tracks, sourceName);
	if (!wasEmpty) showToast(tracks.length === 1 ? 'Plays next' : `${tracks.length} tracks will play next`);
}

export function addToQueueWithToast(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	const wasEmpty = !player.queue.currentTrackId;
	queueLast(tracks, sourceName);
	if (!wasEmpty) showToast(tracks.length === 1 ? 'Added to queue' : `Added ${tracks.length} tracks to queue`);
}

async function addToPlaylist(playlist: Playlist, tracks: Track[]) {
	const existing = new Set((await query<{ trackId: string }>('select track_id as trackId from playlist_track where playlist_id = ?', [playlist.id])).map((row) => row.trackId));
	const fresh = tracks.filter((track) => !existing.has(track.id));
	if (!fresh.length) {
		showToast(`Already in ${playlist.name}`);
		return;
	}
	await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIdToAdd: fresh.map((track) => track.id) });
	showToast(`Added to ${playlist.name}`);
	await resyncLibrary();
}

async function playlistItems(tracks: () => Promise<Track[]>): Promise<MenuItem[]> {
	const playlists = await ownPlaylists(requireCredentials().userId);
	if (!playlists.length) return [];
	return [{ separator: true }, ...playlists.map((playlist) => ({ label: `Add to ${playlist.name}`, run: async () => addToPlaylist(playlist, await tracks()) }))];
}

export async function trackMenu(tracks: Track[], index: number, sourceName: string, listKey: string, playlist?: Playlist): Promise<MenuItem[]> {
	const track = tracks[index];
	const items: MenuItem[] = [
		{ label: 'Play', run: () => playTracks(tracks, index, sourceName, listKey) },
		{ label: 'Play next', run: () => playNextWithToast([track], sourceName) },
		{ label: 'Add to queue', run: () => addToQueueWithToast([track], sourceName) },
		{ separator: true },
		{ label: 'Go to album', run: () => openAlbum(track.albumId) },
		{ label: 'Go to artist', run: () => openArtist(track.albumArtistId || track.artistId) },
		...(await playlistItems(async () => [track]))
	];
	if (playlist?.kind === 'own' && playlist.ownerId === requireCredentials().userId) {
		items.push({
			label: 'Remove from this playlist',
			run: async () => {
				await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIndexToRemove: index });
				showToast(`Removed from ${playlist.name}`);
				await resyncLibrary();
			}
		});
	}
	return items;
}

export async function albumMenu(album: Album): Promise<MenuItem[]> {
	const tracks = () => albumTracks(album.id);
	return [
		{ label: 'Play', run: async () => playTracks(await tracks(), 0, album.name, `album:${album.id}`) },
		{ label: `Play next (${album.songCount})`, run: async () => playNextWithToast(await tracks(), album.name) },
		{ label: 'Add to queue', run: async () => addToQueueWithToast(await tracks(), album.name) },
		{ separator: true },
		{ label: 'Open album', run: () => openAlbum(album.id) },
		{ label: 'Go to artist', run: () => openArtist(album.artistId) },
		...(await playlistItems(tracks))
	];
}

export function artistMenu(artist: Artist): MenuItem[] {
	const tracks = () => artistTracks(artist.id);
	return [
		{ label: 'Play', run: async () => playTracks(await tracks(), 0, artist.name, `artist:${artist.id}`) },
		{ label: 'Play next', run: async () => playNextWithToast(await tracks(), artist.name) },
		{ label: 'Add to queue', run: async () => addToQueueWithToast(await tracks(), artist.name) },
		{ separator: true },
		{ label: 'Open', run: () => openArtist(artist.id) }
	];
}

export function playlistMenu(playlist: Playlist): MenuItem[] {
	const tracks = () => playlistTracks(playlist.id);
	return [
		{ label: 'Play', run: async () => playTracks(await tracks(), 0, playlist.name, `playlist:${playlist.id}`) },
		{ label: 'Play next', run: async () => playNextWithToast(await tracks(), playlist.name) },
		{ label: 'Add to queue', run: async () => addToQueueWithToast(await tracks(), playlist.name) },
		{ separator: true },
		{ label: 'Open', run: () => openPlaylist(playlist.id) }
	];
}

export function queuedRowMenu(index: number): MenuItem[] {
	const trackId = player.queue.userQueue[index]?.trackId;
	const track = trackId ? player.tracks[trackId] : null;
	return [
		{ label: 'Play now', run: () => playQueuedAt(index) },
		{ label: 'Move to top', run: () => editQueue((state) => queue.moveQueuedToTop(state, index)) },
		{ label: 'Remove from queue', run: () => editQueue((state) => queue.removeQueuedAt(state, index)) },
		{ label: 'Clear queued tracks', run: () => clearQueuedWithToast() },
		...(track ? [{ separator: true } as const, { label: 'Go to album', run: () => openAlbum(track.albumId) }] : [])
	];
}

export function sourceRowMenu(sourceIndex: number): MenuItem[] {
	const trackId = player.queue.sourceQueue[sourceIndex]?.trackId;
	const track = trackId ? player.tracks[trackId] : null;
	return [
		{ label: 'Play now', run: () => playSourceNow(sourceIndex) },
		{
			label: 'Play next',
			run: () => {
				editQueue((state) => queue.moveSourceToPlayNext(state, sourceIndex));
				showToast('Plays next');
			}
		},
		{ label: 'Remove', run: () => editQueue((state) => queue.removeSourceAt(state, sourceIndex)) },
		...(track ? [{ separator: true } as const, { label: 'Go to album', run: () => openAlbum(track.albumId) }] : [])
	];
}

export function clearQueuedWithToast() {
	editQueue((state) => queue.clearQueued(state));
	showToast('Queue cleared');
}
