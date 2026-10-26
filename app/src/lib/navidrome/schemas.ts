import { z } from 'zod';

const optionalNumber = z.number().nullish().transform((value) => value ?? 0);
const optionalString = z.string().nullish().transform((value) => value ?? '');
const optionalDate = z.string().nullish().transform((value) => (value && !value.startsWith('0001') ? value : ''));

export const nativeAlbum = z.object({
	id: z.string(),
	name: z.string(),
	albumArtistId: optionalString,
	albumArtist: optionalString,
	orderAlbumArtistName: optionalString,
	orderAlbumName: optionalString,
	maxYear: optionalNumber,
	genre: optionalString,
	genres: z.array(z.object({ name: z.string() })).nullish().transform((value) => value ?? []),
	songCount: optionalNumber,
	duration: optionalNumber,
	createdAt: optionalDate,
	updatedAt: optionalDate,
	playCount: optionalNumber,
	playDate: optionalDate,
	starred: z.boolean().nullish().transform((value) => value ?? false),
	participants: z
		.object({ albumartist: z.array(z.object({ id: z.string(), name: z.string() })).nullish() })
		.nullish()
		.transform((value) => value?.albumartist ?? [])
});

export const nativeSong = z.object({
	id: z.string(),
	albumId: z.string(),
	title: z.string(),
	artist: optionalString,
	artistId: optionalString,
	trackNumber: optionalNumber,
	discNumber: optionalNumber,
	duration: optionalNumber,
	suffix: optionalString,
	bitRate: optionalNumber,
	playCount: optionalNumber,
	playDate: optionalDate,
	starred: z.boolean().nullish().transform((value) => value ?? false)
});

export const nativePlaylist = z.object({
	id: z.string(),
	name: z.string(),
	ownerId: optionalString,
	songCount: optionalNumber,
	duration: optionalNumber,
	updatedAt: optionalDate,
	evaluatedAt: optionalDate,
	rules: z.unknown().nullish().transform((value) => value ?? null),
	uploadedImage: optionalString,
	sync: z.boolean().nullish().transform((value) => value ?? false)
});

export const nativePlaylistTrack = z.object({
	id: z.string(),
	mediaFileId: z.string()
});

export type NativeAlbum = z.infer<typeof nativeAlbum>;
export type NativeSong = z.infer<typeof nativeSong>;
export type NativePlaylist = z.infer<typeof nativePlaylist>;
export type NativePlaylistTrack = z.infer<typeof nativePlaylistTrack>;
