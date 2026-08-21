// Teste de velocidade do provedor (item 67).
//
// Mede o que importa de verdade: o download do PRÓPRIO servidor de vídeo do
// provedor, não a banda geral da casa. Um provedor lotado entrega 2 Mbps numa
// casa com 300 Mbps de internet — e é isso que faz o canal engasgar.
//
// A URL de um canal é um MANIFESTO HLS (.m3u8) de ~1 KB, não vídeo. Baixar o
// manifesto mediria nada: é preciso segui-lo até um SEGMENTO real (.ts/.m4s) e
// medir esse download.

import { api } from './api';

const MAX_MS = 8000;
const MAX_BYTES = 6 * 1024 * 1024;
// O começo do download inclui DNS + TLS + conexão. Medir a partir do primeiro
// chunk isola a VELOCIDADE de transferência do tempo de estabelecer a conexão.
const WARMUP_BYTES = 64 * 1024;
const MIN_SECONDS = 0.25;
const MANIFEST_TIMEOUT_MS = 6000;
// Um master playlist aponta pra outro playlist; mais de um salto é raro
const MAX_MANIFEST_HOPS = 2;

export interface SpeedResult {
    mbps: number | null;
    bytes: number;
    seconds: number;
    error?: string;
}

/** Primeira URI não-comentada de um manifesto, resolvida contra a URL dele. */
function firstUri(manifest: string, baseUrl: string): string | null {
    for (const rawLine of manifest.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        try {
            return new URL(line, baseUrl).toString();
        } catch {
            return null;
        }
    }
    return null;
}

/** Segue o .m3u8 até achar a URL de um segmento de mídia de verdade. */
async function resolveSegmentUrl(playlistUrl: string, signal: AbortSignal): Promise<string | null> {
    let url = playlistUrl;
    for (let hop = 0; hop < MAX_MANIFEST_HOPS; hop++) {
        const response = await fetch(url, { signal, cache: 'no-store' });
        if (!response.ok) return null;
        const text = await response.text();
        const next = firstUri(text, url);
        if (!next) return null;
        // Ainda é playlist? Desce mais um nível. Senão, é o segmento.
        if (!/\.m3u8(\?|$)/i.test(next)) return next;
        url = next;
    }
    return null;
}

export interface SpeedTestOptions {
    /** Permite ao chamador cancelar (fechar a tela solta a conexão) */
    signal?: AbortSignal;
}

/**
 * Baixa até 6 MB (ou 8s) de um segmento real e calcula os Mbps.
 * @param streamId canal a usar como cobaia — de preferência um que funcione
 */
export async function measureProviderSpeed(
    streamId: number,
    options: SpeedTestOptions = {}
): Promise<SpeedResult> {
    if (!api.isAuthenticated()) {
        return { mbps: null, bytes: 0, seconds: 0, error: 'Faça login antes de testar.' };
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller);
    // O timeout do MANIFESTO é curto; o do DOWNLOAD é o tempo total da amostra
    const deadline = setTimeout(() => controller.abort(), MAX_MS + MANIFEST_TIMEOUT_MS);

    // Fora do try: o catch precisa reportar a amostra parcial. Abortar por
    // tempo é o caso NORMAL numa conexão lenta — descartar o que já foi medido
    // fazia toda conexão abaixo de ~6 Mbps reportar "falhou".
    let total = 0;
    let measured = 0;
    let startedAt = 0;

    const finish = (): SpeedResult => {
        const seconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;
        if (seconds < MIN_SECONDS || measured <= 0) {
            return {
                mbps: null,
                bytes: total,
                seconds,
                error: 'Amostra curta demais pra medir. Tente de novo.',
            };
        }
        return { mbps: (measured * 8) / seconds / 1_000_000, bytes: total, seconds };
    };

    try {
        const segmentUrl = await resolveSegmentUrl(api.getLiveStreamUrl(streamId), controller.signal);
        if (!segmentUrl) {
            return { mbps: null, bytes: 0, seconds: 0, error: 'Não achei um segmento de vídeo pra medir.' };
        }

        const response = await fetch(segmentUrl, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
            return { mbps: null, bytes: 0, seconds: 0, error: `Provedor respondeu ${response.status}.` };
        }
        if (!response.body) {
            return { mbps: null, bytes: 0, seconds: 0, error: 'Streaming não suportado neste aparelho.' };
        }

        const reader = response.body.getReader();
        const sampleDeadline = setTimeout(() => controller.abort(), MAX_MS);
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done || !value) break;
                total += value.length;
                if (startedAt === 0 && total >= WARMUP_BYTES) {
                    startedAt = Date.now(); // só agora a conexão está quente
                } else if (startedAt !== 0) {
                    measured += value.length;
                }
                if (total >= MAX_BYTES) break;
            }
        } finally {
            clearTimeout(sampleDeadline);
            // Solta a conexão: o provedor conta conexões simultâneas da conta
            try {
                await reader.cancel();
            } catch {
                // já abortada
            }
        }

        return finish();
    } catch (error) {
        // Abortado com amostra útil na mão = medição válida, não falha
        if (measured > 0 && startedAt !== 0) return finish();
        const message = error instanceof Error ? error.message : 'Falhou';
        const aborted = message.toLowerCase().includes('abort');
        return {
            mbps: null,
            bytes: total,
            seconds: 0,
            error: aborted ? 'Tempo esgotado — provedor muito lento ou fora do ar.' : message,
        };
    } finally {
        clearTimeout(deadline);
        options.signal?.removeEventListener('abort', abortFromCaller);
        // Vale para TODOS os caminhos, inclusive os returns antecipados:
        // sem isto a conexão ficava pendurada até o app ser reiniciado
        controller.abort();
    }
}

/** Leitura humana do resultado. */
export function speedVerdict(mbps: number): string {
    if (mbps >= 25) return 'Folgado até pra 4K';
    if (mbps >= 12) return 'Bom pra Full HD';
    if (mbps >= 6) return 'Dá conta de HD';
    if (mbps >= 3) return 'Só SD com conforto';
    return 'Apertado — espere travadas';
}
