// Reset seletivo e inventário de dados (itens 61, 62, 63).
//
// As chaves são casadas por PREDICADO sobre tudo que existe no localStorage,
// nunca por uma lista fixa: o app tem chaves com sufixo de perfil (`__p_<id>`)
// e com prefixo dinâmico (ordenação por aba, offset de EPG por playlist).
// Uma lista fixa deixaria lixo para trás na primeira chave nova.

import {
    KEYS_CONTA,
    KEYS_PROGRESSO,
    KEYS_LISTAS,
    KEYS_PREFERENCIAS,
    KEYS_CACHE,
    PREFIXOS_CACHE,
    PREFIXOS_PREFERENCIAS,
    SUFIXO_PERFIL,
} from './storageKeys';
import { tt } from '../i18n';

export type DataGroup = 'progresso' | 'listas' | 'caches' | 'preferencias' | 'conta';

interface GroupDef {
    label: string;
    description: string;
    /** Bases (sem o sufixo de perfil) e prefixos que pertencem ao grupo */
    bases: string[];
    prefixes: string[];
}

export const DATA_GROUPS: Record<DataGroup, GroupDef> = {
    progresso: {
        get label() { return tt('reset_progresso_label'); },
        get description() { return tt('reset_progresso_desc'); },
        bases: [...KEYS_PROGRESSO],
        prefixes: [],
    },
    listas: {
        get label() { return tt('reset_listas_label'); },
        get description() { return tt('reset_listas_desc'); },
        bases: [...KEYS_LISTAS],
        prefixes: [],
    },
    caches: {
        get label() { return tt('reset_caches_label'); },
        get description() { return tt('reset_caches_desc'); },
        bases: [...KEYS_CACHE],
        prefixes: [...PREFIXOS_CACHE],
    },
    preferencias: {
        get label() { return tt('reset_prefs_label'); },
        get description() { return tt('reset_prefs_desc'); },
        bases: [...KEYS_PREFERENCIAS],
        prefixes: [...PREFIXOS_PREFERENCIAS],
    },
    conta: {
        get label() { return tt('reset_conta_label'); },
        get description() { return tt('reset_conta_desc'); },
        bases: [...KEYS_CONTA],
        prefixes: [],
    },
};

export const DATA_GROUP_IDS = Object.keys(DATA_GROUPS) as DataGroup[];

function allKeys(): string[] {
    const keys: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) keys.push(key);
        }
    } catch {
        return [];
    }
    return keys;
}

/** A chave pertence ao grupo? Aceita o sufixo de perfil `__p_<id>`. */
function belongsTo(key: string, group: GroupDef): boolean {
    const base = key.split(SUFIXO_PERFIL)[0];
    return group.bases.includes(base) || group.prefixes.some(prefix => base.startsWith(prefix));
}

export function keysOfGroup(group: DataGroup): string[] {
    const def = DATA_GROUPS[group];
    return allKeys().filter(key => belongsTo(key, def));
}

export interface ResetResult {
    removed: number;
    bytes: number;
}

export function resetGroup(group: DataGroup): ResetResult {
    const keys = keysOfGroup(group);
    let bytes = 0;
    for (const key of keys) {
        try {
            bytes += (localStorage.getItem(key)?.length || 0) * 2;
            localStorage.removeItem(key);
        } catch {
            // segue removendo as outras
        }
    }
    return { removed: keys.length, bytes };
}

/** Quanto cada grupo ocupa hoje (KB) — mostrado ao lado de cada opção. */
export function groupSizeKb(group: DataGroup): number {
    const total = keysOfGroup(group).reduce(
        (sum, key) => sum + (localStorage.getItem(key)?.length || 0) * 2,
        0
    );
    return Math.round(total / 1024);
}
