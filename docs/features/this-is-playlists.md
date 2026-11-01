# "This is" playlists

The relay can keep one playlist per artist, called "This is" and the artist's name, with that
artist's best-known tracks that are in your library. Tracks are ordered by how popular they are
on Apple and Deezer. Each playlist gets a cover drawn in the colours of
the artist's newest album, and everything is refreshed once a week.

[All features](README.md)

## Turning them on

"This is" playlists need the [relay](../relay.md) and a separate Navidrome account for it. The
account owns the playlists; it doesn't need to be an admin. `./setup.sh` can create it for you
(see [New setup](../install-new.md) or [Next to your Navidrome](../install-existing-navidrome.md)),
or you can make one by hand and set:

```bash
VIBEMUSIC_RELAY_NAVIDROME_USER=vibemusic-relay
VIBEMUSIC_RELAY_NAVIDROME_PASSWORD=a-long-random-password
```

Without both, the feature is off. A regular account is enough as long as it can see all your
libraries and Navidrome allows uploading playlist images (it does by default). The first refresh
starts when the relay starts. Playlists appear once it has looked at every artist, which on a big
library can take a while, mostly because Apple has to be asked slowly.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `THIS_IS_MIN_TRACKS` | `13` | Tracks an artist needs in your library to get a playlist |
| `THIS_IS_MAX_TRACKS` | `50` | Most tracks in one playlist |
| `THIS_IS_EVERY_HOURS` | `168` | Hours between refreshes (168 is a week) |
| `THIS_IS_SKIP` | none | Artists that never get one, comma-separated, any capitalisation |
| `ENRICHMENT_SOURCES` | `musicbrainz,deezer,apple` | Which outside services may be asked |
| `APPLE_STOREFRONTS` | `us` | Apple country catalogs to search, in order |

`ENRICHMENT_SOURCES` decides where popularity comes from. Leave out `apple` and Apple isn't
asked; leave out `deezer` and no new Deezer lookups are made. Answers the relay already has
are still used. With neither, tracks are ordered by release year. See
[The relay](../relay.md#what-it-sends-outside) for what these services are sent.

If an artist is missing from Apple's US catalog, or ranked oddly there, add the countries where
they're better known, for example `APPLE_STOREFRONTS=us,de`.

## Which artists get one

Every album artist with at least `THIS_IS_MIN_TRACKS` tracks in your library, except "Various
Artists" and anyone in `THIS_IS_SKIP`. Only album artists count: a guest appearance on someone
else's album doesn't. When an album credits several album artists, its tracks count for each of
them, so a joint album by Mira Vale and The Cold Lanterns helps both reach the minimum.

Tracks whose files have gone missing from your library don't count.

## Which tracks, in which order

Each playlist holds up to `THIS_IS_MAX_TRACKS` tracks, best known first:

1. Tracks on Apple's list of the artist's top tracks, in Apple's order.
2. Then tracks on Deezer's top list, by Deezer's popularity score.
3. Then the rest, by the relay account's play count, then newest release first, then in album
   order. Navidrome counts plays per account and the relay's account doesn't listen, so in
   practice this is newest release first.

A track only needs to be on one of the lists to rank: a track Apple doesn't know can still come
early if Deezer rates it highly.

**Matching titles.** Your files and the services rarely spell a title the same way. Capitals and
punctuation are ignored, and so are bracketed extras, a " - " suffix such as "2011 Remaster" and
featured-artist credits. So "Night Ferry (feat. Ada Lune) - Remastered" in your library matches
"Night Ferry" on Apple. A remix, live take, acoustic or instrumental version, demo or cover is
never matched to the original, so it doesn't borrow the original's popularity.

**Editions and duplicates.** A track that's on the album, a deluxe edition and a best-of appears
only once. The copy kept is the original recording rather than a remix or live take, then one
with a known year, then the earliest release, then the most played.

**Skits and filler.** Tracks with "skit", "intro", "outro", "interlude" or "prelude" in the title
(also in Russian), and anything shorter than 75 seconds, go to the end of the list, unless Apple
or Deezer ranks them, in which case they keep their place.

Tracks you've disliked are still in the playlist, but vibemusic skips them when it plays it.

## How often they refresh

The relay checks every hour whether a refresh is due, and refreshes when `THIS_IS_EVERY_HOURS`
have passed since the last successful one. A refresh rebuilds every playlist from scratch, so new
albums, new plays and changes in popularity show up then. If a refresh fails, for example because
Navidrome is down, the relay tries again an hour later.

When an artist no longer qualifies (you removed albums, raised the minimum, or added them to
`THIS_IS_SKIP`), their playlist is deleted at the next refresh. If an artist is renamed, the old
playlist is deleted and one with the new name is created.

## Where you see them

In vibemusic, an artist's "This is" playlist is shown on their page: the **Popular** section lists
its first five tracks, and next to it a card with the cover opens the whole playlist. The playlist
page is labelled "Artist playlist" and links back to the artist. These playlists don't appear in
your own list of playlists, so a large library doesn't bury the ones you made.

They're ordinary Navidrome playlists, public and owned by the relay's account. Every user of your
Navidrome can see and play them, in vibemusic and in any other app that talks to Navidrome. Nobody
but the relay's account can edit them, and any changes made there by hand are replaced at the next
refresh.

## The cover

Each playlist gets its own cover, a 1200 × 1200 pixel image:

- **Background.** A dark diagonal gradient with a soft glow of colour towards the bottom right.
- **Album covers.** Up to five of the artist's newest albums, fanned out below the name with the
  newest in front. Each has rounded corners and a soft shadow, and each one further back is tilted
  a little more. With only one or two albums, they're drawn larger.
- **Text.** "THIS IS" in small, widely spaced capitals at the top left, in the theme colour, and
  the artist's name below it in large, bold, near-white letters. Long names are set smaller to
  fit the width; a very long name may still run past the edge.
- **Mark.** A small "vm" in the bottom left corner, the "m" in the theme colour.

**Colours.** They come from the cover of the artist's newest album. The relay finds its main
colours, picks the most colourful one (not too dark or too pale), and keeps only its hue. From
that hue it makes a fixed set of shades: a light one for "THIS IS" and the mark, a medium one for
the glow, and two very dark ones for the gradient. Because the shades are fixed, white text is
always readable, whether the album cover is bright, dark or muted.

**Fonts.** The artist's name and the mark are set in Unbounded, "THIS IS" in Onest. Both come with
the relay under the SIL Open Font License, so the cover looks the same on every install.

**When it's redrawn.** Only when something on it would change: the artist's name, which albums are
the five newest, or one of those albums being updated in Navidrome (a new cover image, for
example). A cover is also drawn when the playlist has none, for instance after someone removed it.
Otherwise the existing cover is kept, so a weekly refresh usually redraws few or none.

## How it works

**Signing in.** At each refresh the relay signs in to Navidrome with its own account and reads
the whole library: every track and album, with album artists, years, play counts and lengths.
The play counts are that account's own, which are usually zero.

**Grouping.** Tracks are grouped by album artist. Artists below the minimum, "Various Artists" and
skipped names are dropped. For the rest, the artist's albums are sorted newest first, by release
year and then by when they were added, which sets the cover's colours and the order of the fan.

**Popularity from Apple.** The relay searches Apple's catalog for the artist's name in each
storefront from `APPLE_STOREFRONTS`, in order. Several artists can share a name, so a search hit
is only trusted if its discography on Apple includes at least one album title from your library;
up to three hits are checked. The first storefront where the artist is confirmed gives up to 50
top tracks, in Apple's popularity order. Apple allows only about 20 requests a minute, so the
relay pauses between them (`APPLE_PAUSE_MS`) and backs off when Apple asks it to.

**Popularity from Deezer.** The relay finds the artist on Deezer by searching for a few of your
tracks together with the artist's name, which tells namesakes apart better than the name alone.
It keeps up to 100 of the artist's top tracks, each with Deezer's popularity score.

**Shared answers.** These lookups are the same ones vibemusic uses for genres and popularity
elsewhere, and they're cached on disk by the relay. A found answer is used for two weeks, a
"not found" for one week, before the artist is looked up again. If the cache has no recent Apple
answer for an artist, the playlist refresh asks Apple itself. Deezer answers come only from the
cache, which fills while vibemusic is open and connected to the relay, so until the relay has
looked an artist up on Deezer, only Apple ranks their tracks.

**Choosing.** Within each artist, duplicates are folded to one copy, each track is matched against
the Apple and Deezer lists, and the tracks are sorted as described above. The top
`THIS_IS_MAX_TRACKS` make the playlist. Titles are first compared exactly (only letters and digits,
ignoring case), then loosely without extras and credits, skipping remixes and other versions.

**Saving.** For each artist the relay looks for a playlist of its own named "This is" and the
artist's name. If there is one, its tracks are replaced; otherwise a new one is created. The
playlist is then made public and given a description such as "27 Mira Vale tracks you own, most
popular first · updated weekly · made by vibemusic".

**Cleaning up.** After that, any other playlist owned by the relay's account whose name starts with
"This is " is deleted, since its artist no longer qualifies. Don't keep your own playlists with
that name in the relay's account. Playlists Navidrome imports from playlist files are left alone,
with one exception: "This is" playlists imported from a folder named `_playlists` are removed too.

**Drawing.** The relay fetches the newest album's cover at a small size for the colours, and up to
five album covers at a larger size for the fan. It draws the image as described above, saves it as
a JPEG and uploads it as the playlist's image. If an album cover can't be fetched, that playlist
keeps its old cover and the refresh carries on.

**Remembering.** The time of the last successful refresh, and what each cover was drawn from, are
kept in a small file in the relay's data folder (`THIS_IS_STATE`, by default
`/data/this-is.json`). That's how a restart doesn't trigger an early refresh, and how unchanged
covers are left alone. If the file is lost, the next check refreshes straight away and draws every
cover again.

**How vibemusic recognises them.** A playlist counts as a "This is" playlist when you don't own it,
its name starts with "This is ", and the rest of the name matches one of your artists, ignoring
capitals. That's how it knows to show it on the artist page instead of in your playlists.
