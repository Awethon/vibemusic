# Your library in the browser

vibemusic keeps a copy of your whole library in the browser: every album, artist, track and
playlist, with your plays, likes and ratings. Search, filters, sorting and browsing all read from
that copy instead of asking Navidrome, which is why they answer as you type. The first visit
downloads everything once; after that, vibemusic opens the saved copy straight away and only
fetches what changed.

[All features](README.md)

## What's copied, and what isn't

The copy holds the information about your music, not the music itself:

- **Albums**, with title, album artist, year, genres, track count, length, when they were added,
  and how often and when you last played them, and whether you liked them.
- **Tracks**, with title, artist, track and disc number, length, format and bit rate, plays,
  likes and dislikes.
- **Artists.** Only album artists get a page, so the artist list is worked out from the albums
  rather than downloaded separately.
- **Playlists**, with their tracks in order: your own playlists, smart playlists, and the "This is"
  playlists the [relay](../relay.md) makes.
- **Internet radio stations** set up in Navidrome.
- **Genre and popularity data** from the relay, if you run one (see below).
- **Album colours** picked from covers (see [Album colours](album-colours.md)).

What stays on the server:

- **The music files.** Tracks are streamed from Navidrome when you play them.
- **Cover images.** The copy only keeps a few small details per cover: a fingerprint that changes
  when the cover is replaced, a main colour, and a tiny blurred preview. Covers show that colour
  and preview while the real image loads. Because the fingerprint is part of each cover's
  address, the browser can keep covers in its cache for good and still never show an old one.

Tracks whose files have gone missing from Navidrome's music folder are left out.

## The first visit

The first time you sign in on a browser, there's nothing saved yet, so vibemusic shows a
**Getting your library** screen. It counts up the tracks, albums and playlists as they arrive from
Navidrome, with a progress bar, and then shows **Putting it together…** while it builds the local
copy and saves it.

How long this takes depends mostly on how many tracks you have, since the track list is by far the
biggest part. A small library is done almost at once; one with tens of thousands of tracks takes
noticeably longer. Either way it happens once per browser.

If Navidrome can't be reached or the download fails, the screen is replaced by a short message
and a **Retry** button. If Navidrome has no music yet, vibemusic says the library is empty and
picks up new albums once Navidrome has scanned them.

## Later visits

When you come back, vibemusic opens the copy saved in the browser and shows your library right
away, without waiting for Navidrome. Then, in the background, it asks Navidrome what changed
since last time and applies just that. Usually that's a handful of plays and likes, and you won't
notice it happening.

If Navidrome is down, you still get your saved library, with a small note saying Navidrome isn't
reachable and a **Retry** button. Browsing and search keep working; playing needs the server.

## Staying up to date

While vibemusic is open, it keeps the copy current in several ways.

- **Navidrome's live updates.** Navidrome tells connected apps when something changes: a scan
  finds new albums, a cover is replaced, the server restarts. vibemusic listens to this and
  checks for changes a moment later. Updates often come in bursts, so it waits for a burst to
  settle and then checks once.
- **Regular checks.** As a safety net it also checks every five minutes while live updates are
  working, and every minute while they aren't (for example behind a proxy that cuts them off).
  It checks again as soon as Navidrome is reachable after an outage.
- **Your own actions.** Liking or disliking a track and a counted play update the copy at once,
  so the change shows immediately, and Navidrome is told separately. Adding tracks to a playlist,
  removing them, or adding, editing and removing radio stations triggers a check right after
  Navidrome accepts the change.
- **A full refresh every day.** At least once a day, vibemusic downloads the whole library again
  instead of only the changes, in case something slipped through.
- **Resync now.** In **Settings**, under Library, you can see when the library was last synced
  and start a full refresh yourself.

New albums show up within about a minute even without live updates. Changes made in other apps
(a play on your phone, a playlist edited elsewhere) arrive with the next check.

## Where it's stored

The copy is a small database inside the browser, kept in the browser's own storage for this
website. Nothing is installed on your computer.

It's saved in pieces of about a megabyte each. When something changes, only the pieces that are
actually different are written again, so liking a track rewrites a piece or two, not the whole
library. A save either completes fully or not at all, so a closed tab or a crash can't leave a
half-written copy behind. If a saved copy is ever incomplete, vibemusic ignores it and downloads
the library again.

Small edits such as likes, plays and new album colours are collected and saved together a couple
of seconds later.

### Per user and per version

Each Navidrome user gets their own copy. Signing in as someone else on the same browser builds a
separate one, and neither sees the other's plays or likes.

Each copy is also tied to the layout of the database used by your version of vibemusic. When an
update changes that layout, the new version doesn't try to read the old file. Instead it:

1. downloads the library from Navidrome again, showing the first-visit screen;
2. carries over the parts that are slow to get again: genre and popularity data from the relay,
   and album colours;
3. deletes the old copy once the new one is saved.

So after such an update you see one fresh download, but genre playlists, popular tracks and album
colours are there straight away instead of trickling back in.

Tabs still running the older version keep working with their own copy until they're reloaded;
old and new tabs don't share anything.

### Size

The copy grows with your library, mostly with the number of tracks. It holds text and numbers
only, so it's small next to the music itself, but a very large library still makes for a
noticeable amount of browser storage.

vibemusic asks the browser to keep this storage even when the disk is getting full, so the
browser doesn't throw the copy away to make room. Whether it agrees is up to the browser.

If the copy is cleared anyway, for example by clearing the website's data, vibemusic simply
downloads the library again on the next visit, as on the first one. Album colours are then
worked out again as they're needed, and genre data comes back from the relay over time.

vibemusic needs browser storage to keep its copy. If the browser refuses to save it at all, the
first download can't finish and you see the error screen with a **Retry** button.

## Several tabs

You can have vibemusic open in several tabs or windows at once. They all show the same library,
but only one of them, the **leader**, talks to Navidrome about library changes and saves the
copy. The others follow:

- When the leader saves a newer copy, the other tabs reload it.
- Likes, dislikes, plays and album colours from any tab are passed straight to the other tabs,
  so they update immediately instead of waiting for the next save.
- **Resync now** in a tab that isn't the leader asks the leader to do it.
- A newly opened tab with nothing saved yet asks the leader to save what it has.
- When the leader tab closes, one of the others takes over.

This keeps several open tabs from each downloading the library and writing over each other.

Picking the leader relies on a browser feature that is only available on secure (https) pages
and on your own computer. When vibemusic is opened over plain http on another address, that
feature is missing, so the tabs agree on a leader through a note in the browser's storage
instead: the leader renews it every 20 seconds, and if it isn't renewed for a minute and a half,
another tab takes over. A leader that closes normally removes the note so another tab can take
over right away.

## Worked out in your browser

Some parts of the library aren't downloaded at all but worked out locally from the rest:

- **The artist list**, with album and track counts, first year and newest album.
- **Genres.** Each track's genres are chosen from its file tags and, with the relay, from
  MusicBrainz and the music stores, then placed in a tidy genre tree, so filtering by a genre
  also finds its sub-genres. Albums take their genres from their tracks.
- **[Genre playlists](genre-playlists.md)**, picked from your tracks in each genre, using plays,
  likes and popularity.
- **The search index** (see below).
- **Album colours**, picked from a cover the first time they're needed and saved with the
  library.

These are rebuilt when they could have changed:

- after a full download, and after new or changed albums arrive;
- when new genre and popularity data comes in from the relay;
- when plays or likes change, genre playlists are picked again (only the ones whose tracks
  actually change are rewritten);
- when the genre playlist settings or the way genres are chosen change in a new vibemusic
  version, the next time the library is opened. This doesn't need a new download.

### Genre and popularity data

If you run the [relay](../relay.md), the leader tab asks it for genres and popularity of your
artists and albums: when it starts, after the library changes, and otherwise every few hours. The
relay sends answers in pieces as it finds them. vibemusic collects the pieces and applies them at
most every half minute, since each round rebuilds the genres, genre playlists and search index.
Without the relay, genres come from your file tags only.

## Instant, in practice

Every tab runs the library in a background worker, separate from the page itself. Searching,
filtering albums by genre and decade, sorting by most played or newest, opening an
artist or a playlist: all of it runs there, against the copy held in memory. The page never waits
on the network for these, and a heavy query never freezes scrolling or the player.

Downloads and rebuilds run in that worker too. A refresh is built into a fresh copy and swapped
in when it's ready, so the library stays usable while it's being rebuilt.

### Search

Search looks through artists, albums (by title and album artist), playlists, including genre
playlists, and tracks (by title and artist), all at once. It ignores upper and lower case, and
treats ё as е.

Results that start with what you typed come first, then results that contain it anywhere, so
typing a few letters from the middle of a title works too. An index of three-letter fragments
makes those in-the-middle matches fast even across a large library. One- and two-letter searches
are too short for that index and fall back to a plain scan.

## Signing out

Signing out forgets your sign-in and reloads the page, which stops everything tied to your
account. The saved copy of the library stays in the browser, so signing back in later opens it
straight away. To remove it, clear this website's data in your browser.

## How it works

**Opening.** When vibemusic starts, it starts a background worker that holds the library. The
worker looks for a saved copy for your user and your app version, loads it into memory, and the
page shows it. If the genre rules changed since it was saved, the derived parts are rebuilt
first. If there's no copy for this version but there is one from an older version, the old one
is kept aside in memory for the rebuild to take data from.

**Choosing the leader.** Each tab then asks the browser for a lock named after your user and app
version. The first tab to get it becomes the leader and keeps it until it closes; the others wait
in line. Without browser locks, the shared note described above does the same job.

**Full download.** The leader asks Navidrome for all playlists and radio stations, then for all
albums, tracks and album artists at the same time, in large pages, and finally for the tracks of
each playlist. It builds a fresh database from all of it, works out the derived parts, saves it,
and tells the other tabs to reload.

**Catching up.** For later checks, the leader remembers the newest moment it has seen for five
kinds of change: albums added or changed, albums played, albums liked, tracks played and tracks
liked. It asks Navidrome for each list sorted newest first and stops reading as soon as it
reaches something it has already seen. It starts with a tiny page and makes each next page four
times bigger, so a quiet check costs a few small requests. It also fetches the current playlists
and radio stations and the list of rated tracks, since a removed rating only shows up as a track
missing from that list. Only playlists whose content may have changed are fetched again; smart
playlists are refetched when new albums arrive, or when plays and likes change and their rules
depend on them.

**When catching up isn't enough.** The leader does a full download instead when:

- it has never done one, or the last one was more than a day ago;
- more albums changed than about a third of the library (and at least 50);
- after applying new albums, the number of albums or tracks doesn't match what Navidrome reports,
  which means something was missed.

**Applying changes.** Changed albums are replaced together with their tracks; albums that went
missing on the server are removed with theirs. Play counts, likes and ratings are updated in
place. Only when the music itself changed are the artists, genres, genre playlists and search
index rebuilt; a check with only plays and likes in it touches as little as possible, so the next
save writes few pieces. If nothing changed at all, nothing is saved and other tabs aren't asked
to reload.

**Live updates.** The leader keeps a connection open to Navidrome's live updates. Navidrome sends
a sign of life about every 15 seconds; if it goes silent for 45 seconds, vibemusic treats the
connection as dead and reconnects, waiting a little longer after each failure, up to a minute.
When an update names specific albums or artists, those are refreshed on the next check, for
example to pick up a replaced cover.

**Saving.** To save, the worker takes the database as one block of bytes, cuts it into
one-megabyte pieces and computes a fingerprint for each. Pieces whose fingerprint matches the
last save are skipped; the rest, plus a short list of all fingerprints, are written in a single
step. Saves run one after another, never at the same time.

**Between tabs.** Tabs of the same user and app version talk over a browser channel. The leader
announces each new save, and followers load it. Small edits are sent as the change itself, which
each tab applies to its own copy in memory; only the leader saves them.
