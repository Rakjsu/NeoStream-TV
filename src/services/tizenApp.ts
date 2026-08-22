// Saída do aplicativo no Tizen.
//
// O config.xml declara `hwkey-event=enable`, ou seja, a tecla Voltar do
// controle é entregue ao web app — e o app precisa decidir o que fazer com
// ela. Como nenhuma tela chamava a saída, Voltar na tela inicial não fazia
// nada: o usuário tinha que descobrir a tecla Home/Exit do controle. Além do
// incômodo, isso reprova na certificação de app da Samsung.

interface TizenApplication {
    exit: () => void;
}

interface TizenAppControl {
    operation: string;
    uri?: string;
}

interface TizenGlobal {
    application?: {
        getCurrentApplication?: () => TizenApplication;
        launchAppControl?: (
            appControl: TizenAppControl,
            id: string | null,
            onSucesso?: () => void,
            onErro?: (erro: unknown) => void
        ) => void;
    };
    ApplicationControl?: new (operation: string, uri?: string) => TizenAppControl;
}

function tizenGlobal(): TizenGlobal | undefined {
    return (window as unknown as { tizen?: TizenGlobal }).tizen;
}

/** A TV consegue abrir uma URL num app externo? */
export function podeAbrirExterno(): boolean {
    const tizen = tizenGlobal();
    return typeof tizen?.application?.launchAppControl === 'function'
        && typeof tizen?.ApplicationControl === 'function';
}

/**
 * Abre uma URL fora do app (item 18: o trailer no YouTube).
 *
 * Por que NÃO um <iframe> na TV: o `.wgt` roda sem origem HTTP (`file://`), e
 * um iframe de outra origem que ganhe o foco engole o `keydown` do window —
 * onde o `useTVNavigation` escuta. Nem seta, nem OK, nem Voltar chegariam, e o
 * `tizenhwkey` só tira o foco de INPUT/TEXTAREA. O usuário ficaria preso no
 * trailer sem saída. Nada disso é verificável fora de uma TV de verdade, então
 * na TV o caminho é entregar a URL pro sistema e sair do caminho.
 *
 * Devolve false quando a TV não tem a API — aí o botão nem aparece.
 */
export function abrirExterno(url: string): boolean {
    try {
        const tizen = tizenGlobal();
        if (!podeAbrirExterno() || !tizen?.ApplicationControl) return false;
        const controle = new tizen.ApplicationControl(
            'http://tizen.org/appcontrol/operation/view',
            url
        );
        tizen.application?.launchAppControl?.(controle, null, undefined, () => {
            console.warn('[tizen] nenhum app aceitou abrir', url);
        });
        return true;
    } catch {
        return false;
    }
}

/** Fecha o app na TV. Fora do Tizen (navegador) não faz nada. */
export function exitApp(): boolean {
    try {
        const tizen = (window as unknown as { tizen?: TizenGlobal }).tizen;
        const app = tizen?.application?.getCurrentApplication?.();
        if (!app) return false;
        app.exit();
        return true;
    } catch {
        // Modelo sem a API ou sem privilégio: melhor não fazer nada do que cair
        return false;
    }
}
