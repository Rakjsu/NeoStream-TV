// Backup das preferências por QR Code (item 63).
//
// A TV desenha o QR, o celular fotografa e guarda o JSON. É o caminho menos
// doloroso que existe numa TV: sem digitar nada no D-pad, sem nuvem, sem conta.
//
// O que NUNCA entra no QR: usuário, senha, URL do provedor e chave do TMDB.
// Um QR na tela da sala é lido por qualquer câmera do cômodo — e um código
// impresso numa foto de rede social entrega a conta inteira. Backup aqui é de
// AJUSTES; a conta se recupera fazendo login de novo.

import { keysOfGroup } from './dataReset';

const PREFIX = 'neostream_';
export const BACKUP_FORMAT = 'neostream-tv-prefs-1';
// Um QR versão 40 com correção L guarda ~2953 bytes. Acima disso o código
// fica denso demais pra câmera de celular ler da distância de uma sala.
export const MAX_PAYLOAD_BYTES = 2200;

export interface BackupPayload {
    /** formato */
    f: string;
    /** quando */
    t: number;
    /** dados, com o prefixo neostream_ removido pra caber no QR */
    d: Record<string, string>;
}

/** Monta o JSON do backup (só preferências). */
export function buildBackup(): string {
    const data: Record<string, string> = {};
    for (const key of keysOfGroup('preferencias')) {
        const value = localStorage.getItem(key);
        if (value === null) continue;
        data[key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key] = value;
    }
    const payload: BackupPayload = { f: BACKUP_FORMAT, t: Date.now(), d: data };
    return JSON.stringify(payload);
}

export interface BackupSize {
    json: string;
    bytes: number;
    fits: boolean;
}

export function backupSize(): BackupSize {
    const json = buildBackup();
    // O QR conta BYTES em UTF-8, não caracteres: acento ocupa 2
    const bytes = new TextEncoder().encode(json).length;
    return { json, bytes, fits: bytes <= MAX_PAYLOAD_BYTES };
}

export interface RestoreResult {
    ok: boolean;
    applied: number;
    error?: string;
}

/** Aplica um backup colado de volta (usado se houver caminho de importação). */
export function restoreBackup(json: string): RestoreResult {
    let payload: BackupPayload;
    try {
        payload = JSON.parse(json) as BackupPayload;
    } catch {
        return { ok: false, applied: 0, error: 'Não é um backup válido.' };
    }
    if (payload?.f !== BACKUP_FORMAT || !payload.d || typeof payload.d !== 'object') {
        return { ok: false, applied: 0, error: 'Formato desconhecido.' };
    }
    let applied = 0;
    for (const [shortKey, value] of Object.entries(payload.d)) {
        if (typeof value !== 'string') continue;
        // Chaves sem o prefixo do app (includeTV/includeVOD) voltam como estão
        const key = shortKey === 'includeTV' || shortKey === 'includeVOD' ? shortKey : PREFIX + shortKey;
        try {
            localStorage.setItem(key, value);
            applied++;
        } catch {
            // segue aplicando as outras
        }
    }
    return { ok: true, applied };
}
