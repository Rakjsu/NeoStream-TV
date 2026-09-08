// Error boundary global (R1 item 73): erro de render não pode virar tela
// preta numa TV — mostra recuperação amigável e OK reinicia o app.
//
// Voltar TAMBÉM fecha o app: se o erro for determinístico (um catálogo que
// derruba a mesma tela toda vez), OK sozinho recarrega direto pro mesmo
// crash — e a única saída seria a tecla Home do controle, que nem todo
// aparelho tem à mão. Aqui o usuário escolhe: tentar de novo ou sair.

import { Component, type ReactNode } from 'react';
import { exitApp, podeSair } from '../services/tizenApp';

interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    hasError: boolean;
    message: string;
}

// Nomes e códigos ficam em conjuntos SEPARADOS, e a razão é uma tecla só: o
// dígito 8 do controle. O `event.key` dele é literalmente '8', e a lista de
// Voltar precisa do '8' pelo keyCode do Backspace. Com os dois no mesmo balde
// e a resolução `event.key || String(event.keyCode)`, digitar 8 caía no Voltar
// — que AQUI encerra o aplicativo, tirando do usuário a chance de apertar OK e
// se recuperar de um erro passageiro.
//
// Continua duplicado do `useTVNavigation` de propósito: o boundary tem que
// funcionar mesmo quando o módulo que quebrou foi justamente aquele.
const ENTER_NOMES = new Set(['Enter', 'Select', ' ']);
const ENTER_CODIGOS = new Set(['13', '29443', '32']);
const BACK_NOMES = new Set(['Backspace', 'XF86Back', 'Escape']);
const BACK_CODIGOS = new Set(['10009', '8', '461', '27']);

/**
 * Casa a tecla contra as DUAS fontes, cada uma com a sua lista.
 *
 * Na TV de verdade o `event.key` costuma vir 'Unidentified' e quem identifica é
 * o `keyCode`; no navegador é o contrário. Consultar as duas — cada uma só
 * contra os valores do seu tipo — é o que faz o Backspace continuar sendo
 * Voltar sem que o dígito 8 vire Voltar junto.
 */
function casa(event: KeyboardEvent, nomes: Set<string>, codigos: Set<string>): boolean {
    if (event.key && nomes.has(event.key)) return true;
    return event.keyCode > 0 && codigos.has(String(event.keyCode));
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { hasError: false, message: '' };

    static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
        return {
            hasError: true,
            message: error instanceof Error ? error.message : 'Erro inesperado',
        };
    }

    componentDidCatch(error: unknown): void {
        console.error('[AppErrorBoundary]', error);
    }

    private handleKeyDown = (event: KeyboardEvent) => {
        if (!this.state.hasError) return;
        if (casa(event, ENTER_NOMES, ENTER_CODIGOS)) {
            window.location.reload();
            return;
        }
        if (casa(event, BACK_NOMES, BACK_CODIGOS)) {
            exitApp();
        }
    };

    componentDidMount(): void {
        window.addEventListener('keydown', this.handleKeyDown);
    }

    componentWillUnmount(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    render(): ReactNode {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="app-crash">
                <div className="app-crash-icon">😵</div>
                <h1 className="app-crash-title">Algo deu errado</h1>
                <p className="app-crash-text">
                    O aplicativo encontrou um erro e precisa reiniciar.
                    Seus dados e configurações estão preservados.
                </p>
                <p className="app-crash-detail">{this.state.message}</p>
                <button className="app-offline-retry tv-focused" onClick={() => window.location.reload()}>
                    🔄 Reiniciar (OK)
                </button>
                {podeSair() && (
                    <p className="app-crash-hint">Ou aperte Voltar para sair do NeoStream</p>
                )}
            </div>
        );
    }
}
