# Album colours

vibemusic picks a small palette of colours from every album cover and uses it across the app: the
background drifts in the playing album's colours, buttons and highlights take an accent colour from
it, hovering an album gives a quick preview of its colours, and the tab icon changes with it. Each
cover is analysed once, in your browser, and the result is kept in your library.

[All features](README.md)

## What you see

- **The background.** The moving background is painted with the playing album's colours. When the
  next track is from another album, the colours slowly blend over instead of switching.
- **The accent colour.** Switched-on buttons, liked tracks, the current item in a list and focus
  outlines take a light, readable colour from the playing album. Before anything plays it's a soft
  lavender.
- **The tab icon.** The "m" in the browser tab icon takes a vivid version of the album's colour.
  Grey and black-and-white covers leave it at its usual colour.
- **Hover preview.** Point at an album, artist or playlist while browsing and the background
  tints toward that album, then drifts back to the playing one when you move away.
- **Elsewhere.** Generated genre playlist covers are coloured from one of their albums, the
  timeline's minimap shows each album as a short stripe in its main colour, and shared links take
  their accent and tab icon from the shared music's cover.

## A palette, not an average

The simple way to take colours from a picture is by area: split it into the biggest patches of
similar colour and take the middle of each. That works for a sunset, but album covers are often a
big plain field with one small thing that matters, like a black cover with a small red logo. By
area, the red is a few dozen pixels and gets averaged into the black around it, and the palette
fills up with four slightly different blacks.

So vibemusic aims for spread rather than area. The palette starts with the cover's main colour and
then adds colours that are clearly different from what it already has: the lightest and darkest
parts, a vivid detail if there is one, then whatever adds the most variety. A small logo, a white
title or a thin coloured stripe can make it in; a fifth shade of grey can't.

## How many colours

Up to five. Covers with less going on get fewer:

- A flat, single-colour cover gives one colour.
- A black-and-white cover, or any two-tone cover, gives two. The greys in between (soft edges,
  smoke, shading) are recognised as blends of the two and left out, because they'd only make the
  background muddy.
- A busy, colourful cover gives the full five.

The first colour is always the one covering most of the cover. The background fills any missing
colours by repeating the ones it has.

## The accent colour

The accent follows the playing album only; hover previews don't change it.

It starts from the most colourful colour in the palette, the one with the strongest colour that
isn't nearly black or nearly white. That colour is brightened to a fixed level and then mixed a
good way toward white. So even a very dark album gives an accent that's easy to read on the dark
interface, and the hue stays recognisably the album's. A grey cover gives a light grey accent.

When the album changes, the accent blends to the new colour at the same pace as the background.

The tab icon uses the same starting colour but keeps it vivid: same hue, at a fixed strength and
brightness. If the album has almost no colour at all, the icon keeps its usual colour instead of
turning grey.

## The background

Album colours on their own can be bright: a white cover or a yellow one would make text on top hard
to read. So before they reach the background, colours are made a little richer, but their
brightness is held inside a dark band. The background always looks like the album, just at night.

The **Caustics** background (light through water, from Settings) uses the five colours in roles:
the two most colourful become the light highlights, the darkest becomes the ground, and the rest
fill the body in between. Each role has its own brightness range, so the picture stays dark enough
whatever the cover, while keeping each colour's hue.

### Moving between albums

The background never switches in one frame. It eases toward the new colours: quickly at first,
then more and more gently, until it arrives. How fast depends on why the colours change:

- **A new album starts playing:** the slowest, settling over a few seconds.
- **Returning to the playing album** after a hover preview: a bit quicker.
- **Hover preview:** the quickest, so the preview feels responsive.

The very first track after opening vibemusic sets its colours at once, with no blend from nothing.
If the tab was in the background or the browser stalled, the blend picks up where it was rather
than jumping.

If you hover several albums quickly, only the last one counts: a slow cover that finishes loading
late can't overwrite a newer one.

## Hover preview

While browsing, pointing at something with a cover tints the background toward that album:

- album tiles and covers on the timeline use that album;
- playlist and genre playlist tiles use the album of their first cover;
- artists use their newest album.

When the pointer leaves, the background waits a moment before drifting back, so moving across the
gaps between tiles doesn't make it flicker between the preview and the playing album.

A few rules keep it from getting in the way:

- **On an album page,** hovering does nothing; the page's own album is what you're looking at.
- **Clicking through** to the album you were previewing keeps its colours while you're on its page,
  instead of jumping back to the playing album and then forward again. Leaving the page brings the
  playing album's colours back.
- **Full screen** and **going idle** always show the playing album's colours.

## Saved with your library

Picking a palette takes a moment, so each cover is analysed only once. The first time an album's
colours are needed (it starts playing, you hover it, or a genre cover uses it), vibemusic fetches a
small version of the cover, works out the palette in your browser, and saves it in the library
stored on your device. After that the colours come straight from the library.

The saved palettes are shared with your other open vibemusic tabs and are kept when the library is
rebuilt from Navidrome. When the way palettes are picked changes in a new version of vibemusic, the
old palettes are set aside and each album is analysed again the next time its colours are needed.

Shared links are opened by people without your library, so the shared page works out the colours
from the cover on the spot each time.

## How it works

The steps below run once per cover.

1. **Shrink the cover.** The cover is fetched at its smallest size and shrunk to 96 by 96 pixels.
   A few thousand pixels are plenty to find a cover's colours, and it keeps the work quick.

2. **Measure colours the way eyes do.** Every pixel is converted into a perceptual colour space,
   one where the distance between two colours matches how different they look. Averaging and
   comparing colours there behaves as you'd expect, which ordinary screen colours don't.

3. **Plant starting points far apart.** The first starting point is the pixel closest to the
   cover's overall average. Each next one is the pixel that is furthest from every starting point
   so far, up to twelve. This is what gives a small, unusual colour (the red logo) a starting point
   of its own instead of leaving it to be absorbed by its surroundings. If every pixel is already
   very close to some starting point, it stops early.

4. **Group the pixels.** Every pixel joins its nearest starting point, each group's centre moves to
   the average of its pixels, and this repeats a dozen times until the groups settle.

5. **Merge near twins.** Spreading starting points far apart can still put two of them on what is
   really one colour. Groups that end up almost the same are merged, weighted by size.

6. **Drop specks.** Groups covering only a tiny sliver of the cover are ignored. They're usually
   noise or the fringes that image compression leaves around edges.

7. **Pick the palette, in order:**
   - **The largest colour**, the one covering most of the cover.
   - **The lightest and the darkest**, taken only from colours that cover a real part of the cover,
     so a few bright pixels can't count as "the light end". These come before the vivid colour, so
     a bright yellow can't stand in for a white page of the same lightness.
   - **A vivid accent**, if nothing picked so far is properly colourful and the cover has a
     colourful detail. Strength of colour matters most here, size only a little. On a mostly grey
     cover, this is where the red logo gets in.
   - **Then the most variety:** until there are five, add the colour that is most different from
     everything already picked, with a bonus for being colourful and a smaller one for being
     large.

   Every new colour must be clearly different from all the colours already picked, or it's
   skipped. Differences in lightness count extra when comparing, so a white title or black text
   wins over yet another mid-tone. Close to black, lightness counts less: a pure black and a black
   with a faint tint look the same, even though they're measurably different.

8. **Skip greyish blends.** In the variety step, a greyish colour that lies on the straight path
   between two colours already picked is a blend of them, like the grey edge where black fades
   into white. Those are skipped. This is why black-and-white and two-tone covers end with fewer
   than five colours.

9. **Lift muddy browns.** Some colours sit in an unflattering band: medium brightness, a little
   colour, a yellow-brown hue, the khaki and olive-brown tones that look dull as a background. A
   colour in that band is gently moved toward whichever end it's closer to, darker toward
   espresso or lighter toward cream, and turned slightly toward red, so khaki leans toward
   mahogany. The effect fades out toward the edges of the band, so vivid, very dark, very light
   and grey colours are left alone.

The result is up to five colours, the largest first, saved with the album in your library.
