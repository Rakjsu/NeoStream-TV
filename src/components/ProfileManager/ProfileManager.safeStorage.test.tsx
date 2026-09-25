// @vitest-environment jsdom
//
// 💾 "Salvar" que não salvou (T107).
//
// Com a quota da TV cheia, criar um perfil falhava num console.error que
// ninguém lê: o formulário fechava, a lista voltava sem o perfil novo e a
// pessoa tentava de novo, e de novo. Aqui a tela de verdade roda contra um
// localStorage que TEM quota e já está estourado, sem cache nenhum pra podar.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { installFakeStorage, type FakeStorage } from '../../testing/fakeStorage';
import { profileService } from '../../services/profileService';
import { ProfileManager } from './ProfileManager';

let fake: FakeStorage;

beforeEach(() => {
    fake = installFakeStorage(20_000);
    profileService.initialize();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Dado do usuário (não é cache): a poda do safeStorage não tem o que apagar. */
function estourarQuota(): void {
    fake.store.set('neostream_favorites', 'x'.repeat(20_000));
}

describe('ProfileManager com a memória cheia', () => {
    it('criar perfil que não coube avisa e mantém o formulário aberto', async () => {
        const onClose = vi.fn();
        render(<ProfileManager onClose={onClose} />);
        // O initialize/refresh roda numa microtask: espera a lista aparecer
        fireEvent.click(await screen.findByText('Adicionar Perfil'));

        estourarQuota();
        fireEvent.change(screen.getByPlaceholderText('Digite o nome...'), { target: { value: 'Vovó' } });
        fireEvent.click(screen.getByText('✓ Salvar'));

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toContain('memória da TV está cheia');
        // Continua no formulário, com o que foi digitado — dá pra liberar
        // espaço e tentar de novo sem redigitar no D-pad
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
        expect((screen.getByPlaceholderText('Digite o nome...') as HTMLInputElement).value).toBe('Vovó');
        expect(profileService.getAllProfiles().map(p => p.name)).not.toContain('Vovó');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('com espaço, cria e volta pra lista sem aviso', async () => {
        render(<ProfileManager onClose={() => undefined} />);
        fireEvent.click(await screen.findByText('Adicionar Perfil'));

        fireEvent.change(screen.getByPlaceholderText('Digite o nome...'), { target: { value: 'Vovó' } });
        fireEvent.click(screen.getByText('✓ Salvar'));

        expect(await screen.findByText('Vovó')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('Novo Perfil')).toBeNull();
    });

    it('editar perfil que não coube avisa, mantém o formulário e o nome antigo', async () => {
        const onClose = vi.fn();
        render(<ProfileManager onClose={onClose} />);
        // Clicar no perfil ATIVO abre a edição dele
        fireEvent.click(await screen.findByText('Principal'));
        expect(screen.getByText('Editar Perfil')).toBeTruthy();

        estourarQuota();
        fireEvent.change(screen.getByPlaceholderText('Digite o nome...'), { target: { value: 'Casa' } });
        fireEvent.click(screen.getByText('✓ Salvar'));

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toContain('memória da TV está cheia');
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        expect(profileService.getAllProfiles().find(p => p.id === 'default')?.name).toBe('Principal');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('excluir perfil que não coube avisa, fica no diálogo e o perfil continua', async () => {
        expect(await profileService.createProfile({ name: 'Visita', avatar: 'B' })).not.toBeNull();
        render(<ProfileManager onClose={() => undefined} />);
        fireEvent.click(botaoExcluirDoCard(await screen.findByText('Visita')));
        expect(screen.getByText('Excluir Perfil?')).toBeTruthy();

        estourarQuota();
        fireEvent.click(botaoConfirmarExclusao());

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toContain('memória da TV está cheia');
        expect(screen.getByText('Excluir Perfil?')).toBeTruthy();
        expect(profileService.getAllProfiles().map(p => p.name)).toContain('Visita');
    });

    // O aviso é de UMA tentativa: abrir outro formulário não pode herdá-lo
    it('o aviso não vaza pro próximo formulário (Editar, Adicionar, Excluir, OK no +)', async () => {
        expect(await profileService.createProfile({ name: 'Visita', avatar: 'B' })).not.toBeNull();
        render(<ProfileManager onClose={() => undefined} />);
        fireEvent.click(await screen.findByText('Adicionar Perfil'));
        estourarQuota();
        fireEvent.change(screen.getByPlaceholderText('Digite o nome...'), { target: { value: 'Vovó' } });
        fireEvent.click(screen.getByText('✓ Salvar'));
        await screen.findByRole('alert');

        // Cancelar → Editar o ativo: começa limpo
        fireEvent.click(screen.getByText('Cancelar'));
        fireEvent.click(screen.getByText('Principal'));
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();

        // Falha na edição → Cancelar → Adicionar pelo clique: limpo
        fireEvent.click(screen.getByText('✓ Salvar'));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByText('Cancelar'));
        fireEvent.click(screen.getByText('Adicionar Perfil'));
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();

        // Falha → Cancelar → diálogo de exclusão: limpo
        fireEvent.change(screen.getByPlaceholderText('Digite o nome...'), { target: { value: 'Vovó' } });
        fireEvent.click(screen.getByText('✓ Salvar'));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByText('Cancelar'));
        fireEvent.click(botaoExcluirDoCard(screen.getByText('Visita')));
        expect(screen.getByText('Excluir Perfil?')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();

        // Falha na exclusão → Cancelar → OK no "+ Adicionar" pelo D-pad: limpo
        fireEvent.click(botaoConfirmarExclusao());
        await screen.findByRole('alert');
        fireEvent.click(screen.getByText('Cancelar'));
        const adicionar = () => screen.getByText('Adicionar Perfil').closest('.pm-add-card');
        for (let passos = 0; !adicionar()?.classList.contains('focused'); passos++) {
            if (passos > 20) throw new Error('o D-pad não chegou no + Adicionar');
            fireEvent.keyDown(window, { key: 'ArrowRight' });
        }
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

function botaoExcluirDoCard(nome: HTMLElement): HTMLButtonElement {
    const botao = nome.closest('.pm-profile-card')?.querySelector<HTMLButtonElement>('.pm-btn-delete');
    if (!botao) throw new Error('card sem o botão Excluir');
    return botao;
}

function botaoConfirmarExclusao(): HTMLButtonElement {
    const botao = document.querySelector<HTMLButtonElement>('.pm-modal-delete .pm-btn-danger');
    if (!botao) throw new Error('diálogo de exclusão sem o botão de confirmar');
    return botao;
}
