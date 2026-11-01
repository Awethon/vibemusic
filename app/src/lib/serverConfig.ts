// Instance-wide settings from /config.json, next to index.html. The app is a static build, so this
// file is how a host configures it without rebuilding. A missing or broken file means defaults.
// Changes apply on each client's next library load (the genre playlists are rebuilt).
//
// Environment variables (all optional; lists are comma-separated):
//   VIBEMUSIC_GENRE_HIDDEN         genres never turned into playlists
//   VIBEMUSIC_GENRE_PINNED         genres that always get a playlist, even below the size thresholds
//   VIBEMUSIC_GENRE_MAX_PLAYLISTS  most genre playlists (default 24)
//   VIBEMUSIC_GENRE_SONG_CAP       most songs per genre playlist (default 100)
//   VIBEMUSIC_GENRE_MIN_SONGS      songs a genre needs (default 30, sub-genres 50)
//   VIBEMUSIC_GENRE_MIN_ARTISTS    artists a genre needs (default 2, sub-genres 3)
//
// With Caddy serving the app, it can answer /config.json from its own environment. Unset variables
// come out as "", which means default; values must not contain double quotes:
//
//   handle /config.json {
//     header Content-Type application/json
//     header Cache-Control no-cache
//     respond `{"genrePlaylists": {"hidden": "{env.VIBEMUSIC_GENRE_HIDDEN}", "pinned": "{env.VIBEMUSIC_GENRE_PINNED}",
//       "maxPlaylists": "{env.VIBEMUSIC_GENRE_MAX_PLAYLISTS}", "songCap": "{env.VIBEMUSIC_GENRE_SONG_CAP}",
//       "minSongs": "{env.VIBEMUSIC_GENRE_MIN_SONGS}", "minArtists": "{env.VIBEMUSIC_GENRE_MIN_ARTISTS}"}}` 200
//   }
//
// Without Caddy, write the file by hand, e.g. {"genrePlaylists": {"hidden": ["Christmas"], "songCap": 60}}.
import { z } from 'zod';

export type GenrePlaylistConfig = {
	// Genres never turned into playlists.
	hidden: string[];
	// Genres that always get a playlist, even below the size thresholds.
	pinned: string[];
	maxPlaylists?: number;
	songCap?: number;
	// Minimum songs and artists a genre needs, for top-level genres and sub-genres alike.
	minSongs?: number;
	minArtists?: number;
};

export type ServerConfig = { genrePlaylists: GenrePlaylistConfig };

const list = z
	.union([z.string(), z.array(z.string())])
	.optional()
	.transform((value) => (typeof value === 'string' ? value.split(',') : (value ?? [])).map((genre) => genre.trim()).filter(Boolean));

const count = z
	.union([z.string(), z.number()])
	.optional()
	.transform((value) => {
		const number = typeof value === 'string' ? (value.trim() ? Number(value) : NaN) : (value ?? NaN);
		return Number.isInteger(number) && number > 0 ? number : undefined;
	});

const schema = z.object({
	genrePlaylists: z
		.object({ hidden: list, pinned: list, maxPlaylists: count, songCap: count, minSongs: count, minArtists: count })
		.prefault({})
});

export const DEFAULT_SERVER_CONFIG: ServerConfig = { genrePlaylists: { hidden: [], pinned: [] } };

export function parseServerConfig(json: unknown): ServerConfig {
	const parsed = schema.safeParse(json ?? {});
	return parsed.success ? parsed.data : DEFAULT_SERVER_CONFIG;
}

export async function loadServerConfig(): Promise<ServerConfig> {
	try {
		const response = await fetch('/config.json', { cache: 'no-cache' });
		if (!response.ok) return DEFAULT_SERVER_CONFIG;
		return parseServerConfig(await response.json());
	} catch {
		return DEFAULT_SERVER_CONFIG;
	}
}
