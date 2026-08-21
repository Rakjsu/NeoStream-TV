// Dados da conta do provedor (itens 56 e 68).
//
// O app já recebia o payload completo do player_api.php em toda autenticação
// e jogava tudo fora: os dois call sites chamavam `await api.authenticate(...)`
// sem usar o retorno. Aqui ele é guardado para alimentar o painel "Minha
// conta" e o aviso de expiração, sem UMA requisição a mais.

import type { AuthResponse } from '../types';

const KEY = 'neostream_account_info';
const SNOOZE_KEY = 'neostream_expiry_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
/** A partir daqui a Home avisa que a lista está para vencer */
export const EXPIRY_WARN_DAYS = 7;

export interface AccountInfo {
    /** A conexão acabou em HTTP mesmo tendo sido pedida em HTTPS? */
    inseguro?: boolean;
    username: string;
    status: string;
    /** epoch em ms; null = sem data (conta vitalícia ou painel que não informa) */
    expiresAt: number | null;
    isTrial: boolean;
    activeConnections: number | null;
    maxConnections: number | null;
    createdAt: number | null;
    timezone: string;
    serverUrl: string;
    fetchedAt: number;
}

/** Campos do Xtream vêm como string (às vezes null/vazio) — normaliza. */
function toEpochMs(value: unknown): number | null {
    if (value == null || value === '') return null;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds * 1000;
}

function toInt(value: unknown): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export const accountService = {
    save(auth: AuthResponse | null | undefined, inseguro = false): void {
        const user = auth?.user_info;
        if (!user) return;
        const info: AccountInfo = {
            username: String(user.username || ''),
            status: String(user.status || ''),
            expiresAt: toEpochMs(user.exp_date),
            isTrial: String(user.is_trial) === '1',
            activeConnections: toInt(user.active_cons),
            maxConnections: toInt(user.max_connections),
            createdAt: toEpochMs(user.created_at),
            timezone: String(auth?.server_info?.timezone || ''),
            serverUrl: String(auth?.server_info?.url || ''),
            inseguro,
            fetchedAt: Date.now(),
        };
        try {
            localStorage.setItem(KEY, JSON.stringify(info));
        } catch {
            // quota — o painel só fica sem dado, nada quebra
        }
    },

    get(): AccountInfo | null {
        try {
            const raw = localStorage.getItem(KEY);
            return raw ? (JSON.parse(raw) as AccountInfo) : null;
        } catch {
            return null;
        }
    },

    clear(): void {
        try {
            localStorage.removeItem(KEY);
            localStorage.removeItem(SNOOZE_KEY);
        } catch {
            // sem drama
        }
    },

    /** Dias inteiros até vencer; null se não há data. Negativo = vencida. */
    daysUntilExpiry(info?: AccountInfo | null): number | null {
        const target = info === undefined ? accountService.get() : info;
        if (!target?.expiresAt) return null;
        return Math.floor((target.expiresAt - Date.now()) / 86400000);
    },

    /** Deve mostrar o aviso na Home agora? (respeita o "lembrar depois") */
    shouldWarnExpiry(): boolean {
        const info = accountService.get();
        const days = accountService.daysUntilExpiry(info);
        if (days === null || days > EXPIRY_WARN_DAYS) return false;
        try {
            const raw = localStorage.getItem(SNOOZE_KEY);
            if (raw) {
                const snooze = JSON.parse(raw) as { until?: number; forExpiresAt?: number };
                // O adiamento vale pra AQUELA conta: trocar de playlist (ou
                // renovar) muda a validade e o aviso da nova conta tem que
                // aparecer, mesmo dentro das 24h do adiamento anterior
                const sameAccount = snooze.forExpiresAt === info?.expiresAt;
                if (sameAccount && Number(snooze.until) > Date.now()) return false;
            }
        } catch {
            // sem snooze legível → avisa
        }
        return true;
    },

    /** "Lembrar depois": some por 24h, só para esta conta. */
    snoozeExpiry(): void {
        try {
            const info = accountService.get();
            localStorage.setItem(SNOOZE_KEY, JSON.stringify({
                until: Date.now() + SNOOZE_MS,
                forExpiresAt: info?.expiresAt ?? null,
            }));
        } catch {
            // se não der pra gravar, o aviso volta no próximo boot
        }
    },
};
