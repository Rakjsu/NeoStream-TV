// Mede o tempo de uma sessão de reprodução (montagem → desmontagem ou troca
// de conteúdo) e registra no usageStats. Tempo de parede — lite de propósito.

import { useEffect } from 'react';
import { usageStats, type UsageKind } from '../services/usageStats';

export function useWatchSession(kind: UsageKind, name: string): void {
    useEffect(() => {
        if (!name) return;
        const startedAt = Date.now();
        return () => {
            usageStats.record(kind, name, (Date.now() - startedAt) / 1000);
        };
    }, [kind, name]);
}
