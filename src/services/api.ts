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

function getAlternateProtocolUrl(baseUrl: string): string | null {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
        return trimTrailingSlash(parsed.toString());
    }
    if (parsed.protocol === 'https:') {
        parsed.protocol = 'http:';
        return trimTrailingSlash(parsed.toString());
    }
    return null;
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

class XtreamAPI {
    private baseUrl: string = '';
    private username: string = '';
    private password: string = '';

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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            let lastError: unknown;

            for (const candidateUrl of candidateUrls) {
                try {
                    const data = await this.fetchAuth(candidateUrl, username, password, controller.signal);
                    clearTimeout(timeoutId);

                    this.baseUrl = candidateUrl;
                    this.username = username;
                    this.password = password;

                    return data;
                } catch (error: unknown) {
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
            clearTimeout(timeoutId);

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
        return this.makeRequest<LiveStream[]>('get_live_streams');
    }

    async getVODStreams(): Promise<VODStream[]> {
        return this.makeRequest<VODStream[]>('get_vod_streams');
    }

    async getSeries(): Promise<Series[]> {
        return this.makeRequest<Series[]>('get_series');
    }

    async getSeriesInfo(seriesId: number): Promise<SeriesInfo> {
        return this.makeRequest<SeriesInfo>('get_series_info', { series_id: String(seriesId) });
    }

    async getVodInfo(vodId: number): Promise<{ info: VODStream; movie_data: VodMovieData }> {
        return this.makeRequest<{ info: VODStream; movie_data: VodMovieData }>('get_vod_info', { vod_id: String(vodId) });
    }

    async getLiveCategories(): Promise<Category[]> {
        return this.makeRequest<Category[]>('get_live_categories');
    }

    async getVodCategories(): Promise<Category[]> {
        return this.makeRequest<Category[]>('get_vod_categories');
    }

    async getSeriesCategories(): Promise<Category[]> {
        return this.makeRequest<Category[]>('get_series_categories');
    }

    /** EPG curto por canal (agora/a seguir). Campos title/description em base64. */
    async getShortEpg(streamId: number, limit = 6): Promise<{ epg_listings?: unknown[] }> {
        return this.makeRequest<{ epg_listings?: unknown[] }>(
            'get_short_epg',
            { stream_id: String(streamId), limit: String(limit) },
            10000
        );
    }

    getLiveStreamUrl(streamId: number): string {
        return `${this.baseUrl}/live/${this.username}/${this.password}/${streamId}.m3u8`;
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
    }
}

export const api = new XtreamAPI();
