// Mede o tempo de uma sessão de reprodução (montagem → desmontagem ou troca
// de conteúdo) e registra no usageStats. Tempo de parede — lite de propósito.
//
// ⏱️ Grava a cada minuto, não só no fim. Numa TV, o jeito normal de parar de
// assistir é desligar no controle: o React não desmonta nada, o processo
// simplesmente morre. Gravando só na limpeza do efeito, a sessão inteira — as
// três horas de futebol — nunca chegava ao usageStats, e quem paga são a
// Retrospectiva, o ranking da Home e o painel das Configurações. É o mesmo
// raciocínio do progresso de reprodução, que o VideoPlayer já salva a cada 5 s.

import { useEffect } from 'react';
import { usageStats, type UsageKind } from '../services/usageStats';

/** De quanto em quanto tempo o acumulado vira estatística. */
const FLUSH_MS = 60_000;

export function useWatchSession(kind: UsageKind, name: string): void {
    useEffect(() => {
        if (!name) return;
        let marco = Date.now();
        // Depois do primeiro marco, o que vem é CONTINUAÇÃO: sem isto, o piso
        // de 15 s do `record` comeria o rabo de toda sessão (74 s → 60 s), e o
        // ranking passaria a mentir pra menos em silêncio.
        let jaGravou = false;
        const flush = () => {
            const agora = Date.now();
            const decorrido = (agora - marco) / 1000;
            marco = agora; // sem isto, cada marco recontaria tudo desde o início
            usageStats.record(kind, name, decorrido, jaGravou);
            if (decorrido >= 1) jaGravou = true;
        };
        // A TV manda o app pro segundo plano antes de suspender: é a última
        // chance de gravar sem perder o minuto corrente.
        const aoEsconder = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        const timer = window.setInterval(flush, FLUSH_MS);
        document.addEventListener('visibilitychange', aoEsconder);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', aoEsconder);
            flush();
        };
    }, [kind, name]);
}
