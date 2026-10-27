export const SCHEMA_VERSION = 6;

export const SCHEMA = `
create table meta (key text primary key, value text not null) without rowid;
create table album (
	id text primary key,
	name text not null,
	name_order text not null,
	artist_id text not null,
	artist text not null,
	artist_order text not null,
	year integer not null,
	genres text not null,
	song_count integer not null,
	duration real not null,
	created text not null,
	updated text not null,
	play_count integer not null,
	play_date text not null,
	starred integer not null
);
create index album_artist on album (artist_id, year desc);
create table album_credit (artist_id text not null, album_id text not null, position integer not null, name text not null, name_order text not null, primary key (artist_id, album_id)) without rowid;
create index album_credit_album on album_credit (album_id);
create table album_genre (genre text not null, album_id text not null, primary key (genre, album_id)) without rowid;
create table artist (
	id text primary key,
	name text not null,
	name_order text not null,
	album_count integer not null,
	track_count integer not null,
	first_year integer not null,
	newest_album_id text not null
);
create table track (
	id text primary key,
	album_id text not null,
	title text not null,
	artist text not null,
	artist_id text not null,
	track_no integer not null,
	disc_no integer not null,
	duration real not null,
	suffix text not null,
	bit_rate integer not null,
	play_count integer not null,
	play_date text not null,
	starred integer not null
);
create index track_album on track (album_id, disc_no, track_no);
create table track_genre (genre text not null, track_id text not null, direct integer not null, primary key (genre, track_id)) without rowid;
create index track_genre_track on track_genre (track_id);
create table playlist (
	id text primary key,
	name text not null,
	kind text not null,
	owner_id text not null,
	genre text not null,
	album_count integer not null,
	song_count integer not null,
	duration real not null,
	updated text not null,
	image text not null,
	readonly integer not null,
	artist_id text not null
);
create index playlist_artist on playlist (artist_id);
create table playlist_track (playlist_id text not null, position integer not null, track_id text not null, primary key (playlist_id, position)) without rowid;
create table palette (album_id text primary key, colors text not null) without rowid;
create table search_key (kind text not null, text text not null, ref text not null);
create virtual table search using fts5 (kind unindexed, ref unindexed, text, tokenize = 'trigram remove_diacritics 1');
create index search_key_prefix on search_key (kind, text);
`;

export const normalizeForSearch = (text: string) => text.toLowerCase().replaceAll('ё', 'е').normalize('NFKC');
