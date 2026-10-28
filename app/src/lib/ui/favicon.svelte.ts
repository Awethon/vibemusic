const V_PATH = 'M6.72-16.90L11.45-5.39L16.27-16.90L22.72-16.90L14.82 0L7.93 0L0.03-16.90L6.72-16.90Z';
const LETTERS = 'translate(5.00 23.36) scale(1 1) translate(-0.03 17.28)';
const M_PATH = 'M22.81-11.16L21.75-16.84L26.69-16.84L27.31-13.14Q27.40-13.32 27.49-13.49L27.49-13.49Q28.55-15.33 30.17-16.30Q31.78-17.28 33.76-17.28L33.76-17.28Q36.01-17.28 37.61-16.32Q39.21-15.36 40.06-13.58L40.06-13.58Q40.21-13.26 40.33-12.93L40.33-12.93Q40.48-13.23 40.63-13.49L40.63-13.49Q41.69-15.33 43.30-16.30Q44.92-17.28 46.87-17.28L46.87-17.28Q49.12-17.28 50.73-16.32Q52.34-15.36 53.19-13.58Q54.03-11.81 54.03-9.35L54.03-9.35L54.03 0L49.09 0L49.09-8.61Q49.09-10.89 48.10-12.06Q47.11-13.23 45.21-13.23L45.21-13.23Q43.88-13.23 42.90-12.59Q41.93-11.95 41.41-10.83Q40.89-9.71 40.89-8.14L40.89-8.14L40.89 0L35.95 0L35.95-8.61Q35.95-10.89 34.96-12.06Q33.97-13.23 32.07-13.23L32.07-13.23Q30.74-13.23 29.77-12.59Q28.79-11.95 28.27-10.83Q27.75-9.71 27.75-8.14L27.75-8.14L27.75 0L22.81 0L22.81-11.16Z';

export const FAVICON_ACCENT = '#e0706f';

export const faviconSvg = (accent: string, corner = 15) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${corner}" fill="#141017"/><g transform="${LETTERS}"><path d="${V_PATH}" fill="#f6f3ee"/><path d="${M_PATH}" fill="${accent}"/></g></svg>`;

const href = (accent: string) => `data:image/svg+xml,${encodeURIComponent(faviconSvg(accent))}`;

export const favicon = $state({ href: href(FAVICON_ACCENT) });

export function setFaviconAccent(accent: string | null) {
	const next = href(accent ?? FAVICON_ACCENT);
	if (next !== favicon.href) favicon.href = next;
}
