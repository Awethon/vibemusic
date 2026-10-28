import { GENRE_EVIDENCE } from '../tuning.ts';
import type { GenreResolver } from './genres.ts';

export type Tag = [name: string, votes: number];
export type Evidence = { fileGenres: string[]; albumTags: Tag[] | null; artistTags: Tag[] | null };

function addTags(resolver: GenreResolver, tags: Tag[], votes: Map<string, number>): number {
	const resolved = tags.flatMap(([name, count]) => {
		const genre = resolver.knownGenre(name);
		return genre && count > 0 ? [[genre, count] as const] : [];
	});
	const top = Math.max(0, ...resolved.map(([, count]) => count));
	if (!top) return 0;
	const confidence = Math.min(1, top / GENRE_EVIDENCE.confidentVotes);
	const strongest = new Map<string, number>();
	for (const [genre, count] of resolved) {
		const share = count / top;
		if (share >= GENRE_EVIDENCE.minTagShare) strongest.set(genre, Math.max(share, strongest.get(genre) ?? 0));
	}
	for (const [genre, share] of strongest) votes.set(genre, (votes.get(genre) ?? 0) + share * confidence);
	return confidence;
}

export function genresFromEvidence(resolver: GenreResolver, evidence: Evidence): string[] {
	const votes = new Map<string, number>();
	for (const genre of resolver.genresOf(evidence.fileGenres)) votes.set(genre, (votes.get(genre) ?? 0) + GENRE_EVIDENCE.fileTagWeight);
	const fileTagged = votes.size > 0;
	const albumConfidence = evidence.albumTags?.length ? addTags(resolver, evidence.albumTags, votes) : 0;
	if (!fileTagged && albumConfidence < 1 && evidence.artistTags?.length) addTags(resolver, evidence.artistTags, votes);
	const ranked = [...votes].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const chosen = ranked.filter(([, weight]) => weight >= GENRE_EVIDENCE.minWeight).map(([genre]) => genre);
	return chosen.length ? chosen : ranked.slice(0, 1).map(([genre]) => genre);
}
