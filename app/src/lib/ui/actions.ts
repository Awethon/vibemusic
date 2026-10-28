import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { query, resyncLibrary } from '../library/library.svelte.ts';
import { albumTracks, artistTracks, isRadio, ownPlaylists, playlistTracks, skipsDisliked, withoutDisliked, type AlbumSummary, type Artist, type Playlist, type Track } from '../library/queries.ts';
import { toggleDislike, trackById } from '../player/player.svelte.ts';
import { navidrome, requireCredentials } from '../session.svelte.ts';
import { plural } from './format.ts';
import type { MenuItem } from './menu.svelte.ts';
import { addToQueueFromMenu, clearQueued, moveQueuedToTop, playListAnimated, playNextFromMenu, playQueuedNow, playSourceTrackNext, playSourceTrackNow, removeFromSource, removeQueued } from './queueActions.ts';
import { isUnreachable } from '../connection.svelte.ts';
import { showToast } from './state.svelte.ts';

const SEPARATOR: MenuItem = { separator: true };

export function reportFailure(what: string, error: unknown) {
	showToast(`Couldn’t ${what}${isUnreachable(error) ? ' — Navidrome isn’t reachable' : ''}`);
}

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
	try {
		await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIdToAdd: fresh.map((track) => track.id) });
	} catch (error) {
		reportFailure(`add to ${playlist.name}`, error);
		return;
	}
	showToast(`Added ${fresh.length > 1 ? `${plural(fresh.length, 'track')} ` : ''}to ${playlist.name}`);
	await resyncLibrary();
}

type ShareResponse = { shares?: { share?: { url?: string }[] } };

async function share(ids: string[], description: string) {
	let url: string | undefined;
	try {
		url = (await navidrome().subsonic<ShareResponse>('createShare', { id: ids, description })).shares?.share?.[0]?.url;
	} catch (error) {
		reportFailure('create a share link', error);
		return;
	}
	if (!url) {
		showToast('Couldn’t create a share link');
		return;
	}
	try {
		await navigator.clipboard.writeText(url);
		showToast('Share link copied');
	} catch {
		showToast(url);
	}
}

const shareEntry = (ids: () => Promise<string[]> | string[], description: string): MenuItem => ({ label: 'Share', hint: 'copies a public link', run: async () => share(await ids(), description) });

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
	if (isRadio(track.id))
		return [
			{ label: 'Play', run: () => playListAnimated(tracks, index, sourceName, listKey) },
			{ label: 'Play next', run: () => playNextFromMenu([track], sourceName) },
			{ label: 'Add to queue', run: () => addToQueueFromMenu([track], sourceName) }
		];
	const entries: MenuItem[] = [
		{ label: 'Play', run: () => playListAnimated(tracks, index, sourceName, listKey) },
		{ label: 'Play next', run: () => playNextFromMenu([track], sourceName) },
		{ label: 'Add to queue', run: () => addToQueueFromMenu([track], sourceName) },
		SEPARATOR,
		{ label: 'Go to album', run: () => openAlbum(track.albumId) },
		{ label: 'Go to artist', run: () => openArtist(track.albumArtistId || track.artistId) },
		shareEntry(() => [track.id], `${track.title} · ${track.artist}`),
		...(await addToPlaylistEntries(async () => [track])),
		SEPARATOR,
		{ label: track.disliked ? 'Undo “I don’t like this song”' : 'I don’t like this song', hint: track.disliked ? undefined : 'skipped in mixes', run: () => dislike(track) }
	];
	if (playlist?.kind === 'own' && !playlist.readonly && playlist.ownerId === requireCredentials().userId) {
		entries.push(SEPARATOR, {
			label: 'Remove from this playlist',
			run: async () => {
				try {
					await navidrome().subsonic('updatePlaylist', { playlistId: playlist.id, songIndexToRemove: index });
				} catch (error) {
					reportFailure(`remove from ${playlist.name}`, error);
					return;
				}
				showToast('Removed');
				await resyncLibrary();
			}
		});
	}
	return entries;
}

async function dislike(track: Track) {
	try {
		await toggleDislike(track);
	} catch (error) {
		reportFailure('save that', error);
		return;
	}
	showToast(track.disliked ? 'Back in genre and This is playlists' : 'Grayed out and skipped in genre and This is playlists');
}

export async function albumMenu(album: AlbumSummary): Promise<MenuItem[]> {
	const tracks = () => albumTracks(album.id);
	return collectionEntries(tracks, album.songCount, album.name, `album:${album.id}`, 'Open album', () => openAlbum(album.id), [
		{ label: 'Go to artist', run: () => openArtist(album.artistId) },
		shareEntry(() => [album.id], `${album.name} · ${album.artist}`),
		...(await addToPlaylistEntries(tracks))
	]);
}

export function artistMenu(artist: Artist): MenuItem[] {
	return collectionEntries(() => artistTracks(artist.id), artist.trackCount, artist.name, `artist:${artist.id}`, 'Open artist', () => openArtist(artist.id));
}

export function playlistMenu(playlist: Playlist): MenuItem[] {
	const tracks = async () => (skipsDisliked(playlist) ? withoutDisliked(await playlistTracks(playlist.id)).tracks : playlistTracks(playlist.id));
	const own = playlist.kind !== 'genre' && playlist.ownerId === requireCredentials().userId;
	const shared = own ? () => [playlist.id] : async () => (await playlistTracks(playlist.id)).map((track) => track.id);
	return collectionEntries(tracks, playlist.songCount, playlist.name, `playlist:${playlist.id}`, 'Open playlist', () => openPlaylist(playlist.id), [shareEntry(shared, playlist.name)]);
}

export function queueRowMenu(row: HTMLElement): MenuItem[] {
	const track = trackById(row.dataset.id ?? '');
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
