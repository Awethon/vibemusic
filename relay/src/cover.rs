//! Draws the cover of a "This is <artist>" playlist: a gradient in colours taken from the newest
//! album, a fan of up to five album covers, "THIS IS", the artist name and the vibemusic mark.
//! Output is a 1200 px square JPEG. The fonts are bundled (SIL Open Font License, in `fonts/`).

use ab_glyph::{Font, FontVec, PxScale, ScaleFont, VariableFont, point};
use image::codecs::jpeg::JpegEncoder;
use image::{GrayImage, Luma, RgbImage, Rgba, RgbaImage, imageops};

const UNBOUNDED: &[u8] = include_bytes!("../fonts/Unbounded.ttf");
const ONEST: &[u8] = include_bytes!("../fonts/Onest.ttf");

// Layout numbers below are in a 600 px design space and multiplied by SCALE.
const SIZE: u32 = 1200;
const SCALE: f32 = SIZE as f32 / 600.0;
const INK: [u8; 3] = [246, 243, 238];

// Same algorithm as Python's `colorsys.rgb_to_hls`; components and results are in 0..1.
fn rgb_to_hls(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (min + max) / 2.0;
    if (max - min).abs() < f32::EPSILON {
        return (0.0, l, 0.0);
    }
    let s = if l <= 0.5 {
        (max - min) / (max + min)
    } else {
        (max - min) / (2.0 - max - min)
    };
    let rc = (max - r) / (max - min);
    let gc = (max - g) / (max - min);
    let bc = (max - b) / (max - min);
    let h = if r == max {
        bc - gc
    } else if g == max {
        2.0 + rc - bc
    } else {
        4.0 + gc - rc
    };
    ((h / 6.0).rem_euclid(1.0), l, s)
}

fn hls_to_rgb(h: f32, l: f32, s: f32) -> [u8; 3] {
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return [v, v, v];
    }
    let m2 = if l <= 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let m1 = 2.0 * l - m2;
    let v = |hue: f32| {
        let hue = hue.rem_euclid(1.0);
        if hue < 1.0 / 6.0 {
            m1 + (m2 - m1) * hue * 6.0
        } else if hue < 0.5 {
            m2
        } else if hue < 2.0 / 3.0 {
            m1 + (m2 - m1) * (2.0 / 3.0 - hue) * 6.0
        } else {
            m1
        }
    };
    [v(h + 1.0 / 3.0), v(h), v(h - 1.0 / 3.0)].map(|c| (c * 255.0).round() as u8)
}

// Median-cut quantisation: the `count` main colours of the pixels, most common first.
fn median_cut(pixels: Vec<[f32; 3]>, count: usize) -> Vec<[f32; 3]> {
    let spread = |b: &[[f32; 3]], c: usize| {
        b.iter().map(|p| p[c]).fold(f32::MIN, f32::max) - b.iter().map(|p| p[c]).fold(f32::MAX, f32::min)
    };
    let widest = |b: &[[f32; 3]]| {
        (0..3)
            .max_by(|&x, &y| spread(b, x).total_cmp(&spread(b, y)).then(y.cmp(&x)))
            .unwrap_or(0)
    };
    let mut boxes = vec![pixels];
    while boxes.len() < count {
        let Some(index) = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.len() > 1 && spread(b, widest(b)) > 0.0)
            .max_by(|a, b| a.1.len().cmp(&b.1.len()).then(b.0.cmp(&a.0)))
            .map(|(i, _)| i)
        else {
            break;
        };
        let mut b = boxes.remove(index);
        let c = widest(&b);
        b.sort_by(|x, y| x[c].total_cmp(&y[c]));
        let upper = b.split_off(b.len() / 2);
        boxes.push(b);
        boxes.push(upper);
    }
    boxes.sort_by_key(|b| std::cmp::Reverse(b.len()));
    boxes
        .iter()
        .map(|b| [0, 1, 2].map(|c| b.iter().map(|p| p[c]).sum::<f32>() / b.len() as f32))
        .collect()
}

struct Theme {
    accent: [u8; 3],
    accent_soft: [u8; 3],
    dark: [u8; 3],
    deep: [u8; 3],
}

// Picks the most colourful of the cover's main colours (saturated, not too dark or light) and
// derives the palette from its hue at fixed lightness, so every cover reads well under light text.
fn theme_of(image: &RgbImage) -> Theme {
    let sample = imageops::resize(image, 48, 48, imageops::FilterType::CatmullRom);
    let colors = median_cut(
        sample
            .pixels()
            .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
            .collect(),
        6,
    );
    let colourfulness = |c: &[f32; 3]| {
        let (_, l, s) = rgb_to_hls(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0);
        s * (1.0 - (l - 0.5).abs() * 1.6)
    };
    let best = colors.iter().fold(None::<&[f32; 3]>, |best, c| match best {
        Some(b) if colourfulness(b) >= colourfulness(c) => Some(b),
        _ => Some(c),
    });
    let c = best.copied().unwrap_or([128.0; 3]);
    let c = &c;
    let (h, _, s) = rgb_to_hls(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0);
    let vivid = s.clamp(0.45, 0.9);
    Theme {
        accent: hls_to_rgb(h, 0.68, vivid),
        accent_soft: hls_to_rgb(h, 0.45, vivid),
        dark: hls_to_rgb(h, 0.16, vivid.min(0.55)),
        deep: hls_to_rgb(h, 0.08, vivid.min(0.5)),
    }
}

fn mix(a: [u8; 3], b: [u8; 3], t: f32) -> [f32; 3] {
    [0, 1, 2].map(|i| a[i] as f32 + (b[i] as f32 - a[i] as f32) * t)
}

// A dark diagonal gradient (20 degrees) with a soft accent glow towards the bottom right.
fn background(theme: &Theme) -> RgbaImage {
    let (sin, cos) = 20f32.to_radians().sin_cos();
    let half = SIZE as f32 / 2.0;
    RgbaImage::from_fn(SIZE, SIZE, |x, y| {
        let (dx, dy) = (x as f32 + 0.5 - half, y as f32 + 0.5 - half);
        let source_y = SIZE as f32 + dx * sin + dy * cos;
        let ramp = (source_y * 256.0 / (SIZE as f32 * 2.0)).floor().clamp(0.0, 255.0);
        let base = mix(theme.dark, theme.deep, ramp / 255.0);
        let gx = (x as f32 + 0.5 - SIZE as f32 * 0.85) * 256.0 / (SIZE as f32 * 2.4);
        let gy = (y as f32 + 0.5 - SIZE as f32) * 256.0 / (SIZE as f32 * 1.8);
        let value = ((gx * gx + gy * gy).sqrt() * std::f32::consts::SQRT_2).min(255.0);
        let glow = ((255.0 - (value / 0.6).round()).max(0.0) * 0.55).floor() / 255.0;
        let soft = theme.accent_soft.map(|c| c as f32);
        let out = [0, 1, 2].map(|i| (base[i] + (soft[i] - base[i]) * glow).round() as u8);
        Rgba([out[0], out[1], out[2], 255])
    })
}

fn inside_rounded(x: f32, y: f32, left: f32, top: f32, right: f32, bottom: f32, radius: f32) -> bool {
    if x < left || x > right || y < top || y > bottom {
        return false;
    }
    let cx = x.clamp(left + radius, right - radius);
    let cy = y.clamp(top + radius, bottom - radius);
    (x - cx).powi(2) + (y - cy).powi(2) <= radius * radius
}

// How much of the pixel centred at (x, y) lies inside the rounded rectangle: anti-aliased corners.
fn corner_coverage(x: f32, y: f32, width: f32, height: f32, radius: f32) -> f32 {
    let cx = x.clamp(radius, width - radius);
    let cy = y.clamp(radius, height - radius);
    (radius + 0.5 - ((x - cx).powi(2) + (y - cy).powi(2)).sqrt()).clamp(0.0, 1.0)
}

fn rounded(image: &RgbImage, radius: f32) -> RgbaImage {
    let (w, h) = (image.width() as f32, image.height() as f32);
    RgbaImage::from_fn(image.width(), image.height(), |x, y| {
        let p = image.get_pixel(x, y);
        Rgba([
            p[0],
            p[1],
            p[2],
            (corner_coverage(x as f32 + 0.5, y as f32 + 0.5, w, h, radius) * 255.0).round() as u8,
        ])
    })
}

// Rotates with bilinear sampling into a canvas big enough for the rotated image. Colours are
// weighted by alpha (premultiplied), so transparent corners do not bleed dark fringes into edges.
fn rotate_expand(image: &RgbaImage, degrees: f32) -> RgbaImage {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (w, h) = (image.width() as f32, image.height() as f32);
    let out_w = (w * cos.abs() + h * sin.abs()).ceil() as u32;
    let out_h = (w * sin.abs() + h * cos.abs()).ceil() as u32;
    let sample = |sx: f32, sy: f32| -> [f32; 4] {
        let (x0, y0) = (sx.floor(), sy.floor());
        let (fx, fy) = (sx - x0, sy - y0);
        let mut acc = [0f32; 4];
        for (ox, oy, weight) in [
            (0.0, 0.0, (1.0 - fx) * (1.0 - fy)),
            (1.0, 0.0, fx * (1.0 - fy)),
            (0.0, 1.0, (1.0 - fx) * fy),
            (1.0, 1.0, fx * fy),
        ] {
            let (px, py) = (x0 + ox, y0 + oy);
            if px < 0.0 || py < 0.0 || px >= w || py >= h || weight == 0.0 {
                continue;
            }
            let p = image.get_pixel(px as u32, py as u32);
            let a = p[3] as f32 / 255.0;
            acc[0] += p[0] as f32 * a * weight;
            acc[1] += p[1] as f32 * a * weight;
            acc[2] += p[2] as f32 * a * weight;
            acc[3] += a * weight;
        }
        acc
    };
    RgbaImage::from_fn(out_w, out_h, |x, y| {
        let (dx, dy) = (x as f32 + 0.5 - out_w as f32 / 2.0, y as f32 + 0.5 - out_h as f32 / 2.0);
        let sx = dx * cos - dy * sin + w / 2.0 - 0.5;
        let sy = dx * sin + dy * cos + h / 2.0 - 0.5;
        let [r, g, b, a] = sample(sx, sy);
        if a <= 0.0 {
            return Rgba([0, 0, 0, 0]);
        }
        Rgba([
            (r / a).round() as u8,
            (g / a).round() as u8,
            (b / a).round() as u8,
            (a * 255.0).round() as u8,
        ])
    })
}

fn rotate_gray(image: &GrayImage, degrees: f32) -> GrayImage {
    let as_rgba = RgbaImage::from_fn(image.width(), image.height(), |x, y| {
        Rgba([0, 0, 0, image.get_pixel(x, y)[0]])
    });
    let rotated = rotate_expand(&as_rgba, degrees);
    GrayImage::from_fn(rotated.width(), rotated.height(), |x, y| {
        Luma([rotated.get_pixel(x, y)[3]])
    })
}

fn blend(canvas: &mut RgbaImage, x: i64, y: i64, color: [f32; 3], alpha: f32) {
    if x < 0 || y < 0 || x >= canvas.width() as i64 || y >= canvas.height() as i64 || alpha <= 0.0 {
        return;
    }
    let p = canvas.get_pixel_mut(x as u32, y as u32);
    for i in 0..3 {
        p[i] = (p[i] as f32 * (1.0 - alpha) + color[i] * alpha)
            .round()
            .clamp(0.0, 255.0) as u8;
    }
}

// Draws a tile rotated by `angle` degrees about its centre, over a blurred drop shadow offset
// down and to the left.
fn place(canvas: &mut RgbaImage, tile: &RgbaImage, left: f32, top: f32, angle: f32) {
    let rotated = rotate_expand(tile, angle);
    let center_x = left + tile.width() as f32 / 2.0;
    let center_y = top + tile.height() as f32 / 2.0;
    let spread = (12.0 * SCALE).round();
    let pad = (60.0 * SCALE).round();
    let (sw, sh) = (tile.width() as f32 + pad * 2.0, tile.height() as f32 + pad * 2.0);
    let shadow = GrayImage::from_fn(sw as u32, sh as u32, |x, y| {
        let inside = inside_rounded(
            x as f32,
            y as f32,
            pad + spread,
            pad + spread,
            pad + tile.width() as f32 - spread,
            pad + tile.height() as f32 - spread,
            (10.0 * SCALE).round(),
        );
        Luma([if inside { 190 } else { 0 }])
    });
    let shadow = imageproc::filter::gaussian_blur_f32(&rotate_gray(&shadow, angle), 22.0 * SCALE);
    let sx = (center_x - shadow.width() as f32 / 2.0 - 14.0 * SCALE).round() as i64;
    let sy = (center_y - shadow.height() as f32 / 2.0 + 22.0 * SCALE).round() as i64;
    for (x, y, p) in shadow.enumerate_pixels() {
        blend(canvas, sx + x as i64, sy + y as i64, [0.0; 3], p[0] as f32 / 255.0);
    }
    let rx = (center_x - rotated.width() as f32 / 2.0).round() as i64;
    let ry = (center_y - rotated.height() as f32 / 2.0).round() as i64;
    for (x, y, p) in rotated.enumerate_pixels() {
        blend(
            canvas,
            rx + x as i64,
            ry + y as i64,
            [p[0] as f32, p[1] as f32, p[2] as f32],
            p[3] as f32 / 255.0,
        );
    }
}

struct Face {
    font: FontVec,
    scale: PxScale,
    size: f32,
}

impl Face {
    // `weight` sets the variable font's `wght` axis.
    fn new(bytes: &[u8], size: f32, weight: f32) -> Self {
        let mut font = FontVec::try_from_vec(bytes.to_vec()).expect("bundled font");
        font.set_variation(b"wght", weight);
        let size = size.round();
        // `size` is a CSS-style font size (the em). ab_glyph's PxScale is the ascent-to-descent
        // height instead, so convert.
        let px = size * font.height_unscaled() / font.units_per_em().expect("bundled font has units per em");
        Face {
            font,
            scale: PxScale::from(px),
            size,
        }
    }

    fn advance(&self, character: char) -> f32 {
        let scaled = self.font.as_scaled(self.scale);
        scaled.h_advance(self.font.glyph_id(character))
    }

    fn length(&self, text: &str) -> f32 {
        let scaled = self.font.as_scaled(self.scale);
        let mut total = 0.0;
        let mut previous = None;
        for character in text.chars() {
            let id = self.font.glyph_id(character);
            if let Some(prev) = previous {
                total += scaled.kern(prev, id);
            }
            total += scaled.h_advance(id);
            previous = Some(id);
        }
        total
    }

    fn ascent(&self) -> f32 {
        self.font.as_scaled(self.scale).ascent()
    }

    // Where the drawn glyph starts and ends vertically, for aligning text by its ink rather than
    // the font's line box.
    fn ink_top(&self, sample: char) -> f32 {
        let glyph = self
            .font
            .glyph_id(sample)
            .with_scale_and_position(self.scale, point(0.0, self.ascent()));
        self.font
            .outline_glyph(glyph)
            .map(|outline| outline.px_bounds().min.y)
            .unwrap_or(0.0)
    }

    fn ink_bottom(&self, sample: char) -> f32 {
        let glyph = self
            .font
            .glyph_id(sample)
            .with_scale_and_position(self.scale, point(0.0, self.ascent()));
        self.font
            .outline_glyph(glyph)
            .map(|outline| outline.px_bounds().max.y)
            .unwrap_or(0.0)
    }

    fn draw(&self, canvas: &mut RgbaImage, character: char, x: f32, y: f32, color: [u8; 3]) {
        let glyph = self
            .font
            .glyph_id(character)
            .with_scale_and_position(self.scale, point(x, y + self.ascent()));
        if let Some(outline) = self.font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            let color = color.map(|c| c as f32);
            outline.draw(|gx, gy, coverage| {
                blend(
                    canvas,
                    bounds.min.x as i64 + gx as i64,
                    bounds.min.y as i64 + gy as i64,
                    color,
                    coverage.min(1.0),
                )
            });
        }
    }

    fn draw_tracked(&self, canvas: &mut RgbaImage, text: &str, x: f32, y: f32, color: [u8; 3], tracking: f32) {
        let mut x = x;
        for character in text.chars() {
            self.draw(canvas, character, x, y, color);
            x += self.advance(character) + tracking;
        }
    }
}

// The largest title size (78 down to 34 design px) at which the name fits in `max_width`, counting
// the -3% letter spacing it is drawn with. Longer names than that overflow at the smallest size.
fn fit_name(name: &str, max_width: f32) -> Face {
    for size in (34..=78).rev() {
        let face = Face::new(UNBOUNDED, size as f32 * SCALE, 700.0);
        if face.length(name) - name.chars().count() as f32 * size as f32 * SCALE * 0.03 <= max_width {
            return face;
        }
    }
    Face::new(UNBOUNDED, 34.0 * SCALE, 700.0)
}

// (left, top, size, rotation in degrees) of each cover, front one first, in design px.
fn fan_layout(count: usize) -> Vec<(f32, f32, f32, f32)> {
    match count {
        1 => vec![(214.0, 200.0, 340.0, -2.0)],
        2 => vec![(256.0, 262.0, 300.0, 0.0), (110.0, 196.0, 300.0, 5.0)],
        _ => {
            let step_x = (248.0 / (count as f32 - 1.0)).min(110.0);
            let step_y = (120.0 / (count as f32 - 1.0)).min(60.0);
            (0..count)
                .map(|i| {
                    (
                        300.0 - i as f32 * step_x,
                        296.0 - i as f32 * step_y,
                        270.0,
                        i as f32 * 3.0,
                    )
                })
                .collect()
        }
    }
}

pub fn render(name: &str, newest: &RgbImage, covers: &[RgbImage]) -> Vec<u8> {
    let theme = theme_of(newest);
    let mut canvas = background(&theme);
    let layout = fan_layout(covers.len().clamp(1, 5));
    // Drawn back to front, so the newest album ends up on top.
    for (index, &(left, top, size, angle)) in layout.iter().enumerate().rev() {
        let Some(cover) = covers.get(index) else { continue };
        let tile_size = (size * SCALE).round() as u32;
        let art = imageops::resize(cover, tile_size, tile_size, imageops::FilterType::Lanczos3);
        place(
            &mut canvas,
            &rounded(&art, (10.0 * SCALE).round()),
            left * SCALE,
            top * SCALE,
            angle,
        );
    }
    let eyebrow = Face::new(ONEST, 22.0 * SCALE, 600.0);
    eyebrow.draw_tracked(
        &mut canvas,
        "THIS IS",
        44.0 * SCALE,
        44.0 * SCALE - eyebrow.ink_top('T'),
        theme.accent,
        22.0 * SCALE * 0.24,
    );
    let title = fit_name(name, (600.0 - 88.0) * SCALE);
    title.draw_tracked(
        &mut canvas,
        name,
        44.0 * SCALE,
        82.0 * SCALE - title.ink_top('H') + 6.0 * SCALE,
        INK,
        -title.size * 0.03,
    );
    let mark_v = Face::new(UNBOUNDED, 26.0 * SCALE, 500.0);
    let mark_m = Face::new(UNBOUNDED, 26.0 * SCALE, 300.0);
    let mark_y = SIZE as f32 - 34.0 * SCALE - mark_v.ink_bottom('v');
    mark_v.draw(&mut canvas, 'v', 44.0 * SCALE, mark_y, INK);
    mark_m.draw(
        &mut canvas,
        'm',
        44.0 * SCALE + mark_v.advance('v') - 26.0 * SCALE * 0.04,
        mark_y,
        theme.accent,
    );
    let rgb = image::DynamicImage::ImageRgba8(canvas).to_rgb8();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&rgb)
        .expect("jpeg in memory");
    jpeg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_a_square_jpeg_with_a_theme_from_the_newest_album() {
        let red = RgbImage::from_pixel(64, 64, image::Rgb([200, 30, 40]));
        let jpeg = render(
            "Glass Harbor",
            &red,
            &[red.clone(), RgbImage::from_pixel(64, 64, image::Rgb([20, 20, 200]))],
        );
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (SIZE, SIZE));
        let theme = theme_of(&red);
        assert!(theme.accent[0] > theme.accent[2]);
    }

    #[test]
    fn shrinks_long_names_to_fit() {
        let short = fit_name("Lume", (600.0 - 88.0) * SCALE);
        let long = fit_name("The Long Weekend Orchestra & Friends", (600.0 - 88.0) * SCALE);
        assert!(long.size < short.size);
    }

    #[test]
    fn rounds_corners_smoothly() {
        let tile = rounded(&RgbImage::from_pixel(40, 40, image::Rgb([255, 255, 255])), 10.0);
        assert_eq!(tile.get_pixel(0, 0)[3], 0);
        assert_eq!(tile.get_pixel(20, 20)[3], 255);
        let blended = (0..10)
            .flat_map(|x| (0..10).map(move |y| (x, y)))
            .filter(|&(x, y)| (1..255).contains(&tile.get_pixel(x, y)[3]))
            .count();
        assert!(blended >= 8, "only {blended} blended corner pixels");
    }
}
