import { useEffect, type ReactNode } from 'react';

declare global {
    interface Window {
        /** Definido pelo tizen/index.html; não existe no build web. */
        __NEOSTREAM_PRONTO__?: () => void;
    }
}

/**
 * Avisa a tela de boot do .wgt que o app subiu.
 *
 * O sinal precisa vir de quem SABE que renderizou. O `tizen/index.html` só
 * podia chutar um prazo (eram 300 ms, uma tentativa só) e, se o primeiro
 * commit do React demorasse mais — CPU de TV de 2015, heap sob pressão depois
 * de 1 MB de bundle —, o overlay ficava por cima do app para sempre: ele não
 * tem zona de foco nem tratador de tecla, o D-pad não faz nada e só matar o
 * app resolve.
 *
 * Fica num efeito porque `createRoot(...).render(...)` não aceita callback no
 * React 18+: o efeito roda depois do commit, que é exatamente o instante em
 * que existe conteúdo na tela. O `index.html` mantém um laço de conferência
 * como rede, para o caso de um bundle antigo (sem este aviso) ser empacotado.
 */
export function AvisaQueSubiu({ children }: { children: ReactNode }) {
    useEffect(() => {
        window.__NEOSTREAM_PRONTO__?.();
    }, []);
    return <>{children}</>;
}
