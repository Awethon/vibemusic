// Instance-wide settings from /config.json, next to index.html. The app is a static build, so this
// file is how a host configures it without rebuilding. A missing or broken file means defaults.
// The page loads it before the app mounts (routes/+layout.ts) and hands it to the library worker.
// Genre playlist changes apply on each client's next library load (the playlists are rebuilt).
// Settings defaults apply to every setting a visitor hasn't changed in their browser.
//
// Environment variables (all optional; lists are comma-separated):
//   VIBEMUSIC_GENRE_HIDDEN         genres never turned into playlists
//   VIBEMUSIC_GENRE_PINNED         genres that always get a playlist, even below the size thresholds
//   VIBEMUSIC_GENRE_MAX_PLAYLISTS  most genre playlists (default 24)
//   VIBEMUSIC_GENRE_SONG_CAP       most songs per genre playlist (default 100)
//   VIBEMUSIC_GENRE_MIN_SONGS      songs a genre needs (default 30, sub-genres 50)
//   VIBEMUSIC_GENRE_MIN_ARTISTS    artists a genre needs (default 2, sub-genres 3)
//   VIBEMUSIC_DEFAULT_BACKGROUND   field | amber (caustics)            (default field)
//   VIBEMUSIC_DEFAULT_RIPPLES      on | off                            (default off)
//   VIBEMUSIC_DEFAULT_FULL_SCREEN  minimal | classic                   (default minimal)
//   VIBEMUSIC_DEFAULT_SIDEBAR      open | mini                         (default mini)
//   VIBEMUSIC_DEFAULT_ARTIST_VIEW  list | grid                         (default list)
//   VIBEMUSIC_DEFAULT_TIMELINE     on | off, Timeline in the nav       (default on)
//   VIBEMUSIC_DEFAULT_RADIO        on | off, Radio in the nav          (default on)
//   VIBEMUSIC_DEFAULT_GLASS        on | off, liquid glass              (default off)
//   VIBEMUSIC_DEFAULT_GLASS_LOOK   default | clear | frosted | prism | pebble | bubble | slab, or a
//                                  look code from the glass page (Settings → Tune liquid glass)
// An unknown value is ignored.
//
// With Caddy serving the app, it can answer /config.json from its own environment. Unset variables
// come out as "", which means default; values must not contain double quotes:
//
//   handle /config.json {
//     header Content-Type application/json
//     header Cache-Control no-cache
//     respond `{
//       "genrePlaylists": {
//         "hidden": "{env.VIBEMUSIC_GENRE_HIDDEN}",
//         "pinned": "{env.VIBEMUSIC_GENRE_PINNED}",
//         "maxPlaylists": "{env.VIBEMUSIC_GENRE_MAX_PLAYLISTS}",
//         "songCap": "{env.VIBEMUSIC_GENRE_SONG_CAP}",
//         "minSongs": "{env.VIBEMUSIC_GENRE_MIN_SONGS}",
//         "minArtists": "{env.VIBEMUSIC_GENRE_MIN_ARTISTS}"
//       },
//       "settings": {
//         "background": "{env.VIBEMUSIC_DEFAULT_BACKGROUND}",
//         "ripples": "{env.VIBEMUSIC_DEFAULT_RIPPLES}",
//         "fullScreen": "{env.VIBEMUSIC_DEFAULT_FULL_SCREEN}",
//         "sidebar": "{env.VIBEMUSIC_DEFAULT_SIDEBAR}",
//         "artistView": "{env.VIBEMUSIC_DEFAULT_ARTIST_VIEW}",
//         "timeline": "{env.VIBEMUSIC_DEFAULT_TIMELINE}",
//         "radio": "{env.VIBEMUSIC_DEFAULT_RADIO}",
//         "glass": "{env.VIBEMUSIC_DEFAULT_GLASS}",
//         "glassLook": "{env.VIBEMUSIC_DEFAULT_GLASS_LOOK}"
//       }
//     }` 200
//   }
//
// Without Caddy, write the file by hand, e.g.
// {"genrePlaylists": {"hidden": ["Christmas"], "songCap": 60}, "settings": {"background": "amber"}}.
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

export const SETTING_DEFAULT_NAMES = [
	'background',
	'ripples',
	'fullScreen',
	'sidebar',
	'artistView',
	'timeline',
	'radio',
	'glass',
	'glassLook'
] as const;
export type SettingDefaults = Partial<Record<(typeof SETTING_DEFAULT_NAMES)[number], string>>;

export type ServerConfig = { genrePlaylists: GenrePlaylistConfig; settings: SettingDefaults };

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

// Checked against each setting's allowed values where it is read (ui/preferences.ts).
const setting = z
	.unknown()
	.optional()
	.transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined));

const schema = z.object({
	genrePlaylists: z
		.object({ hidden: list, pinned: list, maxPlaylists: count, songCap: count, minSongs: count, minArtists: count })
		.prefault({}),
	settings: z
		.object(
			Object.fromEntries(SETTING_DEFAULT_NAMES.map((name) => [name, setting])) as Record<
				(typeof SETTING_DEFAULT_NAMES)[number],
				typeof setting
			>
		)
		.prefault({})
		.transform((settings) => Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as SettingDefaults)
});

export const DEFAULT_SERVER_CONFIG: ServerConfig = { genrePlaylists: { hidden: [], pinned: [] }, settings: {} };

export function parseServerConfig(json: unknown): ServerConfig {
	const parsed = schema.safeParse(json ?? {});
	return parsed.success ? parsed.data : DEFAULT_SERVER_CONFIG;
}

async function fetchServerConfig(): Promise<ServerConfig> {
	try {
		const response = await fetch('/config.json', { cache: 'no-cache' });
		if (!response.ok) return DEFAULT_SERVER_CONFIG;
		return parseServerConfig(await response.json());
	} catch {
		return DEFAULT_SERVER_CONFIG;
	}
}

let loaded: Promise<ServerConfig> | null = null;

// Fetched once per page; later calls share the result.
export function serverConfig(): Promise<ServerConfig> {
	return (loaded ??= fetchServerConfig());
}
