// Storage service for TV platforms (localStorage-based)

import type { Credentials } from '../types';

export interface SavedContentItem {
    id: string;
    type: 'movie' | 'series' | 'channel';
    title: string;
    poster?: string;
    rating?: string;
    year?: string;
    /** container_extension pra reproduzir filme direto da lista */
    container?: string;
    addedAt: number;
}

export type FavoriteItem = SavedContentItem;
export type WatchLaterItem = SavedContentItem;

export type SavedContentInput = Omit<SavedContentItem, 'addedAt'>;

const STORAGE_KEYS = {
    CREDENTIALS: 'neostream_credentials',
    FAVORITES: 'neostream_favorites',
    WATCH_LATER: 'neostream_watch_later',
    LAST_CHANNEL: 'neostream_last_channel',
    SETTINGS: 'neostream_settings',
    TMDB_API_KEY: 'neostream_tmdb_api_key',
};

interface Settings {
    language: 'pt' | 'en' | 'es';
    autoPlay: boolean;
    preferredQuality: 'auto' | '1080p' | '720p' | '480p';
}

const DEFAULT_SETTINGS: Settings = {
    language: 'pt',
    autoPlay: true,
    preferredQuality: 'auto',
};

class StorageService {
    // Credentials
    saveCredentials(credentials: Credentials): void {
        localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
    }

    getCredentials(): Credentials | null {
        const data = localStorage.getItem(STORAGE_KEYS.CREDENTIALS);
        return data ? JSON.parse(data) : null;
    }

    clearCredentials(): void {
        localStorage.removeItem(STORAGE_KEYS.CREDENTIALS);
    }

    // Sanitiza listas salvas por versões antigas do app (o modal antigo
    // gravava só {id,type} — sem título o card renderizava vazio)
    private readContentList(key: string): SavedContentItem[] {
        try {
            const raw = localStorage.getItem(key);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return (parsed as Array<Partial<SavedContentItem>>)
                .filter(item => item && item.id != null && item.type != null)
                .map(item => ({
                    ...item,
                    id: String(item.id),
                    type: item.type as SavedContentItem['type'],
                    title: item.title || 'Sem título',
                    addedAt: item.addedAt || 0,
                }));
        } catch {
            return [];
        }
    }

    // Favorites (item completo; id pode colidir entre filme/série, então
    // toda operação é chaveada por id+type)
    getFavorites(): FavoriteItem[] {
        return this.readContentList(STORAGE_KEYS.FAVORITES);
    }

    addFavorite(item: SavedContentInput): void {
        const favorites = this.getFavorites();
        if (!favorites.some(f => f.id === item.id && f.type === item.type)) {
            favorites.push({ ...item, addedAt: Date.now() });
            localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
        }
    }

    removeFavorite(id: string, type: SavedContentItem['type']): void {
        const favorites = this.getFavorites().filter(f => !(f.id === id && f.type === type));
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    }

    isFavorite(id: string, type: SavedContentItem['type']): boolean {
        return this.getFavorites().some(f => f.id === id && f.type === type);
    }

    toggleFavorite(item: SavedContentInput): boolean {
        if (this.isFavorite(item.id, item.type)) {
            this.removeFavorite(item.id, item.type);
            return false;
        }
        this.addFavorite(item);
        return true;
    }

    clearFavorites(): void {
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify([]));
    }

    // Watch Later (Minha Lista)
    getWatchLater(): WatchLaterItem[] {
        return this.readContentList(STORAGE_KEYS.WATCH_LATER);
    }

    addWatchLater(item: SavedContentInput): void {
        const items = this.getWatchLater();
        if (!items.some(i => i.id === item.id && i.type === item.type)) {
            items.push({ ...item, addedAt: Date.now() });
            localStorage.setItem(STORAGE_KEYS.WATCH_LATER, JSON.stringify(items));
        }
    }

    removeWatchLater(id: string, type: SavedContentItem['type']): void {
        const items = this.getWatchLater().filter(i => !(i.id === id && i.type === type));
        localStorage.setItem(STORAGE_KEYS.WATCH_LATER, JSON.stringify(items));
    }

    isInWatchLater(id: string, type: SavedContentItem['type']): boolean {
        return this.getWatchLater().some(i => i.id === id && i.type === type);
    }

    toggleWatchLater(item: SavedContentInput): boolean {
        if (this.isInWatchLater(item.id, item.type)) {
            this.removeWatchLater(item.id, item.type);
            return false;
        }
        this.addWatchLater(item);
        return true;
    }

    clearWatchLater(): void {
        localStorage.setItem(STORAGE_KEYS.WATCH_LATER, JSON.stringify([]));
    }

    // Last channel
    setLastChannel(streamId: number): void {
        localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, String(streamId));
    }

    getLastChannel(): number | null {
        const data = localStorage.getItem(STORAGE_KEYS.LAST_CHANNEL);
        return data ? parseInt(data, 10) : null;
    }

    // Settings
    hasSettings(): boolean {
        return localStorage.getItem(STORAGE_KEYS.SETTINGS) !== null;
    }

    getSettings(): Settings {
        const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
    }

    saveSettings(settings: Partial<Settings>): void {
        const current = this.getSettings();
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...current, ...settings }));
    }

    // TMDB API key (user-provided and stored locally only)
    getTmdbApiKey(): string {
        return localStorage.getItem(STORAGE_KEYS.TMDB_API_KEY) || '';
    }

    saveTmdbApiKey(apiKey: string): void {
        const trimmed = apiKey.trim();
        if (trimmed) {
            localStorage.setItem(STORAGE_KEYS.TMDB_API_KEY, trimmed);
        } else {
            this.clearTmdbApiKey();
        }
    }

    clearTmdbApiKey(): void {
        localStorage.removeItem(STORAGE_KEYS.TMDB_API_KEY);
    }

    // Clear all data
    clearAll(): void {
        Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    }
}

export const storage = new StorageService();
