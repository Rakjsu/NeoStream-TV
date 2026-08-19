// Player de série com fila de episódios: próximo/anterior, auto-play no fim
// e progresso salvo (continuar assistindo). Usado por Series, MyList,
// Favorites e Home.

import { useState } from 'react';
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
}

export function SeriesQueuePlayer({ queue: initialQueue, onClose }: SeriesQueuePlayerProps) {
    const [queue, setQueue] = useState(initialQueue);
    const ep = currentEpisode(queue);
    useWatchSession('series', queue.seriesName);
    const resumeTime = progressService.getSeriesResumeTime(queue.seriesId, ep.season, ep.episode);

    return (
        <VideoPlayer
            key={ep.id}
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
