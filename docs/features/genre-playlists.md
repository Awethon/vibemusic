# Genre playlists

vibemusic makes a playlist for each of the main genres in your library: up to 100 of your best
tracks in that genre, a few from each artist, spaced out so one artist doesn't play twice in a row,
and reshuffled every week. The genres come from a cleaned-up genre tree, so messy tags such as
"rap", "Hip Hop" and "хип-хоп" all end up in one Hip-Hop playlist, and sub-genres like Trap or
Post-Punk get playlists of their own when you have enough of them. Each playlist gets a generated
cover: a tilted wall of its album covers under the genre name, in colours taken from the music.

[All features](README.md)

## Where you find them

Genre playlists appear on the **Playlists** page, in their own **Genre playlists** section, as
square tiles in alphabetical order. They also take turns with your other playlists on the home
page's playlists shelf.

Open one and it plays like any playlist. Under the title it says it's your top tracks in that
genre, a few from each artist, and that it updates automatically. A few things are different from
your own playlists:

- **They're built for you.** Everyone gets their own, made in their browser from their own
  library, plays and likes. Two people on the same server can see different tracks in the same
  genre.
- **You can't edit them.** They're rebuilt automatically, so there's nothing to rename, reorder
  or delete.
- **They live in vibemusic only.** They aren't saved to Navidrome, so other apps don't see them.
  Sharing one shares its list of tracks.
- **Disliked tracks are skipped.** A track you've disliked stays in the list but doesn't play.
- **Links keep working.** A genre playlist keeps its address across rebuilds, as long as the genre
  still has a playlist.

## Which genres get a playlist

A genre needs enough tracks, from enough different artists, to make a good playlist:

- **Top-level genres**, like Rock or Electronic, need at least 30 tracks by at least 2 artists.
- **Sub-genres**, like Shoegaze or Deep House, need at least 50 tracks by at least 3 artists.

A track in a sub-genre also counts towards every genre above it, so a Post-Punk track helps both
Punk and Rock reach their numbers, and appears in their playlists too.

Sub-genres only get a playlist when they would be noticeably different from what's already there.
If nearly all your Rock is Indie Rock, a separate Indie Rock playlist would just repeat the Rock
one, so it's left out. The same goes for two related genres that share most of their tracks: the
second one is skipped.

There are at most 24 genre playlists. Broad genres are chosen first and sub-genres after them, so
when the limit is reached, it's the narrowest genres that miss out.

The person running the server can change all of this; see [Settings](#settings).

## How tracks are picked

Each playlist holds up to 100 tracks. The picks lean on three things:

- **How popular a track is**, from Deezer and Apple, when the relay is running (see
  [The relay](../relay.md)).
- **How often you play it**, from Navidrome's play counts.
- **Whether you've liked it.** A liked track gets a small boost.

Every artist in the genre gets at least one track, as long as there's room. Bigger artists, and
artists you play a lot, get more, but no artist gets more than 15 tracks out of 100. That limit is
only relaxed when nobody else has tracks left to add.

Some tracks never make it in:

- **Other versions of a track you already have.** When a track exists several times (a remix, a
  live take, a remaster on a compilation), only one version is used: the original recording
  first, then the earliest release, then a plain title without extras.
- **Skits, intros and interludes**, and anything shorter than 75 seconds, unless the popularity
  data says that track is actually a hit.

## The order, and the weekly reshuffle

Tracks are laid out from the strongest down, with some deliberate randomness, so the playlist
doesn't start with the same few hits every time. Two tracks by the same artist are kept at least
three tracks apart, or less when the genre has only a few artists. Each artist's most popular track
plays before their others.

The randomness changes once a week. Within a week, the order stays the same however often the
playlist is rebuilt; in a new week, it's shuffled again. The tracks themselves don't change with
the week, only their order; they change when your library, plays, likes or the popularity data
change.

## Without the relay

Genre playlists work without the relay, with less to go on:

- **Genres** come only from your files' tags. Untagged music doesn't land in any genre playlist,
  and regional genres like Russian Rock are only found when the files say so.
- **Popularity** comes only from your own plays and likes. In a library you've barely played yet,
  the order is closer to random.

Turning off some of the relay's outside services has a partial effect: without MusicBrainz there
are no genre tags from it, without Deezer no fan counts or popularity and no extra genre vote, and
without Apple no top-tracks list. See [What it sends outside](../relay.md#what-it-sends-outside).

## Settings

The person running the server can adjust genre playlists for everyone:

| Variable | Default | What it does |
|---|---|---|
| `VIBEMUSIC_GENRE_HIDDEN` | none | Genres that never get a playlist |
| `VIBEMUSIC_GENRE_PINNED` | none | Genres that always get one, however small |
| `VIBEMUSIC_GENRE_MAX_PLAYLISTS` | `24` | Maximum number of genre playlists |
| `VIBEMUSIC_GENRE_SONG_CAP` | `100` | Maximum tracks per playlist |
| `VIBEMUSIC_GENRE_MIN_SONGS` | `30`, sub-genres `50` | Tracks a genre needs |
| `VIBEMUSIC_GENRE_MIN_ARTISTS` | `2`, sub-genres `3` | Artists a genre needs |

Genres are written as vibemusic shows them, comma-separated, for example
`VIBEMUSIC_GENRE_HIDDEN=Soundtrack,Chanson`. Hiding a genre hides only that playlist: its
sub-genres can still get their own, and its tracks still count towards the genres above it.

Pinned genres are placed first and are never dropped as near-duplicates, but they still count
towards the maximum, and a genre with no tracks at all still gets no playlist.

Setting a minimum number of tracks or artists replaces both defaults: top-level genres and
sub-genres then need the same amount.

Changes apply on each person's next visit, when their genre playlists are rebuilt. All settings
are listed in [Settings](../configuration.md).

## How it works

### The genre tree

vibemusic carries a fixed list of about 150 genres, arranged as a tree. Each genre can have one or
more parents: Post-Punk sits under both Punk and Alternative, Jazz Rap under both Hip-Hop and
Jazz, and Punk itself under Rock. The top-level genres are broad families such as Rock, Metal,
Electronic, Hip-Hop, Pop, R&B, Jazz, Classical, Folk, Soundtrack and Experimental.

Each genre also has a list of other names it goes by, including common abbreviations and Russian
and Japanese spellings: "prog rock" is Progressive Rock, "dnb" is Drum and Bass, "русский рок" is
Russian Rock.

### Turning tags into genres

Genre tags are messy, so each one is tidied up before it's looked up in the tree:

- **Spelling is ignored.** Case, spaces, hyphens and punctuation don't matter, and "&", "n" and
  "'n'" all read as "and", so "Drum & Bass", "drum n bass" and "Drum-and-Bass" are the same
  genre. The Russian letters ё and е count as the same letter.
- **Several genres in one tag are split.** A tag like "Rock/Pop; Indie" becomes three, split on
  slashes, semicolons, commas and vertical bars. A tag that is a known genre as a whole, like
  "singer/songwriter", is kept in one piece.
- **Unknown longer names fall back to a shorter one.** If a tag isn't in the tree, its leading
  words are dropped one at a time until something matches, so "Melodic Death Metal" becomes
  Death Metal. Only leading words are dropped, because the broad genre is usually named last.
- **Meaningless tags are ignored**, like "other", "unknown", "misc", "various", "favorites" or
  "seen live".
- **Your own unusual tags are kept.** A file tag that matches nothing in the tree still becomes a
  genre of its own, under the first spelling seen. It has no parents, so it's treated like a
  top-level genre and can get a playlist if it's big enough.

### Where a track's genres come from

Each track's genres are decided by a small vote, from up to four sources:

- **The track's own genre tags**, as Navidrome reads them from the file. If the track has none, the
  album's genre tags are used instead. These are trusted most: every genre in them gets a full
  vote.
- **The album's tags on MusicBrainz**, when the relay found the album there. People vote on these
  tags, so they're weighted by how many votes they got: the most-voted tag counts most, tags with
  fewer than 40% of its votes are dropped as noise, and when even the top tag has only one or two
  votes, all of them count for less. Only tags that are genres in the tree are used.
- **The album's genre on Deezer**, when the relay matched the album there by title. It's a single
  broad genre, like Rock or Electronic, and counts for half a vote.
- **The artist's tags on MusicBrainz**, weighted the same way as album tags. They're only used
  when the track has no usable genre tags and the album's MusicBrainz tags are thin, because an
  artist's tags describe their whole career rather than this album.

A genre needs a full vote to stick. A file tag gets there on its own, and so does an album's
clearly top MusicBrainz tag when it has at least three votes. Weaker hints only count when they
agree, for example a half-strength MusicBrainz tag and the same genre from Deezer. If nothing
reaches a full vote, the single strongest guess is kept, so a track with any hint at all gets a
genre.

### Parents and regional genres

Once a track has its genres, it also belongs to every genre above them in the tree. A Deathcore
track counts as Death Metal, Metalcore, Metal, Punk and Rock too. That's why a parent genre's
playlist can include tracks from all its sub-genres, and why filtering your albums by a parent
genre finds its sub-genres as well. An album's own list of genres only shows the ones that were
chosen directly, most common first.

Some genres are added from where the artist comes from rather than from tags. The relay looks up
the artist's country on MusicBrainz, and an artist from Russia whose tracks are Hip-Hop, Rock or
Pop (or one of their sub-genres) also gets Russian Hip-Hop, Russian Rock or Russian Pop.

### Matching your music to MusicBrainz and Deezer

The relay does the looking up; your browser only asks it for what it needs and receives the
answers. See [The relay](../relay.md) for what is sent and to whom.

- **Albums** are looked up on MusicBrainz when their files carry a MusicBrainz album id, which
  taggers usually write. The album's first credited artist is looked up too, for their tags and
  country.
- **Artists without any MusicBrainz ids** in their files are searched by name, and a hit is only
  accepted when it has an album with one of the same titles, since many artists share a name.
- **On Deezer**, the relay finds an artist by searching for a few of their tracks from your
  library, and only falls back to the name when that fails. It reads the artist's fan count, their
  top tracks with Deezer's popularity score, and their albums with each album's genre.
- **On Apple**, it reads the artist's top tracks list, confirmed against your album titles.

Answers are kept by the relay for two to four weeks before they're looked up again. Your browser
asks for new answers when it connects and every six hours after that, and folds them in as they
arrive.

### Choosing the playlists

Every genre that any track belongs to, directly or through a sub-genre, is a candidate. Hidden
genres are removed, and the rest must pass the size check: enough tracks and enough different
artists, with a higher bar for sub-genres than for top-level genres.

The candidates are then considered in order: pinned genres first, then top-level genres, then
sub-genres one level down, and so on, with bigger genres before smaller ones at the same level.
Each one is added unless it repeats a playlist already chosen:

- **A sub-genre is skipped** when it has at least 70% as many tracks as one of its parents that
  already has a playlist, since it would mostly be a copy of it.
- **Any other genre is skipped** when 80% or more of its tracks are already in a chosen playlist,
  or when half or more of the tracks it would actually play are already picked for one.

This stops once there are 24 playlists. Pinned genres skip the repeat check, but not the limit.

### Picking and ordering the tracks

For each chosen genre, the tracks are first narrowed down to one version each. Two tracks count as
versions of each other when they're by the same album artist and have the same title once
brackets, anything after " - " and featured artists are set aside. The version kept is, in order
of preference: not marked as a remix, live, acoustic, demo, cover, instrumental or similar; from
the earliest year; with a plain title; played more; liked; with known popularity. Skits, intros,
outros, interludes and tracks under 75 seconds are dropped here, unless Deezer or Apple has
popularity data for them.

Every remaining track gets a score:

- **With popularity data**, the score is the track's Deezer popularity, raised by your plays (each
  100 plays adds the track's popularity once more) and by a quarter if you've liked it. Tracks with
  no popularity of their own get half of their artist's least popular known track, so they aren't
  shut out entirely. The score is taken on a log scale, so a few huge hits don't swamp everything.
- **Without any popularity data in the genre**, the score comes from your plays and likes alone.

Next, the 100 places are shared out between artists. Each artist has a weight, from their Deezer
fan count (heavily flattened, so a superstar weighs only a few times more than a small band) and
how much you play them. Every artist gets one place first, heaviest first, until the places run out.
The rest are handed out one at a time, each to the artist with the best weight relative to the
places they already have, so big artists get more without crowding out the rest. Nobody gets more
than 15% of the playlist unless there's no one else with tracks left. Each artist's places are
filled with their best tracks: Apple's top-tracks order first, where it knows the track, then the
score.

Finally, the order. Each track's score gets a random nudge that depends on the track and the
current week, so the order is stable for a week and changes the next. Tracks are then placed from
the highest nudged score down, keeping at least three tracks between two by the same artist (fewer
when there are only a handful of artists). An artist with many tracks left is brought forward
before the spacing becomes impossible to keep near the end. This pass decides which artist
plays in each slot; each artist's slots are then filled with their tracks from most to least
popular, so their biggest track comes first.

### When playlists are rebuilt

Genre playlists are worked out in your browser, from the copy of your library that vibemusic
keeps there. They're recomputed:

- **When the library is first loaded**, and whenever albums are added, changed or removed.
- **When your plays or likes change**, since they affect the picks. Only the genre playlists are
  recomputed then, not the genres.
- **When new data arrives from the relay**, at most every 30 seconds while answers are streaming
  in.
- **When the rules changed** since your library was last saved, for example after the server's
  genre settings or vibemusic itself was updated. This happens when you next open vibemusic,
  without downloading your library again.

Only playlists whose tracks or details actually changed are rewritten, so a rebuild is quick. A
rebuild in a new week picks up the new weekly order.

## The generated cover

Genre playlists don't have a cover image; vibemusic draws one for each, live in the page, from
the playlist's own albums.

- **The wall.** The background is a grid of album covers, four to a row, taken from the first
  eight different albums in the playlist that have a cover, in playlist order. Each row starts one album later than
  the one above, so the same cover never lines up in a column, and with fewer albums the covers
  repeat. The whole wall is tilted about 14 degrees and runs off the edges.
- **The fade.** The wall fades into a dark background at the top, where the title sits, and at
  the bottom, leaving the covers clearest in the middle.
- **The colours.** They come from the cover of the first of those albums. Of its main
  colours, the most colourful one is chosen (strongly coloured, and neither too dark nor too
  light), and its hue is used twice: as a light accent colour and as a very dark background.
  Dull covers are given a little more colour and loud ones are toned down, so every cover looks
  intentional. Until the colours are known, it uses a soft violet on near-black.
- **The text.** A small "GENRE" label in capitals in the accent colour, the genre name in large
  bold type below it, the number of albums and tracks in the bottom-left corner, and a small "vm"
  mark in the bottom-right with the "m" in the accent colour. Long genre names are set smaller to
  fit, and cut off with an ellipsis if they still don't.

Small versions of the cover, like in lists, show just the wall, fading towards the bottom, with
no text.

Because the cover is drawn from the playlist's albums, it changes with the playlist: when the
weekly order brings a different album to the top, the colours and the wall change with it.
