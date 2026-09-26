// @vitest-environment jsdom
//
// Voltar no Login não pode reiniciar o app.
//
// O `handleBack` do Login era `window.location.reload()` — para o botão
// Voltar, para o OK no foco 6 e para a tecla Voltar do controle. No fluxo
// ➕ Adicionar playlist (Configurações → Login em branco) isso subia o bundle
// inteiro de novo e a pessoa terminava na Home, não em Configurações; no
// primeiro uso, o bundle recarregava só pra cair na mesma tela de boas-vindas.
// Agora quem abre o Login diz pra onde ele volta (prop `onBack`, obrigatória).
//
// Teste comportamental: monta o App DE VERDADE com o Login DE VERDADE e aperta
// as teclas como a TV aperta. Só as páginas que não interessam (e que
// buscariam catálogo na rede) viram dublês; o provedor é um spy no `api`.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { api } from './services/api';
import type { AuthResponse } from './types';
import App from './App';

vi.mock('./pages/Welcome', () => ({
    Welcome: ({ onGoToLogin }: { onGoToLogin: () => void }) => (
        <div data-testid="pagina-boas-vindas">
            <button data-testid="ir-login" onClick={onGoToLogin}>entrar</button>
        </div>
    ),
}));
vi.mock('./pages/LanguageSelection', () => ({
    LanguageSelection: ({ onComplete }: { onComplete: () => void }) => (
        <div data-testid="pagina-idioma">
            <button data-testid="concluir-idioma" onClick={onComplete}>ok</button>
        </div>
    ),
}));
vi.mock('./pages/Settings', () => ({
    Settings: ({ onAddPlaylist }: { onAddPlaylist: () => void }) => (
        <div data-testid="pagina-configuracoes">
            <button data-testid="adicionar-playlist" onClick={onAddPlaylist}>+</button>
        </div>
    ),
}));
vi.mock('./pages/Home', () => ({ Home: () => <div data-testid="pagina-home" /> }));
vi.mock('./pages/LiveTV', () => ({ LiveTV: () => null }));
vi.mock('./pages/Movies', () => ({ Movies: () => null }));
vi.mock('./pages/Series', () => ({ Series: () => null }));
vi.mock('./pages/Favorites', () => ({ Favorites: () => null }));
vi.mock('./pages/MyList', () => ({ MyList: () => null }));
vi.mock('./components/Sidebar', () => ({
    Sidebar: ({ onItemSelect, onLogout }: { onItemSelect: (pagina: string) => void; onLogout: () => void }) => (
        <nav data-testid="sidebar">
            <button data-testid="ir-configuracoes" onClick={() => onItemSelect('settings')}>config</button>
            <button data-testid="sair-da-conta" onClick={onLogout}>sair</button>
        </nav>
    ),
}));
vi.mock('./components/ProfileManager', () => ({ ProfileManager: () => null }));
vi.mock('./components/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('./components/SetupWizard', () => ({ SetupWizard: () => null }));

const RESPOSTA_DO_PROVEDOR = {
    user_info: { username: 'teste', status: 'Active', auth: 1 },
    server_info: { url: 'servidor.exemplo', timezone: 'America/Sao_Paulo' },
} as unknown as AuthResponse;

function aparelhoComIdioma(): void {
    localStorage.setItem('neostream_settings', JSON.stringify({ language: 'pt', autoPlay: true, preferredQuality: 'auto' }));
    // O assistente de primeira configuração não é assunto deste teste
    localStorage.setItem('neostream_wizard_done', '1');
}

function aparelhoComConta(): void {
    aparelhoComIdioma();
    localStorage.setItem('neostream_credentials', JSON.stringify({
        url: 'http://servidor.exemplo:8080', username: 'teste', password: 'teste',
    }));
}

/** Tecla como a TV dispara: keydown no window. */
function tecla(key: string): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/**
 * O ouvinte do useTVNavigation é re-registrado num efeito: apertar tecla antes
 * dos efeitos rodarem usaria o ouvinte da tela anterior.
 */
async function esvaziarEfeitos(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

const noLogin = () => document.querySelector('.login-container');
const campoServidor = () => document.querySelector('.login-container input') as HTMLInputElement;

async function abrirAdicionarPlaylist(): Promise<void> {
    await screen.findByTestId('pagina-home');
    await esvaziarEfeitos();
    fireEvent.click(screen.getByTestId('ir-configuracoes'));
    fireEvent.click(await screen.findByTestId('adicionar-playlist'));
    await esvaziarEfeitos();
    expect(noLogin(), 'o ➕ tinha que abrir o Login').not.toBeNull();
    expect(campoServidor().value, 'o ➕ abre o Login em branco').toBe('');
    // Meio caminho digitado no D-pad
    fireEvent.change(campoServidor(), { target: { value: 'http://outro.exemplo:8080' } });
    await esvaziarEfeitos();
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(api, 'authenticate').mockResolvedValue(RESPOSTA_DO_PROVEDOR);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});

describe('Voltar no Login', () => {
    it('➕ Adicionar playlist: a tecla Voltar devolve a Configurações, sem reiniciar o app', async () => {
        aparelhoComConta();
        render(<App />);
        await abrirAdicionarPlaylist();

        tecla('XF86Back');

        expect(noLogin(), 'Voltar tinha que sair do Login').toBeNull();
        expect(screen.getByTestId('pagina-configuracoes')).toBeTruthy();
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        // Voltar não é login: a playlist ativa continua a mesma, sem nova autenticação
        expect(api.authenticate).toHaveBeenCalledTimes(1);
    });

    it('➕ Adicionar playlist: seis ↓ e OK no botão Voltar também devolve a Configurações', async () => {
        aparelhoComConta();
        render(<App />);
        await abrirAdicionarPlaylist();
        // Formulário todo preenchido: o OK no Voltar não pode virar "Entrar"
        const [, campoUsuario, campoSenha] = Array.from(document.querySelectorAll('.login-container input')) as HTMLInputElement[];
        fireEvent.change(campoUsuario, { target: { value: 'outro' } });
        fireEvent.change(campoSenha, { target: { value: 'outra' } });
        await esvaziarEfeitos();

        for (let i = 0; i < 6; i++) tecla('ArrowDown');
        const voltar = screen.getByRole('button', { name: /Voltar/ });
        expect(voltar.className, 'o foco tinha que estar no Voltar').toContain('focused');
        tecla('Enter');
        await esvaziarEfeitos();

        expect(noLogin()).toBeNull();
        expect(screen.getByTestId('pagina-configuracoes')).toBeTruthy();
        // Só a autenticação do boot: o OK no Voltar não tentou logar na playlist digitada
        expect(api.authenticate).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('neostream_credentials')).toContain('servidor.exemplo');
    });

    it('primeiro uso: o botão Voltar leva de volta às boas-vindas', async () => {
        aparelhoComIdioma();
        render(<App />);
        fireEvent.click(await screen.findByTestId('ir-login'));
        await esvaziarEfeitos();
        expect(noLogin()).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));

        expect(noLogin()).toBeNull();
        expect(screen.getByTestId('pagina-boas-vindas')).toBeTruthy();
        expect(api.authenticate).not.toHaveBeenCalled();
    });

    it('➕ abandonado pela troca de idioma e conta encerrada: o Voltar do Login seguinte vai às boas-vindas, não ao app sem conta', async () => {
        aparelhoComConta();
        render(<App />);
        await abrirAdicionarPlaylist();

        // Troca de idioma no meio do ➕: o idioma termina em checkAuth, que
        // entra no app com a conta que já existia
        fireEvent.click(document.querySelector('.login-btn-lang') as HTMLElement);
        fireEvent.click(await screen.findByTestId('concluir-idioma'));
        await screen.findByTestId('pagina-configuracoes');
        await esvaziarEfeitos();

        fireEvent.click(screen.getByTestId('sair-da-conta'));
        fireEvent.click(await screen.findByTestId('ir-login'));
        await esvaziarEfeitos();
        expect(noLogin()).not.toBeNull();

        tecla('XF86Back');

        expect(noLogin()).toBeNull();
        expect(screen.getByTestId('pagina-boas-vindas')).toBeTruthy();
        expect(screen.queryByTestId('sidebar'), 'sem conta, o app principal não pode abrir').toBeNull();
    });

    it('com o teclado aberto, Voltar só fecha o teclado: continua no Login com o que foi digitado', async () => {
        aparelhoComIdioma();
        render(<App />);
        fireEvent.click(await screen.findByTestId('ir-login'));
        await esvaziarEfeitos();

        // OK no campo Servidor (foco 0) abre o teclado
        tecla('Enter');
        await esvaziarEfeitos();
        expect(document.activeElement, 'o OK tinha que abrir o campo Servidor').toBe(campoServidor());
        fireEvent.change(campoServidor(), { target: { value: 'http://servidor.exemplo:8080' } });
        await esvaziarEfeitos();

        tecla('XF86Back');
        await esvaziarEfeitos();

        expect(noLogin(), 'Voltar com o teclado aberto não pode sair do Login').not.toBeNull();
        expect(campoServidor().value, 'o que foi digitado tinha que ficar').toBe('http://servidor.exemplo:8080');
        expect(document.activeElement, 'o teclado tinha que fechar').not.toBe(campoServidor());

        // Teclado fechado: o Voltar seguinte sai de verdade
        tecla('XF86Back');

        expect(noLogin()).toBeNull();
        expect(screen.getByTestId('pagina-boas-vindas')).toBeTruthy();
    });
});
