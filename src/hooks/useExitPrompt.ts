// A saída do app, em um lugar só.
//
// A certificação Samsung exige que Voltar na tela inicial feche o app. Fechar
// no PRIMEIRO toque seria péssimo — Voltar é a tecla mais apertada por engano
// de um controle de TV —, então são dois toques.
//
// O que faltava: o armamento nunca expirava. Quem apertasse Voltar uma vez na
// Home, fosse assistir 40 minutos de filme e voltasse, fechava o app no
// primeiro Voltar seguinte, sem aviso nenhum na tela.

import { useState, useRef, useCallback, useEffect } from 'react';
import { exitApp } from '../services/tizenApp';

/** Quanto tempo o "aperte de novo" continua valendo. */
const JANELA_MS = 4000;

export function useExitPrompt() {
    const [armado, setArmado] = useState(false);
    const timerRef = useRef<number | null>(null);

    const desarmar = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setArmado(false);
    }, []);

    /** Voltar foi apertado num lugar que significa "sair". */
    const pedirSaida = useCallback(() => {
        if (timerRef.current !== null) {
            // Segundo toque dentro da janela: é isso mesmo que ele quer
            clearTimeout(timerRef.current);
            timerRef.current = null;
            setArmado(false);
            exitApp();
            return;
        }
        setArmado(true);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setArmado(false);
        }, JANELA_MS);
    }, []);

    useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
    }, []);

    return { armado, pedirSaida, desarmar };
}
