import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_CONFIG, parseServerConfig } from './serverConfig.ts';

describe('parseServerConfig', () => {
	it('reads the strings Caddy fills in, ignoring unset ("") values', () => {
		expect(
			parseServerConfig({
				genrePlaylists: { hidden: 'Nu Metal, Christmas', pinned: '', maxPlaylists: '12', songCap: '', minSongs: '20', minArtists: ' ' }
			})
		).toEqual({
			genrePlaylists: {
				hidden: ['Nu Metal', 'Christmas'],
				pinned: [],
				maxPlaylists: 12,
				songCap: undefined,
				minSongs: 20,
				minArtists: undefined
			}
		});
	});

	it('accepts a hand-written file with arrays and numbers', () => {
		expect(parseServerConfig({ genrePlaylists: { hidden: ['Trap'], pinned: ['Jazz'], songCap: 50 } }).genrePlaylists).toMatchObject({
			hidden: ['Trap'],
			pinned: ['Jazz'],
			songCap: 50
		});
	});

	it('ignores numbers that are not positive whole numbers', () => {
		expect(parseServerConfig({ genrePlaylists: { maxPlaylists: '-3', songCap: 'many', minSongs: 2.5 } }).genrePlaylists).toMatchObject({
			maxPlaylists: undefined,
			songCap: undefined,
			minSongs: undefined
		});
	});

	it('falls back to defaults for a missing or broken file', () => {
		expect(parseServerConfig(null)).toEqual(DEFAULT_SERVER_CONFIG);
		expect(parseServerConfig({ genrePlaylists: 'nope' })).toEqual(DEFAULT_SERVER_CONFIG);
		expect(parseServerConfig({})).toEqual(DEFAULT_SERVER_CONFIG);
	});
});
