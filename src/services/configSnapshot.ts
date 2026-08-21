// Ponto de restauração das configurações (item 62).
//
// Guarda um retrato periódico SÓ das preferências. Serve para o caso real da
// TV: alguém mexe em tudo (tema, filtros, ocultações), a tela fica estranha e
// não há como desfazer passo a passo com um controle remoto.

import { DATA_GROUPS, keysOfGroup } from './dataReset';

const KEY = 'neostream_config_snapshots';
const MAX_SNAPSHOTS = 3;
const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// Um retrato de preferências passa longe disso; o teto existe só pra impedir
// que o próprio backup entupa a quota de uma TV antiga.
const MAX_SNAPSHOT_BYTES = 128 * 1024;

export interface ConfigSnapshot {
    at: number;
    data: Record<string, string>;
}

function read(): ConfigSnapshot[] {
    try {
        const raw = localStorage.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as ConfigSnapshot[]) : [];
    } catch {
        return [];
    }
}

function write(list: ConfigSnapshot[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
        // Quota: um snapshot a menos é melhor que quebrar o app
        try {
            localStorage.setItem(KEY, JSON.stringify(list.slice(0, 1)));
        } catch {
            // desiste em silêncio
        }
    }
}

/** Retrato atual das preferências (nunca inclui credencial). */
function capture(): Record<string, string> {
    const data: Record<string, string> = {};
    for (const key of keysOfGroup('preferencias')) {
        const value = localStorage.getItem(key);
        if (value !== null) data[key] = value;
    }
    return data;
}

export const configSnapshot = {
    list(): ConfigSnapshot[] {
        return read();
    },

    /** Tira um retrato agora. Retorna false se nada foi salvo. */
    take(): boolean {
        const data = capture();
        if (Object.keys(data).length === 0) return false;
        const size = JSON.stringify(data).length * 2;
        if (size > MAX_SNAPSHOT_BYTES) return false;
        const list = [{ at: Date.now(), data }, ...read()].slice(0, MAX_SNAPSHOTS);
        write(list);
        return true;
    },

    /** Chamado no boot: tira um retrato se o último já tem uma semana. */
    maybeTake(): void {
        const list = read();
        if (list.length > 0 && Date.now() - list[0].at < INTERVAL_MS) return;
        this.take();
    },

    /**
     * Volta ao retrato escolhido. Preferência que NÃO existia no retrato é
     * apagada: restaurar tem que devolver o estado daquele dia, não mesclar
     * com o que veio depois.
     */
    restore(index: number): boolean {
        const snapshot = read()[index];
        if (!snapshot) return false;
        for (const key of keysOfGroup('preferencias')) {
            if (!(key in snapshot.data)) {
                try {
                    localStorage.removeItem(key);
                } catch {
                    // segue
                }
            }
        }
        for (const [key, value] of Object.entries(snapshot.data)) {
            try {
                localStorage.setItem(key, value);
            } catch {
                // segue
            }
        }
        return true;
    },

    clear(): void {
        try {
            localStorage.removeItem(KEY);
        } catch {
            // sem drama
        }
    },

    /** Rótulo do grupo restaurado — usado no texto da UI. */
    groupLabel(): string {
        return DATA_GROUPS.preferencias.label;
    },
};
