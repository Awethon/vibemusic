import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { query, resyncLibrary } from '../library/library.svelte.ts';
import { albumTracks, artistTracks, ownPlaylists, playlistTracks, type Album, type Artist, type Playlist, type Track } from '../library/queries.ts';
import { player } from '../player/player.svelte.ts';
import { navidrome, requireCredentials } from '../session.svelte.ts';
import { plural } from './format.ts';
import type { MenuItem } from './menu.svelte.ts';
import { addToQueueFromMenu, clearQueued, moveQueuedToTop, playListAnimated, playNextFromMenu, playQueuedNow, playSourceTrackNext, playSourceTrackNow, removeFromSource, removeQueued } from './queueActions.ts';
import { showToast } from './state.svelte.ts';

const SEPARATOR: MenuItem = { separator: true };

export const openAlbum = (id: string) => goto(resolve('/album/[id]', { id }));
export const openArtist = (id: string) => goto(resolve('/artist/[id]', { id }));
export const openPlaylist = (id: string) => goto(resolve('/playlist/[id]', { id }));

async function addTracksToPlaylist(playlist: Playlist, tracks: Track[]) {
	const existing = new Set((await query<{ trackId: string }>('select track_id as trackId from playlist_track where playlist_id = ?', [playlist.id])).map((row) => row.trackId));
	const fresh = tracks.filter((track) => !existing.has(track.id));
	if (!fresh.length) {
		showToast(`Already in ${playlist.name}`);
		return;
	}
	await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIdToAdd: fresh.map((track) => track.id) });
	showToast(`Added ${fresh.length > 1 ? `${plural(fresh.length, 'track')} ` : ''}to ${playlist.name}`);
	await resyncLibrary();
}

async function addToPlaylistEntries(tracks: () => Promise<Track[]>): Promise<MenuItem[]> {
	const playlists = await ownPlaylists(requireCredentials().userId);
	if (!playlists.length) return [];
	return [SEPARATOR, { heading: 'Add to playlist' }, { group: playlists.map((playlist) => ({ label: playlist.name, run: async () => addTracksToPlaylist(playlist, await tracks()) })) }];
}

function collectionEntries(tracks: () => Promise<Track[]>, count: number, sourceName: string, listKey: string, openLabel: string, open: () => void, extra: MenuItem[] = []): MenuItem[] {
	return [
		{ label: 'Play', run: async () => playListAnimated(await tracks(), 0, sourceName, listKey) },
		{ label: 'Play next', hint: plural(count, 'track'), run: async () => playNextFromMenu(await tracks(), sourceName) },
		{ label: 'Add to queue', run: async () => addToQueueFromMenu(await tracks(), sourceName) },
		SEPARATOR,
		{ label: openLabel, run: open },
		...extra
	];
}

export async function trackMenu(tracks: Track[], index: number, sourceName: string, listKey: string, playlist?: Playlist): Promise<MenuItem[]> {
	const track = tracks[index];
	const entries: MenuItem[] = [
		{ label: 'Play', run: () => playListAnimated(tracks, index, sourceName, listKey) },
		{ label: 'Play next', run: () => playNextFromMenu([track], sourceName) },
		{ label: 'Add to queue', run: () => addToQueueFromMenu([track], sourceName) },
		SEPARATOR,
		{ label: 'Go to album', run: () => openAlbum(track.albumId) },
		{ label: 'Go to artist', run: () => openArtist(track.albumArtistId || track.artistId) },
		...(await addToPlaylistEntries(async () => [track]))
	];
	if (playlist?.kind === 'own' && playlist.ownerId === requireCredentials().userId) {
		entries.push(SEPARATOR, {
			label: 'Remove from this playlist',
			run: async () => {
				await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIndexToRemove: index });
				showToast('Removed');
				await resyncLibrary();
			}
		});
	}
	return entries;
}

export async function albumMenu(album: Album): Promise<MenuItem[]> {
	const tracks = () => albumTracks(album.id);
	return collectionEntries(tracks, album.songCount, album.name, `album:${album.id}`, 'Open album', () => openAlbum(album.id), [
		{ label: 'Go to artist', run: () => openArtist(album.artistId) },
		...(await addToPlaylistEntries(tracks))
	]);
}

export function artistMenu(artist: Artist): MenuItem[] {
	return collectionEntries(() => artistTracks(artist.id), artist.trackCount, artist.name, `artist:${artist.id}`, 'Open artist', () => openArtist(artist.id));
}

export function playlistMenu(playlist: Playlist): MenuItem[] {
	return collectionEntries(() => playlistTracks(playlist.id), playlist.songCount, playlist.name, `playlist:${playlist.id}`, 'Open playlist', () => openPlaylist(playlist.id));
}

export function queueRowMenu(row: HTMLElement): MenuItem[] {
	const track = player.tracks[row.dataset.id ?? ''];
	let entries: MenuItem[];
	if (row.dataset.uq !== undefined) {
		const queuedIndex = Number(row.dataset.uq);
		entries = [
			{ label: 'Play now', run: () => playQueuedNow(queuedIndex) },
			{ label: 'Move to top', run: () => moveQueuedToTop(queuedIndex) },
			{ label: 'Remove from queue', run: () => removeQueued(queuedIndex) },
			{ label: 'Clear queued tracks', run: clearQueued }
		];
	} else {
		const sourceIndex = Number(row.dataset.qi);
		entries = [
			{ label: 'Play now', run: () => playSourceTrackNow(sourceIndex) },
			{ label: 'Play next', run: () => playSourceTrackNext(sourceIndex) },
			{ label: 'Remove', run: () => removeFromSource(sourceIndex) }
		];
	}
	if (track) entries.push(SEPARATOR, { label: 'Go to album', run: () => openAlbum(track.albumId) });
	return entries;
}
