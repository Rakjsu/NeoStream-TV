// Estatísticas de uso (port lite do usageStatsService do desktop):
// sessões agregadas por dia e por conteúdo em localStorage.
// Registrado pelos players via hook useWatchSession.

const KEY = 'neostream_usage_stats';
const MAX_DAYS = 60;
const MAX_TOP = 100;
const MIN_SESSION_SECONDS = 15;

export type UsageKind = 'live' | 'movie' | 'series';

interface UsageData {
    days: Record<string, Partial<Record<UsageKind, number>>>;
    top: Record<string, number>; // "kind|name" → segundos
}

function read(): UsageData {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { days: parsed.days || {}, top: parsed.top || {} };
    } catch {
        return { days: {}, top: {} };
    }
}

function write(data: UsageData): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        // Quota cheia — melhor perder estatística do que quebrar o app
    }
}

/** Data local YYYY-MM-DD (toISOString mudaria o dia em UTC±X). */
function localDay(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prune(data: UsageData): void {
    const dayKeys = Object.keys(data.days).sort();
    while (dayKeys.length > MAX_DAYS) {
        delete data.days[dayKeys.shift() as string];
    }
    const topEntries = Object.entries(data.top);
    if (topEntries.length > MAX_TOP) {
        topEntries.sort((a, b) => b[1] - a[1]);
        data.top = Object.fromEntries(topEntries.slice(0, MAX_TOP));
    }
}

export interface UsageSummary {
    totalSeconds: number;
    byKind: Record<UsageKind, number>;
    topItems: Array<{ kind: UsageKind; name: string; seconds: number }>;
    last7Seconds: number;
}

export const usageStats = {
    record(kind: UsageKind, name: string, seconds: number): void {
        if (seconds < MIN_SESSION_SECONDS) return;
        const data = read();
        const day = localDay(Date.now());
        const dayBucket = data.days[day] || (data.days[day] = {});
        dayBucket[kind] = (dayBucket[kind] || 0) + Math.round(seconds);
        const topKey = `${kind}|${name}`;
        data.top[topKey] = (data.top[topKey] || 0) + Math.round(seconds);
        prune(data);
        write(data);
    },

    summary(): UsageSummary {
        const data = read();
        const byKind: Record<UsageKind, number> = { live: 0, movie: 0, series: 0 };
        let totalSeconds = 0;
        let last7Seconds = 0;
        const cutoff = localDay(Date.now() - 6 * 24 * 60 * 60 * 1000);
        for (const [day, buckets] of Object.entries(data.days)) {
            for (const kind of ['live', 'movie', 'series'] as UsageKind[]) {
                const seconds = buckets[kind] || 0;
                byKind[kind] += seconds;
                totalSeconds += seconds;
                if (day >= cutoff) last7Seconds += seconds;
            }
        }
        const topItems = Object.entries(data.top)
            .map(([key, seconds]) => {
                const sep = key.indexOf('|');
                return { kind: key.slice(0, sep) as UsageKind, name: key.slice(sep + 1), seconds };
            })
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, 5);
        return { totalSeconds, byKind, topItems, last7Seconds };
    },

    clear(): void {
        try {
            localStorage.removeItem(KEY);
        } catch {
            // sem drama
        }
    },
};
