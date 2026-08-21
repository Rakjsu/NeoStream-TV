// Player de filme com progresso salvo (continuar assistindo) e retomada.
// Usado por Movies, MyList, Favorites e Home.

import { VideoPlayer } from './VideoPlayer';
import { progressService } from '../services/progressService';
import { api } from '../services/api';
import { useWatchSession } from '../hooks/useWatchSession';

interface MoviePlayerProps {
    /** Chave de progresso/favoritos (id do grupo de versões) */
    movieId: string;
    title: string;
    poster?: string;
    container?: string;
    /** Stream a reproduzir de fato (versão escolhida); default = movieId */
    streamId?: number;
    onClose: () => void;
}

export function MoviePlayer({ movieId, title, poster, container, streamId, onClose }: MoviePlayerProps) {
    const resumeTime = progressService.getMovieResumeTime(movieId);
    useWatchSession('movie', title);

    return (
        <VideoPlayer
            src={api.getVodStreamUrl(streamId ?? Number(movieId), container || 'mp4')}
            title={title}
            poster={poster}
            autoPlay
            contentType="movie"
            resumeTime={resumeTime}
            onTimeUpdate={(time, duration) => {
                progressService.saveMovie({ id: movieId, name: title, poster, container, time, duration });
            }}
            onClose={onClose}
        />
    );
}
