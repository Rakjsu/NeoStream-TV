// Multi-playlist (Fase 4b): várias credenciais Xtream em localStorage,
// com uma ativa espelhada em storage.credentials (compat com App/api).
// No desktop isso vive no main do Electron; aqui é CRUD web puro.

import { storage } from './storage';
import type { Credentials } from '../types';

const KEY = 'neostream_playlists';

export interface PlaylistEntry extends Credentials {
    id: string;
    alias: string;
    addedAt: number;
    includeTV?: boolean;
    includeVOD?: boolean;
}

interface PlaylistsData {
    playlists: PlaylistEntry[];
    activeId: string | null;
}

function read(): PlaylistsData {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { playlists: parsed.playlists || [], activeId: parsed.activeId || null };
    } catch {
        return { playlists: [], activeId: null };
    }
}

function write(data: PlaylistsData): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        // Quota cheia — melhor manter só o espelho em storage.credentials
    }
}

function aliasFromUrl(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url.slice(0, 30) || 'Playlist';
    }
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export const playlistService = {
    /** Migra a credencial única antiga pra lista (idempotente). */
    migrate(): void {
        const data = read();
        if (data.playlists.length > 0) return;
        const credentials = storage.getCredentials();
        if (!credentials) return;
        const entry: PlaylistEntry = {
            id: generateId(),
            alias: aliasFromUrl(credentials.url),
            ...credentials,
            addedAt: Date.now(),
        };
        write({ playlists: [entry], activeId: entry.id });
    },

    list(): PlaylistEntry[] {
        return read().playlists;
    },

    getActiveId(): string | null {
        return read().activeId;
    },

    /** Registra (ou reaproveita) a playlist do login e a torna ativa. */
    registerFromLogin(credentials: Credentials): void {
        const data = read();
        const existing = data.playlists.find(
            p => p.url === credentials.url && p.username === credentials.username
        );
        // Flags do Login (o app esconde TV/VOD por playlist)
        const includeTV = localStorage.getItem('includeTV') !== 'false';
        const includeVOD = localStorage.getItem('includeVOD') !== 'false';
        if (existing) {
            existing.password = credentials.password;
            existing.includeTV = includeTV;
            existing.includeVOD = includeVOD;
            data.activeId = existing.id;
        } else {
            const entry: PlaylistEntry = {
                id: generateId(),
                alias: aliasFromUrl(credentials.url),
                ...credentials,
                addedAt: Date.now(),
                includeTV,
                includeVOD,
            };
            data.playlists.push(entry);
            data.activeId = entry.id;
        }
        write(data);
    },

    /** Ativa outra playlist e espelha na credencial única (o caller recarrega). */
    setActive(id: string): boolean {
        const data = read();
        const entry = data.playlists.find(p => p.id === id);
        if (!entry) return false;
        data.activeId = id;
        write(data);
        storage.saveCredentials({ url: entry.url, username: entry.username, password: entry.password });
        // Flags de TV/VOD acompanham a playlist
        try {
            localStorage.setItem('includeTV', String(entry.includeTV !== false));
            localStorage.setItem('includeVOD', String(entry.includeVOD !== false));
            // Estado específico do provedor anterior (ids não valem no novo)
            localStorage.removeItem('neostream_last_channel');
            localStorage.removeItem('neostream_zap_history');
        } catch {
            // quota — segue sem limpar
        }
        return true;
    },

    /** Remove uma playlist (a ativa não pode ser removida). */
    remove(id: string): boolean {
        const data = read();
        if (data.activeId === id) return false;
        const index = data.playlists.findIndex(p => p.id === id);
        if (index === -1) return false;
        data.playlists.splice(index, 1);
        write(data);
        return true;
    },
};
