// Decides a track's genres by weighted vote. File tags are trusted most; Deezer's album genre adds
// a smaller vote; MusicBrainz album tags count by their vote share, and artist tags are only
// consulted when the file has no usable genre and album tags are thin.
import { GENRE_EVIDENCE } from '../tuning.ts';
import type { GenreResolver } from './genres.ts';

export type Tag = [name: string, votes: number];
export type Evidence = { fileGenres: string[]; albumTags: Tag[] | null; artistTags: Tag[] | null; storeGenre?: string | null };

function addTags(resolver: GenreResolver, tags: Tag[], votes: Map<string, number>): number {
	const resolved = tags.flatMap(([name, count]) => {
		const genre = resolver.knownGenre(name);
		return genre && count > 0 ? [[genre, count] as const] : [];
	});
	// Tags are scored relative to the most-voted one, and the whole set is discounted when even the
	// top tag has few votes (one or two votes is weak evidence). Tags below minTagShare are dropped as noise.
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
	if (evidence.storeGenre) votes.set(evidence.storeGenre, (votes.get(evidence.storeGenre) ?? 0) + GENRE_EVIDENCE.storeGenreWeight);
	const fileTagged = resolver.genresOf(evidence.fileGenres).length > 0;
	const albumConfidence = evidence.albumTags?.length ? addTags(resolver, evidence.albumTags, votes) : 0;
	if (!fileTagged && albumConfidence < 1 && evidence.artistTags?.length) addTags(resolver, evidence.artistTags, votes);
	const ranked = [...votes].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const chosen = ranked.filter(([, weight]) => weight >= GENRE_EVIDENCE.minWeight).map(([genre]) => genre);
	// If nothing is strong enough on its own, still keep the single best guess.
	return chosen.length ? chosen : ranked.slice(0, 1).map(([genre]) => genre);
}
