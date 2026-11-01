# Timeline

The timeline lays out your albums along the years they came out. Each artist with a few albums
gets a lane of their own, running left to right from their first release to their last, and
everyone else shares one lane at the bottom. It's a way to see a whole library at once: who was
busy when, which years are crowded, and where the gaps are.

[All features](README.md)

## What you see

Across the top runs a row of years. Below it, one lane per artist: the artist's name and album
count sit on the left, and each album appears as a small cover in the column of the year it was
released. A thin line joins an artist's first and last album, so you can see how long they've
been around.

- **Years with albums** are labelled, with the number of albums from that year underneath.
- **Empty years** are kept, so the gaps are real, but they're squeezed narrow. Some of them still
  get a quieter label, every five years, when there's room for it.
- **Busy years** get wider. A year is as wide as its busiest lane needs: if one artist released
  three albums that year, the column fits three covers side by side, in alphabetical order.
- **The decade** you're looking at is shown as large faint text in the corner, and changes as you
  move.
- **A minimap** under the timeline shows the whole range in miniature, each album a short stripe
  in the main colour of its cover, with a frame around the part you're looking at.

Artists with fewer than three albums don't get their own lane. Their albums all go into a shared
lane called **Everyone else**, placed last. Its name is in italics and isn't a link, since it
isn't one artist.

Lanes are ordered by each artist's first album, oldest first. Artists who started in the same year
are ordered by how many albums they have, then by name.

As you move forward in time, lanes whose artist has no albums left in view fold away, so the
artists still releasing music move up. Move back and they unfold in their old place; the order
never changes.

## Moving around

The timeline scrolls in both directions: sideways through time and up and down through the
lanes. The artist names stay pinned to the left edge and the years stay pinned to the top.

- **Drag** with the mouse to pan in any direction. A short drag still counts as a click, so you
  don't need a steady hand to open an album.
- **Scroll sideways** with a trackpad or a sideways scroll wheel to move through time.
- **The mouse wheel** moves through time too, as long as all lanes fit on the screen. When there
  are more lanes than fit, it scrolls the lanes up and down as usual.
- **Touch screens** pan with a finger, like any scrolling page.
- **The minimap** jumps: click a spot to centre the timeline on it, or hold and drag along it to
  sweep through the years.

## Clicking and hovering

- **Click a cover** to open the album.
- **Right-click a cover** for the usual album menu: play, play next, add to queue, open the
  album, go to the artist, share, and add to a playlist.
- **Hover a cover** to see the album's title, artist and year, and to tint the background with
  the cover's colours, as elsewhere in the app. The cover grows slightly.
- **Hover an artist's name** to highlight their lane: the other lanes fade and the line joining
  their albums lights up. Click the name to open the artist.

The player bar at the bottom is hidden on this page, so the timeline and its minimap can use the
full height. Playback carries on.

## Phones and the menu

The timeline needs room, so it isn't offered on phone-sized screens. On a phone it's left out of
the menu, and opening its address directly shows a short note asking you to turn the phone
sideways. Once the screen is wide enough, the timeline appears.

On larger screens, you can hide or show Timeline in the menu from **Settings**. Whoever runs the
server can choose whether it's shown by default; see `VIBEMUSIC_DEFAULT_TIMELINE` in
[Settings](../configuration.md). Your own choice in Settings wins over that default.

## How it works

The timeline reads from the copy of your library that vibemusic keeps in the browser, so it opens
without waiting for the server and updates by itself after the library is refreshed.

**Forming lanes.** Albums are grouped by their album artist. Any artist with three or more albums
gets a lane; the albums of every other artist are collected into the shared Everyone else lane.
The album count next to a name includes every album by that artist, and the years shown next to
it are the first and last release years.

**Placing albums.** The timeline covers every year from the oldest album to the newest, plus one
spare year at each end. Each year becomes a column. For every year, vibemusic finds the lane with
the most albums that year and makes the column wide enough for that many covers; years with no
albums at all get a narrow fixed width. Within a lane, the albums of one year sit next to each
other in alphabetical order.

**Albums without a year.** An album with no release year in its tags has no place on the axis, so
it isn't drawn. It still counts towards its artist's album total, and so towards whether the
artist gets a lane.

**Folding lanes.** While you scroll, vibemusic checks which lanes end entirely to the left of the
visible years and folds those away. Their space is given to the lanes still in view.

**The minimap** is drawn once as a picture of the whole layout, using the main colour picked from
each cover (see [Album colours](album-colours.md)). It's redrawn when the library or the window
size changes, not while you scroll.

**Covers** are loaded at the smallest size the app uses, the same one as in track lists, so
they're often already in the browser's cache.
