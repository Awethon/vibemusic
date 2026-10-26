export function clock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds || 0));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const rest = String(whole % 60).padStart(2, '0');
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function longDuration(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

export const countLabel = (count: number, cap: number) => (count > cap ? `${cap}+` : String(count));

export function alphabetBucket(text: string): string {
	const first = text.trim().charAt(0).toUpperCase();
	if (!first) return '#';
	return /[A-ZА-ЯЁ]/.test(first) ? (first === 'Ё' ? 'Е' : first) : '#';
}

export const decadeLabel = (year: number) => (year > 0 ? `${String(Math.floor(year / 10) * 10).slice(2)}s` : '—');

export function relativeTime(iso: string): string {
	if (!iso) return '';
	const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} days ago`;
}

export const formatCount = (count: number) => count.toLocaleString('en');

export const withoutLeadingThe = (name: string) => name.replace(/^the\s+/i, '');
