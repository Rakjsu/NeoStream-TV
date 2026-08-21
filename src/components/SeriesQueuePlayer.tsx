// Player de série com fila de episódios: próximo/anterior, auto-play no fim
// e progresso salvo (continuar assistindo). Usado por Series, MyList,
// Favorites e Home.

import { useRef, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { progressService } from '../services/progressService';
import { useWatchSession } from '../hooks/useWatchSession';
import {
    type EpisodeQueue,
    currentEpisode,
    playbackUrl,
    playbackTitle,
    hasNext,
    hasPrevious,
} from '../services/seriesPlayback';

interface SeriesQueuePlayerProps {
    queue: EpisodeQueue;
    onClose: () => void;
    /** Repassa pro VideoPlayer: aberto de dentro de um overlay (Busca Global) */
    isOverlayOwner?: boolean;
}

export function SeriesQueuePlayer({ queue: initialQueue, onClose, isOverlayOwner }: SeriesQueuePlayerProps) {
    const [queue, setQueue] = useState(initialQueue);
    // Vive aqui porque o VideoPlayer é remontado a cada episódio (key={ep.id});
    // dentro dele o contador voltaria a zero e o item 51 nunca dispararia
    const autoAdvanceCountRef = useRef(0);
    const ep = currentEpisode(queue);
    useWatchSession('series', queue.seriesName);
    const resumeTime = progressService.getSeriesResumeTime(queue.seriesId, ep.season, ep.episode);

    return (
        <VideoPlayer
            isOverlayOwner={isOverlayOwner}
            key={ep.id}
            autoAdvanceCountRef={autoAdvanceCountRef}
            src={playbackUrl(queue)}
            title={playbackTitle(queue)}
            poster={queue.poster}
            autoPlay
            contentType="series"
            resumeTime={resumeTime}
            onTimeUpdate={(time, duration) => {
                progressService.saveSeries({
                    seriesId: queue.seriesId,
                    seriesName: queue.seriesName,
                    poster: queue.poster,
                    season: ep.season,
                    episode: ep.episode,
                    episodeId: ep.id,
                    container: ep.container,
                    time,
                    duration,
                    isLastEpisode: !hasNext(queue),
                });
            }}
            onNextEpisode={() => setQueue(q => (hasNext(q) ? { ...q, index: q.index + 1 } : q))}
            onPreviousEpisode={() => setQueue(q => (hasPrevious(q) ? { ...q, index: q.index - 1 } : q))}
            canGoNext={hasNext(queue)}
            canGoPrevious={hasPrevious(queue)}
            onClose={onClose}
        />
    );
}
