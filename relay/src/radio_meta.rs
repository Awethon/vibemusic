//! Now-playing metadata from radio streams: ICY (Shoutcast/Icecast) blocks interleaved with the
//! audio, and Vorbis comments in Ogg streams. Both parsers take the stream in arbitrary chunks.

use std::collections::HashMap;

// Comment packets can embed cover art; bytes beyond this cap are not collected.
const MAX_PACKET_BYTES: usize = 4 * 1024 * 1024;
const MAX_PENDING_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
}

/// Reads `StreamTitle='...';` from an ICY metadata block. By convention the title is
/// "Artist - Title"; without the separator it is all title.
pub fn from_icy(meta: &str) -> Option<NowPlaying> {
    let start = meta.find("StreamTitle='")? + "StreamTitle='".len();
    let rest = &meta[start..];
    let text = rest
        .find("';")
        .map_or(rest.trim_end_matches(['\0', '\'']), |end| &rest[..end])
        .trim();
    if text.is_empty() {
        return None;
    }
    Some(match text.split_once(" - ") {
        Some((artist, title)) => NowPlaying {
            title: title.trim().to_owned(),
            artist: artist.trim().to_owned(),
        },
        None => NowPlaying {
            title: text.to_owned(),
            artist: String::new(),
        },
    })
}

/// Splits an ICY stream into audio and metadata. After every `every` audio bytes comes one length
/// byte (block size / 16) and then that many 16-byte units of NUL-padded text; a zero length means
/// "no change".
pub struct IcyStripper {
    every: usize,
    audio_left: usize,
    meta_left: Option<usize>,
    meta: Vec<u8>,
}

impl IcyStripper {
    pub fn new(every: usize) -> Self {
        Self {
            every,
            audio_left: every,
            meta_left: None,
            meta: Vec::new(),
        }
    }

    /// Returns the audio bytes of the chunk and the last song announced in it, if any.
    pub fn feed(&mut self, mut chunk: &[u8]) -> (Vec<u8>, Option<NowPlaying>) {
        let mut audio = Vec::with_capacity(chunk.len());
        let mut found = None;
        while !chunk.is_empty() {
            match self.meta_left {
                None if self.audio_left > 0 => {
                    let take = self.audio_left.min(chunk.len());
                    audio.extend_from_slice(&chunk[..take]);
                    self.audio_left -= take;
                    chunk = &chunk[take..];
                }
                None => {
                    self.meta_left = Some(chunk[0] as usize * 16);
                    self.meta.clear();
                    chunk = &chunk[1..];
                }
                Some(left) => {
                    let take = left.min(chunk.len());
                    self.meta.extend_from_slice(&chunk[..take]);
                    chunk = &chunk[take..];
                    if left == take {
                        if !self.meta.is_empty() {
                            found = from_icy(&String::from_utf8_lossy(&self.meta)).or(found);
                        }
                        self.meta_left = None;
                        self.audio_left = self.every;
                    } else {
                        self.meta_left = Some(left - take);
                    }
                }
            }
        }
        (audio, found)
    }
}

/// Finds Opus and Vorbis comment packets in an Ogg stream. Stations usually start a new logical
/// stream, with fresh comment headers, when the song changes. Audio passes through untouched.
#[derive(Default)]
pub struct OggTags {
    pending: Vec<u8>,
    packets: HashMap<u32, Vec<u8>>,
}

impl OggTags {
    /// Returns the last song announced in the bytes seen so far, if any.
    pub fn feed(&mut self, chunk: &[u8]) -> Option<NowPlaying> {
        self.pending.extend_from_slice(chunk);
        let mut found = None;
        loop {
            // An Ogg page: "OggS", version, header flags (byte 5), granule, serial number
            // (bytes 14..18), sequence, checksum, segment count (byte 26), then one lacing value
            // per segment: 27 bytes of header before the lacing table.
            let Some(start) = self.pending.windows(4).position(|window| window == b"OggS") else {
                // Keep 3 bytes: the next chunk may finish an "OggS" that starts here.
                let keep = self.pending.len().saturating_sub(3);
                self.pending.drain(..keep);
                break;
            };
            self.pending.drain(..start);
            if self.pending.len() < 27 {
                break;
            }
            let segments = self.pending[26] as usize;
            if self.pending.len() < 27 + segments {
                break;
            }
            let lacing: Vec<usize> = self.pending[27..27 + segments]
                .iter()
                .map(|&value| value as usize)
                .collect();
            let size = 27 + segments + lacing.iter().sum::<usize>();
            if self.pending.len() < size {
                if self.pending.len() > MAX_PENDING_BYTES {
                    self.pending.drain(..4);
                    continue;
                }
                break;
            }
            let header = self.pending[5];
            let serial = u32::from_le_bytes([self.pending[14], self.pending[15], self.pending[16], self.pending[17]]);
            let page: Vec<u8> = self.pending.drain(..size).collect();
            // Unless this page continues a packet (0x01), or if it begins a stream (0x02), any
            // half-collected packet of this stream is stale.
            if header & 0x02 != 0 || header & 0x01 == 0 {
                self.packets.remove(&serial);
            }
            let mut offset = 27 + segments;
            for value in lacing {
                let packet = self.packets.entry(serial).or_default();
                if packet.len() + value <= MAX_PACKET_BYTES {
                    packet.extend_from_slice(&page[offset..offset + value]);
                }
                offset += value;
                // A lacing value below 255 ends a packet.
                if value < 255 {
                    let packet = self.packets.remove(&serial).unwrap_or_default();
                    found = comments(&packet).or(found);
                }
            }
        }
        found
    }
}

// Parses a comment header: "OpusTags" or "\x03vorbis", then a vendor string and a list of
// KEY=value entries, all lengths little-endian u32. Keys are case-insensitive.
fn comments(packet: &[u8]) -> Option<NowPlaying> {
    let body = packet
        .strip_prefix(b"OpusTags")
        .or_else(|| packet.strip_prefix(b"\x03vorbis"))?;
    let mut at = 0;
    let mut read = |count: usize| -> Option<&[u8]> {
        let slice = body.get(at..at + count)?;
        at += count;
        Some(slice)
    };
    let length = |bytes: &[u8]| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let vendor = length(read(4)?);
    read(vendor)?;
    let count = length(read(4)?);
    let mut now = NowPlaying::default();
    for _ in 0..count {
        let size = length(read(4)?);
        let entry = String::from_utf8_lossy(read(size)?).into_owned();
        let Some((key, value)) = entry.split_once('=') else {
            continue;
        };
        match key.to_ascii_uppercase().as_str() {
            "TITLE" => now.title = value.trim().to_owned(),
            "ARTIST" => now.artist = value.trim().to_owned(),
            _ => {}
        }
    }
    (!now.title.is_empty()).then_some(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opus_tags(entries: &[&str]) -> Vec<u8> {
        let mut packet = b"OpusTags".to_vec();
        packet.extend_from_slice(&3u32.to_le_bytes());
        packet.extend_from_slice(b"lib");
        packet.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for entry in entries {
            packet.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            packet.extend_from_slice(entry.as_bytes());
        }
        packet
    }

    fn page(serial: u32, header: u8, packet: &[u8]) -> Vec<u8> {
        let mut lacing = vec![255u8; packet.len() / 255];
        lacing.push((packet.len() % 255) as u8);
        let mut bytes = b"OggS".to_vec();
        bytes.extend_from_slice(&[0, header]);
        bytes.extend_from_slice(&[0; 8]);
        bytes.extend_from_slice(&serial.to_le_bytes());
        bytes.extend_from_slice(&[0; 8]);
        bytes.push(lacing.len() as u8);
        bytes.extend_from_slice(&lacing);
        bytes.extend_from_slice(packet);
        bytes
    }

    #[test]
    fn reads_the_song_from_opus_tags_split_across_chunks() {
        let stream = [
            page(7, 0x02, b"OpusHead........"),
            page(
                7,
                0,
                &opus_tags(&["ARTIST=June Rivers", "title=Good Night", "x".repeat(600).as_str()]),
            ),
        ]
        .concat();
        let mut tags = OggTags::default();
        let (first, second) = stream.split_at(40);
        assert_eq!(tags.feed(first), None);
        assert_eq!(
            tags.feed(second),
            Some(NowPlaying {
                title: "Good Night".into(),
                artist: "June Rivers".into()
            })
        );
    }

    #[test]
    fn strips_icy_metadata_and_reads_the_title() {
        let meta = b"StreamTitle='June Rivers - Good Night';";
        let padded = meta.len().div_ceil(16) * 16;
        let mut stream = b"abcd".to_vec();
        stream.push((padded / 16) as u8);
        stream.extend_from_slice(meta);
        stream.resize(5 + padded, 0);
        stream.extend_from_slice(b"efgh");
        let mut stripper = IcyStripper::new(4);
        let (audio, now) = stripper.feed(&stream[..7]);
        let (rest, later) = stripper.feed(&stream[7..]);
        assert_eq!([audio, rest].concat(), b"abcdefgh");
        assert_eq!(
            now.or(later),
            Some(NowPlaying {
                title: "Good Night".into(),
                artist: "June Rivers".into()
            })
        );
    }
}
