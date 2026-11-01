// Picks a cover's palette for spread rather than area. k-means in OKLab finds the cover's colour
// clusters; the palette is the largest one, the lightest and darkest, the most vivid detail if the
// cover has one, then whichever cluster adds the most variety each time. Plain area-based methods
// (median cut) average small accents away (a red logo on a grey cover) and fill the palette with
// near-identical shades.
import { chroma, oklabToHex, rgbToOklab, type Oklab } from '../color.ts';
import { PALETTE } from '../tuning.ts';

const EXTRACTION = {
	clusters: 12,
	iterations: 12,
	// Seeding stops once every pixel is this close to a seed.
	seedStopDistance: 0.02,
	// Clusters covering less of the cover than this are ignored (noise, JPEG fringes).
	minShare: 0.003,
	// Clusters this close together after k-means count as one colour.
	mergeDistance: 0.07,
	// Picked colours must be at least this far apart (see spread()).
	minGap: 0.08,
	// The light and dark ends are only picked from clusters covering at least this much.
	endShare: 0.03,
	vividChroma: 0.1,
	// A greyish colour within this distance of the line between two picked colours is a blend of them.
	blendDistance: 0.035,
	greyishChroma: 0.04,
	// Below this lightness OKLab separates values the eye can't tell apart.
	nearBlackLightness: 0.3
};

type Cluster = { lab: Oklab; share: number };

const distance = (a: Oklab, b: Oklab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Lightness counts extra, so white details and black ink beat yet another mid grey. Near black,
// lightness counts less (#000000 and #070806 are the same colour to the eye).
function spread(a: Oklab, b: Oklab) {
	const nearBlack = Math.min(1, (Math.max(a[0], b[0]) / EXTRACTION.nearBlackLightness) ** 2);
	return Math.hypot((a[0] - b[0]) * 1.5 * nearBlack, a[1] - b[1], a[2] - b[2]);
}

function findClusters(lab: Oklab[]): Cluster[] {
	// Farthest-point seeding gives outlying colours (a small red logo) a cluster of their own.
	const mean = [0, 1, 2].map((channel) => lab.reduce((total, pixel) => total + pixel[channel], 0) / lab.length) as Oklab;
	let first = 0;
	for (let i = 1; i < lab.length; i++) if (distance(lab[i], mean) < distance(lab[first], mean)) first = i;
	const centres: Oklab[] = [[...lab[first]]];
	const nearest = lab.map((pixel) => distance(pixel, lab[first]));
	while (centres.length < EXTRACTION.clusters) {
		let far = 0;
		for (let i = 1; i < lab.length; i++) if (nearest[i] > nearest[far]) far = i;
		if (nearest[far] < EXTRACTION.seedStopDistance) break;
		centres.push([...lab[far]]);
		for (let i = 0; i < lab.length; i++) nearest[i] = Math.min(nearest[i], distance(lab[i], lab[far]));
	}
	const assigned = new Int32Array(lab.length);
	for (let iteration = 0; iteration < EXTRACTION.iterations; iteration++) {
		for (let i = 0; i < lab.length; i++) {
			let best = 0;
			for (let c = 1; c < centres.length; c++) if (distance(lab[i], centres[c]) < distance(lab[i], centres[best])) best = c;
			assigned[i] = best;
		}
		const sums = centres.map(() => [0, 0, 0, 0]);
		for (let i = 0; i < lab.length; i++) {
			const sum = sums[assigned[i]];
			sum[0] += lab[i][0];
			sum[1] += lab[i][1];
			sum[2] += lab[i][2];
			sum[3]++;
		}
		sums.forEach((sum, c) => {
			if (sum[3]) centres[c] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
		});
	}
	const counts = centres.map(() => 0);
	for (const c of assigned) counts[c]++;
	const clusters = centres.map((centre, c) => ({ lab: centre, share: counts[c] / lab.length })).filter((cluster) => cluster.share > 0);
	// Seeding can spend several seeds on one colour, so near-identical clusters are merged again.
	for (let merged = true; merged;) {
		merged = false;
		for (let i = 0; i < clusters.length && !merged; i++)
			for (let j = i + 1; j < clusters.length && !merged; j++) {
				if (distance(clusters[i].lab, clusters[j].lab) > EXTRACTION.mergeDistance) continue;
				const [a, b] = [clusters[i], clusters[j]];
				const share = a.share + b.share;
				clusters[i] = { lab: a.lab.map((value, k) => (value * a.share + b.lab[k] * b.share) / share) as Oklab, share };
				clusters.splice(j, 1);
				merged = true;
			}
	}
	return clusters;
}

// A colour lying on the straight line between two picked colours is a blend of them: the soft
// edge where black fades into white, or a smoky gradient.
function isBlend(cluster: Cluster, chosen: Cluster[]) {
	for (let i = 0; i < chosen.length; i++)
		for (let j = i + 1; j < chosen.length; j++) {
			const [a, b] = [chosen[i].lab, chosen[j].lab];
			const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const lengthSquared = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
			if (!lengthSquared) continue;
			const t = ((cluster.lab[0] - a[0]) * ab[0] + (cluster.lab[1] - a[1]) * ab[1] + (cluster.lab[2] - a[2]) * ab[2]) / lengthSquared;
			if (t <= 0 || t >= 1) continue;
			const onLine: Oklab = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
			if (distance(cluster.lab, onLine) < EXTRACTION.blendDistance) return true;
		}
	return false;
}

function pick(clusters: Cluster[]): Oklab[] {
	const candidates = clusters.filter((cluster) => cluster.share >= EXTRACTION.minShare);
	if (!candidates.length) return [];
	const chosen = [candidates.reduce((a, b) => (b.share > a.share ? b : a))];
	const add = (cluster: Cluster | undefined) => {
		if (cluster && chosen.every((other) => spread(other.lab, cluster.lab) >= EXTRACTION.minGap)) chosen.push(cluster);
	};
	// The light and dark ends come next, so a vivid accent as light as the white (a yellow next
	// to white paper) can't stand in for it.
	const substantial = candidates.filter((cluster) => cluster.share >= EXTRACTION.endShare);
	if (substantial.length) {
		add(substantial.reduce((a, b) => (b.lab[0] > a.lab[0] ? b : a)));
		add(substantial.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a)));
	}
	// On a mostly grey cover, area alone would rank a fifth grey above a red logo.
	const vivid = candidates.filter((cluster) => chroma(cluster.lab) >= EXTRACTION.vividChroma);
	if (vivid.length && chosen.every((cluster) => chroma(cluster.lab) < EXTRACTION.vividChroma))
		add(vivid.reduce((a, b) => (chroma(b.lab) * Math.sqrt(b.share) > chroma(a.lab) * Math.sqrt(a.share) ? b : a)));
	// Then whatever adds the most variety. Greyish blends are skipped (they only make the
	// background muddy), so a two-tone cover can end up with fewer colours than PALETTE.coverColors.
	while (chosen.length < PALETTE.coverColors) {
		let best: Cluster | null = null;
		let bestScore = 0;
		for (const cluster of candidates) {
			if (chosen.includes(cluster) || (chroma(cluster.lab) < EXTRACTION.greyishChroma && isBlend(cluster, chosen))) continue;
			const gap = Math.min(...chosen.map((other) => spread(other.lab, cluster.lab)));
			if (gap < EXTRACTION.minGap) continue;
			const score = cluster.share ** 0.4 * gap * (1 + 5 * chroma(cluster.lab));
			if (score > bestScore) [best, bestScore] = [cluster, score];
		}
		if (!best) break;
		chosen.push(best);
	}
	return chosen.map((cluster) => cluster.lab);
}

// Muddy browns sit in one band: mid lightness, a little colour, a yellow-brown hue. A colour in
// that band moves gently toward whichever end it's nearer (espresso or cream) and turns slightly
// red (khaki toward mahogany). Membership fades out at the band's edges, so vivid, dark, light
// and grey colours are left alone.
const MUD = {
	lightness: 0.47,
	lightnessHalfWidth: 0.2,
	minChroma: 0.02,
	maxChroma: 0.085,
	chromaFade: 0.025,
	hueFromDegrees: 45,
	hueToDegrees: 105,
	hueFadeDegrees: 10,
	push: 0.09,
	redTurnDegrees: 12
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function unmud([L, a, b]: Oklab): Oklab {
	const C = Math.hypot(a, b);
	const hue = ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
	const inLightness = clamp01(1 - Math.abs(L - MUD.lightness) / MUD.lightnessHalfWidth);
	const inChroma = C < MUD.minChroma ? 0 : clamp01(1 - (C - MUD.maxChroma) / MUD.chromaFade);
	const inHue = clamp01(Math.min(hue - MUD.hueFromDegrees, MUD.hueToDegrees - hue) / MUD.hueFadeDegrees);
	const muddy = inLightness * inChroma * inHue;
	if (muddy <= 0) return [L, a, b];
	const nextHue = ((hue - MUD.redTurnDegrees * muddy) * Math.PI) / 180;
	return [L + (L < MUD.lightness ? -1 : 1) * MUD.push * muddy, C * Math.cos(nextHue), C * Math.sin(nextHue)];
}

/** Up to PALETTE.coverColors hex colours from RGBA pixels, largest area first. */
export function coverPalette(rgba: Uint8ClampedArray): string[] {
	const lab: Oklab[] = [];
	for (let offset = 0; offset < rgba.length; offset += 4) lab.push(rgbToOklab([rgba[offset], rgba[offset + 1], rgba[offset + 2]]));
	if (!lab.length) return [];
	return pick(findClusters(lab)).map((colour) => oklabToHex(unmud(colour)));
}
