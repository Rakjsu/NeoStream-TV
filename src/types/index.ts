// Types ported from NeoStream IPTV

export interface LiveStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

export interface VODStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string; // Actual poster image from API
  container_extension: string;
  custom_sid: string;
  direct_source: string;
  added: string;
  category_id: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  cover: string; // May be empty in listing, use stream_icon instead
  cover_big?: string; // Available in get_vod_info
  movie_image?: string; // Available in get_vod_info
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  tmdb_id: string;
}

export interface Series {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  category_id: string;
  tmdb_id: string;
}

export interface SeriesInfo {
  seasons: Record<string, Episode[]>;
  info: Series;
  episodes: Record<string, Episode[]>;
}

export interface Episode {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info: {
    duration_secs: number;
    duration: string;
    plot: string;
    releasedate: string;
    /**
     * Campos que os painéis Xtream mandam por episódio e que ninguém declarava
     * (item 36). São OPCIONAIS de propósito: metade dos painéis não os envia,
     * e assumir que existem faria a ficha renderizar buraco.
     */
    movie_image?: string;
    cover_big?: string;
    rating?: string | number;
  };
  custom_sid: string;
  added: string;
  season: number;
  direct_source: string;
}

export interface Category {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface UserInfo {
  username: string;
  password: string;
  message: string;
  auth: number;
  status: string;
  exp_date: string;
  is_trial: string;
  active_cons: string;
  created_at: string;
  max_connections: string;
  allowed_output_formats: string[];
}

export interface ServerInfo {
  url: string;
  port: string;
  https_port: string;
  server_protocol: string;
  rtmp_port: string;
  timezone: string;
  timestamp_now: number;
  time_now: string;
}

export interface AuthResponse {
  user_info: UserInfo;
  server_info: ServerInfo;
}

export interface Credentials {
  url: string;
  username: string;
  password: string;
}
