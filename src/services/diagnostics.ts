// Tela de diagnóstico (item 59): o que dá pra saber sobre a TV e a conexão
// sem sair do web app. Numa TV não há console aberto — quando algo falha às
// 22h de domingo, esta tela é a única testemunha.

import { api } from './api';
import { storage } from './storage';

const MAX_ERRORS = 20;

export interface LoggedError {
    at: number;
    message: string;
    source?: string;
}

const errorLog: LoggedError[] = [];
let installed = false;

/** Captura erros globais num anel de memória (não persiste: dado sensível). */
export function installErrorCapture(): void {
    if (installed) return;
    installed = true;

    const push = (message: string, source?: string) => {
        errorLog.unshift({ at: Date.now(), message: message.slice(0, 300), source });
        if (errorLog.length > MAX_ERRORS) errorLog.length = MAX_ERRORS;
    };

    window.addEventListener('error', (event) => {
        const filename = event.filename ? `${event.filename}:${event.lineno}` : undefined;
        push(event.message || 'Erro desconhecido', filename);
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        push(message, 'promise');
    });
}

export function getErrorLog(): LoggedError[] {
    return [...errorLog];
}

export function clearErrorLog(): void {
    errorLog.length = 0;
}

export interface DeviceReport {
    version: string;
    target: string;
    userAgent: string;
    screen: string;
    /** GB aproximados que o navegador admite ter (Chromium) */
    deviceMemoryGb: number | null;
    /** Heap JS em MB (só Chromium expõe) */
    heapUsedMb: number | null;
    heapLimitMb: number | null;
    online: boolean;
    /** Mbps estimados pelo próprio navegador, quando disponível */
    downlinkMbps: number | null;
    storageUsedKb: number | null;
}

interface ChromiumNavigator extends Navigator {
    deviceMemory?: number;
    connection?: { downlink?: number };
}

interface ChromiumPerformance extends Performance {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
}

function localStorageUsedKb(): number | null {
    try {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            total += key.length + (localStorage.getItem(key)?.length || 0);
        }
        // UTF-16: 2 bytes por unidade de código
        return Math.round((total * 2) / 1024);
    } catch {
        return null;
    }
}

export function deviceReport(): DeviceReport {
    const nav = navigator as ChromiumNavigator;
    const perf = performance as ChromiumPerformance;
    return {
        version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?',
        target: typeof __BUILD_TARGET__ === 'string' ? __BUILD_TARGET__ : '?',
        userAgent: navigator.userAgent,
        screen: `${window.screen.width}×${window.screen.height}`,
        deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        heapUsedMb: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null,
        heapLimitMb: perf.memory ? Math.round(perf.memory.jsHeapSizeLimit / 1048576) : null,
        online: navigator.onLine,
        downlinkMbps: typeof nav.connection?.downlink === 'number' ? nav.connection.downlink : null,
        storageUsedKb: localStorageUsedKb(),
    };
}

export interface LatencyResult {
    ms: number | null;
    error?: string;
}

/** Ida e volta até o painel do provedor (não até o CDN de vídeo). */
export async function measureProviderLatency(): Promise<LatencyResult> {
    const credentials = storage.getCredentials();
    if (!credentials) return { ms: null, error: 'Sem credenciais salvas.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const started = Date.now();
    try {
        // player_api.php sem action devolve só o bloco de autenticação:
        // é a menor resposta útil do painel
        const response = await fetch(api.getAuthPingUrl(), { signal: controller.signal, cache: 'no-store' });
        const ms = Date.now() - started;
        // Um 502 do painel responde rapidíssimo: sem checar o status, o
        // diagnóstico mostrava "23 ms" para um provedor fora do ar
        if (!response.ok) {
            return { ms: null, error: `Provedor respondeu ${response.status}.` };
        }
        // Corpo não lido segura a conexão até o GC; drenar é barato aqui
        await response.text().catch(() => '');
        return { ms };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Falhou';
        return { ms: null, error: message === 'The user aborted a request.' ? 'Tempo esgotado (10s).' : message };
    } finally {
        clearTimeout(timeout);
    }
}
