// Player de filme com progresso salvo (continuar assistindo) e retomada.
// Usado por Movies, MyList, Favorites e Home.

import { VideoPlayer } from './VideoPlayer';
import { progressService } from '../services/progressService';
import { api } from '../services/api';
import { useWatchSession } from '../hooks/useWatchSession';

interface MoviePlayerProps {
    movieId: string;
    title: string;
    poster?: string;
    container?: string;
    onClose: () => void;
}

export function MoviePlayer({ movieId, title, poster, container, onClose }: MoviePlayerProps) {
    const resumeTime = progressService.getMovieResumeTime(movieId);
    useWatchSession('movie', title);

    return (
        <VideoPlayer
            src={api.getVodStreamUrl(Number(movieId), container || 'mp4')}
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
