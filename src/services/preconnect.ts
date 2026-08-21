// Preconnect ao provedor (item 82).
//
// O primeiro pedido ao painel do provedor paga DNS + TCP + TLS antes de
// qualquer byte útil — numa TV com Wi-Fi fraco isso é meio segundo ou mais de
// tela parada no boot. Como as credenciais já estão no armazenamento antes de
// o React montar, dá pra abrir a conexão em paralelo com o download do bundle.

import { readJson } from './safeStorage';

interface StoredCredentials {
    url?: string;
}

function originOf(url: string): string | null {
    try {
        return new URL(url.includes('://') ? url : `http://${url}`).origin;
    } catch {
        return null;
    }
}

/** Chamar o MAIS CEDO possível — antes de montar o React. */
export function preconnectProvider(): void {
    try {
        const credentials = readJson<StoredCredentials | null>('neostream_credentials', null);
        const origin = credentials?.url ? originOf(credentials.url) : null;
        if (!origin) return;

        for (const rel of ['preconnect', 'dns-prefetch']) {
            const link = document.createElement('link');
            link.rel = rel;
            link.href = origin;
            // Sem crossOrigin: as chamadas ao player_api.php são same-origin
            // do ponto de vista de credenciais, e marcar cross-origin abriria
            // uma segunda conexão em vez de reaproveitar esta
            document.head.appendChild(link);
        }
    } catch {
        // Preconnect é otimização: falhar aqui não pode atrapalhar o boot
    }
}
