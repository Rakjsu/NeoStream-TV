// Multi-playlist (Fase 4b): várias credenciais Xtream em localStorage,
// com uma ativa espelhada em storage.credentials (compat com App/api).
// No desktop isso vive no main do Electron; aqui é CRUD web puro.

import { storage } from './storage';
import { normalizarUrlDoServidor } from './api';
import { scopedKey } from './profileScope';
import { removeKey } from './safeStorage';
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

/**
 * Apaga o que ficou amarrado a uma playlist: o catálogo em cache e o offset de
 * EPG levam o id dela no nome da chave. Sem isto, cada provedor testado e
 * removido deixava centenas de KB congelados numa quota de ~5 MB.
 */
function limparOrfaos(id: string): void {
    try {
        const orfas: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const nome = localStorage.key(i);
            if (nome && nome.endsWith(`_${id}`)) orfas.push(nome);
        }
        orfas.forEach(removeKey);
    } catch {
        // sem drama: é limpeza, não corretude
    }
}

export const playlistService = {
    /**
     * Apaga TODAS as playlists (usado no "Sair"). Sem isto, sair da conta
     * deixava usuário e senha legíveis em texto claro no aparelho, e bastava
     * abrir as Configurações pra reativar a conta do dono anterior.
     */
    clearAll(): void {
        try {
            // Limpa os órfãos de TODAS as entradas, inclusive a ativa: o
            // `remove()` recusa a ativa de propósito (não dá pra ficar sem
            // playlist em uso), e era justamente ela que deixava o catálogo em
            // cache — até 1,5 MB — preso no aparelho depois do logout.
            for (const entry of this.list()) limparOrfaos(entry.id);
            localStorage.removeItem(KEY);
        } catch {
            // segue: o clearCredentials do storage já foi feito
        }
    },

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
        // Compara pela URL NORMALIZADA dos dois lados: entradas antigas
        // guardaram o link m3u inteiro (com usuário e senha na query) e agora
        // gravamos a versão limpa — casar por igualdade exata criaria uma
        // segunda entrada do mesmo provedor a cada login.
        const alvo = normalizarUrlDoServidor(credentials.url);
        const existing = data.playlists.find(
            p => normalizarUrlDoServidor(p.url) === alvo && p.username === credentials.username
        );
        // Flags do Login (o app esconde TV/VOD por playlist)
        const includeTV = localStorage.getItem('includeTV') !== 'false';
        const includeVOD = localStorage.getItem('includeVOD') !== 'false';
        if (existing) {
            existing.url = alvo; // migra a entrada antiga pra URL limpa
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
            // Estado específico do provedor anterior (ids não valem no novo).
            // Tem que ser a chave ESCOPADA: com um perfil próprio ativo, o
            // dado real mora em `..__p_<id>` e apagar a base crua não fazia
            // nada — "ligar e assistir" abria um canal do provedor anterior.
            removeKey(scopedKey('neostream_last_channel'));
            removeKey(scopedKey('neostream_zap_history'));
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
        limparOrfaos(id);
        return true;
    },
};
