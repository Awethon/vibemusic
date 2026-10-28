const V_PATH = 'M11.46 23.23L16.42 35.29L21.47 23.23L28.23 23.23L19.95 40.93L12.73 40.93L4.45 23.23L11.46 23.23Z';
const M_PATH = 'M29.17 28.99L28.18 23.47L31.03 23.47L31.74 27.81Q31.93 27.41 32.15 27.04L32.15 27.04Q33.17 25.15 34.86 24.11Q36.55 23.07 38.69 23.07L38.69 23.07Q40.95 23.07 42.53 24.05Q44.11 25.02 44.95 26.85L44.95 26.85Q45.23 27.44 45.38 28.13L45.38 28.13Q45.60 27.54 45.91 27.04L45.91 27.04Q46.93 25.15 48.62 24.11Q50.31 23.07 52.42 23.07L52.42 23.07Q54.68 23.07 56.28 24.05Q57.88 25.02 58.71 26.87Q59.55 28.71 59.55 31.32L59.55 31.32L59.55 40.93L56.70 40.93L56.70 31.81Q56.70 28.68 55.40 27.09Q54.09 25.49 51.61 25.49L51.61 25.49Q49.85 25.49 48.53 26.36Q47.21 27.23 46.50 28.76Q45.79 30.29 45.79 32.34L45.79 32.34L45.79 40.93L42.93 40.93L42.93 31.81Q42.93 28.68 41.63 27.09Q40.33 25.49 37.85 25.49L37.85 25.49Q36.08 25.49 34.77 26.36Q33.45 27.23 32.73 28.76Q32.02 30.29 32.02 32.34L32.02 32.34L32.02 40.93L29.17 40.93L29.17 28.99Z';

export const FAVICON_ACCENT = '#e0706f';

export const faviconSvg = (accent: string, corner = 15) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${corner}" fill="#141017"/><path d="${V_PATH}" fill="#f6f3ee"/><path d="${M_PATH}" fill="${accent}"/></svg>`;

const href = (accent: string) => `data:image/svg+xml,${encodeURIComponent(faviconSvg(accent))}`;

export const favicon = $state({ href: href(FAVICON_ACCENT) });

export function setFaviconAccent(accent: string | null) {
	const next = href(accent ?? FAVICON_ACCENT);
	if (next !== favicon.href) favicon.href = next;
}
