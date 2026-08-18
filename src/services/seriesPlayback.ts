// Fila de episódios de uma série — resolve get_series_info UMA vez e navega
// por índice (próximo/anterior episódio, auto-play no fim). Compartilhado por
// Series, MyList, Favorites e Home (continuar assistindo).

import { api } from './api';

export interface QueueEpisode {
    id: string;
    season: number;
    episode: number;
    container: string;
    title: string;
}

export interface EpisodeQueue {
    seriesId: string;
    seriesName: string;
    poster?: string;
    episodes: QueueEpisode[];
    index: number;
}

export async function buildEpisodeQueue(
    seriesId: string | number,
    seriesName: string,
    poster?: string,
    season?: number,
    episode?: number
): Promise<EpisodeQueue | null> {
    const info = await api.getSeriesInfo(Number(seriesId));
    const episodes: QueueEpisode[] = [];
    const seasonKeys = Object.keys(info?.episodes || {}).sort((a, b) => Number(a) - Number(b));
    for (const key of seasonKeys) {
        for (const ep of info.episodes[key] || []) {
            episodes.push({
                id: String(ep.id),
                season: Number(key),
                episode: Number(ep.episode_num),
                container: ep.container_extension || 'mp4',
                title: ep.title || '',
            });
        }
    }
    if (episodes.length === 0) return null;

    let index = 0;
    if (season != null) {
        const found = episodes.findIndex(e => e.season === season && (episode == null || e.episode === episode));
        index = found >= 0 ? found : 0;
    }
    return { seriesId: String(seriesId), seriesName, poster, episodes, index };
}

export function currentEpisode(queue: EpisodeQueue): QueueEpisode {
    return queue.episodes[queue.index];
}

export function playbackUrl(queue: EpisodeQueue): string {
    const ep = currentEpisode(queue);
    return api.getSeriesStreamUrl(ep.id, ep.container);
}

export function playbackTitle(queue: EpisodeQueue): string {
    const ep = currentEpisode(queue);
    return `${queue.seriesName} - T${ep.season} E${ep.episode}`;
}

export function hasNext(queue: EpisodeQueue): boolean {
    return queue.index < queue.episodes.length - 1;
}

export function hasPrevious(queue: EpisodeQueue): boolean {
    return queue.index > 0;
}
