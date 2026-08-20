// Error boundary global (R1 item 73): erro de render não pode virar tela
// preta numa TV — mostra recuperação amigável e OK reinicia o app.

import { Component, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    hasError: boolean;
    message: string;
}

const ENTER_KEYS = new Set(['Enter', '13', '29443', 'Select', ' ', '32']);

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
            </div>
        );
    }
}
