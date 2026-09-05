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

const ENTER_KEYS = new Set(['Enter', '13', '29443', 'Select', ' ', '32']);
// Mesma lista do TV_KEYS.BACK do useTVNavigation. Duplicada de propósito: o
// boundary tem que funcionar mesmo quando o módulo que quebrou foi outro.
const BACK_KEYS = new Set(['Backspace', 'XF86Back', '10009', '8', '461', 'Escape', '27']);

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
        const key = event.key || String(event.keyCode);
        if (ENTER_KEYS.has(key)) {
            window.location.reload();
            return;
        }
        if (BACK_KEYS.has(key)) {
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
