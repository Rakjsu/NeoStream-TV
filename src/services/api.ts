// Xtream Codes API Client - Ported from NeoStream IPTV

import type { AuthResponse, LiveStream, VODStream, Series, Category, SeriesInfo, Credentials } from '../types';

type VodMovieData = Record<string, unknown>;

function trimTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function ensureProtocol(value: string): string {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('//')) return `http:${trimmed}`;
    return `http://${trimmed}`;
}

/**
 * Limpa a URL do servidor: tira `/player_api.php`, query string e barra final.
 * Exportada porque o Login precisa GUARDAR a versão limpa — colar o link m3u
 * inteiro (o que o provedor manda no WhatsApp) deixava usuário e senha
 * legíveis no campo Servidor pra sempre.
 */
export function normalizarUrlDoServidor(input: string): string {
    return normalizeServerUrl(input);
}

function normalizeServerUrl(input: string): string {
    const withoutSpaces = input.trim().replace(/\s+/g, '');
    if (!withoutSpaces) {
        throw new Error('Invalid URL');
    }

    let parsed: URL;
    try {
        parsed = new URL(ensureProtocol(withoutSpaces));
    } catch {
        throw new Error('Invalid URL');
    }

    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';

    const lowerPath = parsed.pathname.toLowerCase();
    if (lowerPath.endsWith('/player_api.php')) {
        parsed.pathname = parsed.pathname.slice(0, -'/player_api.php'.length) || '/';
    } else if (lowerPath.endsWith('/get.php')) {
        parsed.pathname = parsed.pathname.slice(0, -'/get.php'.length) || '/';
    } else if (lowerPath.endsWith('/xmltv.php')) {
        parsed.pathname = parsed.pathname.slice(0, -'/xmltv.php'.length) || '/';
    }

    return trimTrailingSlash(parsed.toString());
}

/**
 * Portas típicas de painel Xtream por protocolo. Trocar só o esquema mantendo
 * a porta quase nunca funciona: HTTP costuma ser 8080/8000 e TLS 443/8443.
 */
const PORTA_ALTERNATIVA: Record<string, Record<string, string>> = {
    'https:': { '8080': '8443', '80': '443', '8000': '8443' },
    'http:': { '8443': '8080', '443': '80' },
};

function getAlternateProtocolUrl(baseUrl: string): string | null {
    const parsed = new URL(baseUrl);
    const destino = parsed.protocol === 'http:' ? 'https:'
        : parsed.protocol === 'https:' ? 'http:'
            : null;
    if (!destino) return null;
    const portaAtual = parsed.port;
    parsed.protocol = destino;
    // O setter de protocol só limpa a porta quando ela é a padrão do novo
    // esquema; sem isto, https://painel:8080 continuava apontando pra 8080
    const nova = portaAtual ? PORTA_ALTERNATIVA[destino]?.[portaAtual] : undefined;
    if (nova) parsed.port = nova;
    return trimTrailingSlash(parsed.toString());
}

/**
 * O usuário digitou HTTPS e a conexão acabou em HTTP? Nesse caso a senha
 * trafega em texto claro na URL de toda requisição — e ele precisa saber.
 */
export function foiRebaixadoParaHttp(pedido: string, efetivo: string): boolean {
    try {
        return new URL(pedido).protocol === 'https:' && new URL(efetivo).protocol === 'http:';
    } catch {
        return false;
    }
}

function buildApiUrl(
    baseUrl: string,
    username: string,
    password: string,
    action?: string,
    params: Record<string, string> = {}
): URL {
    const apiUrl = new URL(`${trimTrailingSlash(baseUrl)}/player_api.php`);
    apiUrl.searchParams.set('username', username);
    apiUrl.searchParams.set('password', password);
    if (action) {
        apiUrl.searchParams.set('action', action);
    }
    for (const [key, value] of Object.entries(params)) {
        apiUrl.searchParams.set(key, value);
    }
    return apiUrl;
}

/**
 * Listagens de catálogo guardadas em MEMÓRIA por alguns minutos.
 *
 * O app troca de página por render condicional: sair de Filmes e voltar
 * remonta e refaz o fetch. Home busca canais+filmes+séries, Filmes busca de
 * novo, a busca global dispara mais seis em paralelo — tudo isso do mesmo
 * provedor, com a mesma resposta, em segundos. Numa TV isso é banda, memória e
 * uma conexão simultânea da conta a cada vez.
 *
 * Fica em memória de propósito: o catálogo PERSISTIDO (catalogCache) é outra
 * coisa, serve pro boot instantâneo e tem poda e teto próprios.
 */
const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogoMemoria = new Map<string, { at: number; data: unknown }>();
/** Requisições em voo: dois pedidos iguais ao mesmo tempo viram um só. */
const emVoo = new Map<string, Promise<unknown>>();

/** Descarta tudo (troca de provedor, logout). */
export function limparCacheDeCatalogo(): void {
    catalogoMemoria.clear();
    emVoo.clear();
}

class XtreamAPI {
    private baseUrl: string = '';
    private username: string = '';
    private password: string = '';
    /** Diferença (ms) entre o relógio local do provedor e o epoch — o
     *  timeshift do Xtream pede a hora no FUSO DO PROVEDOR. */
    private providerOffsetMs: number = 0;

    /**
     * Igual ao makeRequest, mas com cache em memória e deduplicação.
     * Só pras LISTAGENS de catálogo, que são grandes e mudam devagar.
     */
    private async listagem<T>(action: string, timeoutMs = 30000): Promise<T> {
        const chave = `${this.baseUrl}|${this.username}|${action}`;
        const guardado = catalogoMemoria.get(chave);
        if (guardado && Date.now() - guardado.at < CATALOG_TTL_MS) {
            return guardado.data as T;
        }
        const jaPedido = emVoo.get(chave);
        if (jaPedido) return jaPedido as Promise<T>;

        const pedido = this.makeRequest<T>(action, {}, timeoutMs)
            .then(data => {
                catalogoMemoria.set(chave, { at: Date.now(), data });
                return data;
            })
            .finally(() => emVoo.delete(chave));
        emVoo.set(chave, pedido as Promise<unknown>);
        return pedido;
    }

    private async makeRequest<T>(action: string, params: Record<string, string> = {}, timeoutMs = 30000): Promise<T> {
        const url = buildApiUrl(this.baseUrl, this.username, this.password, action, params);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Tempo esgotado. O servidor demorou muito para responder.');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async fetchAuth(baseUrl: string, username: string, password: string, signal: AbortSignal): Promise<AuthResponse> {
        const apiUrl = buildApiUrl(baseUrl, username, password);

        const response = await fetch(apiUrl.toString(), {
            signal,
            headers: {
                'Accept': 'application/json, text/plain, */*',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();

        if (!text || text.trim() === '') {
            throw new Error('Servidor retornou resposta vazia. Verifique a URL do servidor.');
        }

        if (text.trim().startsWith('<')) {
            throw new Error('Servidor retornou página de erro. Verifique a URL.');
        }

        let data: AuthResponse;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Resposta inválida do servidor (não é JSON)');
        }

        if (data.user_info && data.user_info.auth === 0) {
            throw new Error('Usuário ou senha incorretos');
        }

        if (!data.user_info) {
            throw new Error('Resposta inválida do servidor');
        }

        return data;
    }

    setCredentials(credentials: Credentials): void {
        this.baseUrl = normalizeServerUrl(credentials.url);
        this.username = credentials.username;
        this.password = credentials.password;
    }

    /**
     * Diferença entre a hora de parede do provedor e o UTC, aprendida no
     * login. Usada pra ler horários de EPG que vêm sem fuso.
     */
    getProviderOffsetMs(): number {
        return this.providerOffsetMs;
    }

    /** URL que a autenticação REALMENTE usou (pode diferir da digitada). */
    getBaseUrl(): string {
        return this.baseUrl;
    }

    getCredentials(): Credentials | null {
        if (!this.baseUrl || !this.username || !this.password) {
            return null;
        }
        return {
            url: this.baseUrl,
            username: this.username,
            password: this.password,
        };
    }

    async authenticate(url: string, username: string, password: string): Promise<AuthResponse> {
        const baseUrl = normalizeServerUrl(url);
        const alternateBaseUrl = getAlternateProtocolUrl(baseUrl);
        const candidateUrls = alternateBaseUrl ? [baseUrl, alternateBaseUrl] : [baseUrl];

        try {
            let lastError: unknown;

            for (const candidateUrl of candidateUrls) {
                // Um deadline POR tentativa: com um único cronômetro de 15s
                // para as duas, a primeira consumia tudo e a segunda nascia
                // abortada — o fallback nunca chegava a acontecer
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                try {
                    const data = await this.fetchAuth(candidateUrl, username, password, controller.signal);
                    clearTimeout(timeoutId);

                    this.baseUrl = candidateUrl;
                    this.username = username;
                    this.password = password;
                    this.learnProviderOffset(data);

                    return data;
                } catch (error: unknown) {
                    clearTimeout(timeoutId);
                    lastError = error;
                    const message = error instanceof Error ? error.message : '';
                    const name = error instanceof Error ? error.name : '';
                    const shouldTryNext =
                        name !== 'AbortError' &&
                        (message.includes('Failed to fetch') ||
                            message.includes('NetworkError') ||
                            message.includes('Load failed') ||
                            message.includes('ERR_CONNECTION') ||
                            message.includes('HTTP 0'));

                    if (!shouldTryNext) {
                        throw error;
                    }
                }
            }

            throw lastError;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '';
            const name = error instanceof Error ? error.name : '';

            if (name === 'AbortError') {
                throw new Error('Tempo esgotado. O servidor demorou muito para responder.');
            }

            if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
                throw new Error('Erro de conexão. Verifique sua internet e a URL do servidor.');
            }

            throw error;
        }
    }

    async getLiveStreams(): Promise<LiveStream[]> {
        return this.listagem<LiveStream[]>('get_live_streams');
    }

    async getVODStreams(): Promise<VODStream[]> {
        return this.listagem<VODStream[]>('get_vod_streams');
    }

    async getSeries(): Promise<Series[]> {
        return this.listagem<Series[]>('get_series');
    }

    async getSeriesInfo(seriesId: number): Promise<SeriesInfo> {
        return this.makeRequest<SeriesInfo>('get_series_info', { series_id: String(seriesId) });
    }

    async getVodInfo(vodId: number): Promise<{ info: VODStream; movie_data: VodMovieData }> {
        return this.makeRequest<{ info: VODStream; movie_data: VodMovieData }>('get_vod_info', { vod_id: String(vodId) });
    }

    async getLiveCategories(): Promise<Category[]> {
        return this.listagem<Category[]>('get_live_categories');
    }

    async getVodCategories(): Promise<Category[]> {
        return this.listagem<Category[]>('get_vod_categories');
    }

    async getSeriesCategories(): Promise<Category[]> {
        return this.listagem<Category[]>('get_series_categories');
    }

    /** EPG curto por canal (agora/a seguir). Campos title/description em base64. */
    async getShortEpg(streamId: number, limit = 6): Promise<{ epg_listings?: unknown[] }> {
        return this.makeRequest<{ epg_listings?: unknown[] }>(
            'get_short_epg',
            { stream_id: String(streamId), limit: String(limit) },
            10000
        );
    }

    /** EPG completo do canal (agenda do dia + has_archive por programa). */
    async getSimpleDataTable(streamId: number): Promise<{ epg_listings?: unknown[] }> {
        return this.makeRequest<{ epg_listings?: unknown[] }>(
            'get_simple_data_table',
            { stream_id: String(streamId) },
            15000
        );
    }

    getLiveStreamUrl(streamId: number): string {
        return `${this.baseUrl}/live/${this.username}/${this.password}/${streamId}.m3u8`;
    }

    /**
     * URL do painel sem action: devolve só o bloco de autenticação. É a menor
     * resposta útil do provedor — serve pra medir latência (item 59).
     */
    getAuthPingUrl(): string {
        return buildApiUrl(this.baseUrl, this.username, this.password).toString();
    }

    /** Aprende o fuso do provedor pelo par time_now/timestamp_now do auth. */
    private learnProviderOffset(data: AuthResponse): void {
        // Reset primeiro: re-login em outro provedor não pode herdar o offset velho
        this.providerOffsetMs = 0;
        try {
            const epochMs = Number(data.server_info?.timestamp_now) * 1000;
            const wallRaw = data.server_info?.time_now; // "YYYY-MM-DD HH:MM:SS" local do servidor
            if (!epochMs || !wallRaw) return;
            // Interpreta a hora de parede como UTC pra medir só a diferença
            const wallAsUtc = Date.parse(wallRaw.replace(' ', 'T') + 'Z');
            if (Number.isNaN(wallAsUtc)) return;
            this.providerOffsetMs = wallAsUtc - epochMs;
        } catch {
            this.providerOffsetMs = 0;
        }
    }

    /**
     * URL de catch-up/timeshift (reiniciar programa). start em epoch ms;
     * o Xtream espera "YYYY-MM-DD:HH-MM" no fuso do provedor.
     */
    getTimeshiftUrl(streamId: number, startEpochMs: number, durationMin: number): string {
        const local = new Date(startEpochMs + this.providerOffsetMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        const start = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
            `:${pad(local.getUTCHours())}-${pad(local.getUTCMinutes())}`;
        return `${this.baseUrl}/timeshift/${this.username}/${this.password}/${durationMin}/${start}/${streamId}.m3u8`;
    }

    getVodStreamUrl(streamId: number, container: string = 'mp4'): string {
        return `${this.baseUrl}/movie/${this.username}/${this.password}/${streamId}.${container}`;
    }

    getSeriesStreamUrl(streamId: string | number, container: string = 'mp4'): string {
        return `${this.baseUrl}/series/${this.username}/${this.password}/${streamId}.${container}`;
    }

    isAuthenticated(): boolean {
        return !!(this.baseUrl && this.username && this.password);
    }

    logout(): void {
        this.baseUrl = '';
        this.username = '';
        this.password = '';
        this.providerOffsetMs = 0;
        // O catálogo em memória é da conta que acabou de sair
        limparCacheDeCatalogo();
    }
}

export const api = new XtreamAPI();
