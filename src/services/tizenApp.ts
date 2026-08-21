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

interface TizenGlobal {
    application?: {
        getCurrentApplication?: () => TizenApplication;
    };
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
