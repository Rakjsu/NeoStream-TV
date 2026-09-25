// Confirmação em dois toques, para ações destrutivas sem volta.
//
// O `useExitPrompt` já fazia exatamente isto para a saída do app, com um
// argumento que vale igual aqui: numa TV, a ação é disparada por um controle
// remoto, e apertar OK por engano é comum demais para uma ação sem volta.
//
// Este hook é a mesma ideia sem o `exitApp` amarrado dentro, para o Sair da
// conta (que apaga credenciais e TODAS as playlists) poder usá-la. O
// `useExitPrompt` continua como está de propósito: ele está no caminho da
// certificação Samsung, e reescrevê-lo em cima deste hook seria risco sem
// ganho neste PR.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Quanto tempo o "aperte de novo" continua valendo. */
export const JANELA_CONFIRMACAO_MS = 4000;

export function useConfirmacaoDupla(aoConfirmar: () => void, janelaMs: number = JANELA_CONFIRMACAO_MS) {
    const [armado, setArmado] = useState(false);
    const timerRef = useRef<number | null>(null);

    const desarmar = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setArmado(false);
    }, []);

    /** 1º toque arma; 2º toque dentro da janela executa. */
    const pedir = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            setArmado(false);
            aoConfirmar();
            return;
        }
        setArmado(true);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setArmado(false);
        }, janelaMs);
    }, [aoConfirmar, janelaMs]);

    // Desmontar com o timer vivo deixaria um setState num componente morto.
    useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
    }, []);

    return { armado, pedir, desarmar };
}
