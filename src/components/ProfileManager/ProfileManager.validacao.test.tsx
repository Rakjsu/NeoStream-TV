// @vitest-environment jsdom
//
// "Salvar" que não respondia nem explicava (T047).
//
// O formulário de perfil tinha três saídas mudas: PIN com menos de 4 dígitos,
// nome vazio e o limite de 5 perfis. Nas duas primeiras o handler fazia um
// `return` sem mensagem nenhuma; na TV, sem console, o OK em "Salvar" parecia
// um botão quebrado. O "Salvar" ainda ficava `disabled` com o nome vazio — o
// D-pad chegava nele, mas o clique do ponteiro morria no botão. E o limite de
// perfis caía no mesmo `null` da memória cheia: a tela mandava liberar espaço
// na TV quando o que faltava era vaga.
//
// Aqui a tela de verdade roda com o profileService de verdade (localStorage do
// jsdom) e as teclas chegam como a TV manda.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { ProfileManager } from './ProfileManager';
import { profileService } from '../../services/profileService';

const ENTER = { key: 'Enter', keyCode: 13 };
const BAIXO = { key: 'ArrowDown', keyCode: 40 };
const DIREITA = { key: 'ArrowRight', keyCode: 39 };

/** O keydown nasce no elemento focado e sobe até o window (useTVNavigation). */
function apertar(tecla: { key: string; keyCode: number }): void {
    fireEvent.keyDown(document.activeElement ?? document.body, tecla);
}

function campoNome(): HTMLInputElement {
    return screen.getByPlaceholderText('Digite o nome...') as HTMLInputElement;
}

function campoPin(): HTMLInputElement {
    // "Sem PIN" no perfil novo; "••••" no perfil que já tem PIN
    return (screen.queryByPlaceholderText('Sem PIN') ?? screen.getByPlaceholderText('••••')) as HTMLInputElement;
}

function botaoSalvar(): HTMLButtonElement {
    return screen.getByText('✓ Salvar') as HTMLButtonElement;
}

/**
 * Monta a tela e espera a lista (o initialize roda num microtask fora do act).
 * Depois esvazia os efeitos: o ouvinte de teclas é re-registrado num efeito,
 * e apertar antes usaria o ouvinte velho, sem o perfil ativo.
 */
async function montar(): Promise<void> {
    render(<ProfileManager onClose={() => { /* não interessa aqui */ }} />);
    await screen.findByText('Principal');
    await act(async () => { await Promise.resolve(); });
}

/** Leva o foco do D-pad até o card "+ Adicionar" e aperta OK. */
function abrirNovoPerfilPeloControle(): void {
    const adicionar = () => screen.getByText('Adicionar Perfil').closest('.pm-add-card');
    for (let passos = 0; !adicionar()?.classList.contains('focused'); passos++) {
        if (passos > 20) throw new Error('o D-pad não chegou no + Adicionar');
        apertar(DIREITA);
    }
    apertar(ENTER);
    expect(screen.getByText('Novo Perfil')).toBeTruthy();
}

/**
 * Do campo Nome (teclado aberto) até o "Salvar" só com o controle:
 * OK fecha o teclado, ↓↓↓ desce Nome → PIN → avatares → botões, → vai pro Salvar.
 */
function irAteSalvarEApertarOk(): void {
    if (document.activeElement === campoNome()) apertar(ENTER);
    apertar(BAIXO);
    apertar(BAIXO);
    apertar(BAIXO);
    apertar(DIREITA);
    expect(botaoSalvar().classList.contains('focused')).toBe(true);
    apertar(ENTER);
}

describe('ProfileManager — o Salvar sempre responde', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('PIN de 3 dígitos: OK no Salvar explica, aponta o campo e não cria nada', async () => {
        await montar();
        abrirNovoPerfilPeloControle();
        fireEvent.change(campoNome(), { target: { value: 'Joana' } });
        fireEvent.change(campoPin(), { target: { value: '123' } });

        irAteSalvarEApertarOk();

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toBe('O PIN precisa ter 4 dígitos.');
        // O anel de foco do D-pad vai pro campo que falta, não fica no Salvar
        expect(campoPin().classList.contains('tv-focused')).toBe(true);
        expect(botaoSalvar().classList.contains('focused')).toBe(false);
        // Continua no formulário, com o que foi digitado
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
        expect(campoNome().value).toBe('Joana');
        expect(campoPin().value).toBe('123');
        expect(profileService.getAllProfiles().map(p => p.name)).not.toContain('Joana');
    });

    it('nome vazio: OK no Salvar pede o nome e aponta o campo Nome', async () => {
        await montar();
        abrirNovoPerfilPeloControle();

        irAteSalvarEApertarOk();

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toBe('Dê um nome ao perfil.');
        expect(campoNome().classList.contains('tv-focused')).toBe(true);
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
        expect(profileService.getAllProfiles()).toHaveLength(2);
    });

    it('nome só com espaços conta como vazio', async () => {
        await montar();
        abrirNovoPerfilPeloControle();
        fireEvent.change(campoNome(), { target: { value: '   ' } });

        irAteSalvarEApertarOk();

        expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao perfil.');
        expect(profileService.getAllProfiles()).toHaveLength(2);
    });

    it('nome vazio E PIN incompleto: aponta primeiro o Nome, o campo de cima', async () => {
        await montar();
        abrirNovoPerfilPeloControle();
        fireEvent.change(campoPin(), { target: { value: '12' } });

        irAteSalvarEApertarOk();

        // O anel vai pro primeiro campo que falta, na ordem da tela (Nome → PIN)
        expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao perfil.');
        expect(campoNome().classList.contains('tv-focused')).toBe(true);
        expect(campoPin().classList.contains('tv-focused')).toBe(false);

        // Com o nome dado, o próximo Salvar aponta o PIN
        fireEvent.change(campoNome(), { target: { value: 'Joana' } });
        fireEvent.click(botaoSalvar());
        expect((await screen.findByRole('alert')).textContent).toBe('O PIN precisa ter 4 dígitos.');
        expect(campoPin().classList.contains('tv-focused')).toBe(true);
        expect(profileService.getAllProfiles().map(p => p.name)).not.toContain('Joana');
    });

    it('o Salvar não fica desabilitado: o clique com o nome vazio também explica', async () => {
        await montar();
        fireEvent.click(screen.getByText('Adicionar Perfil'));

        expect(botaoSalvar().disabled).toBe(false);
        fireEvent.click(botaoSalvar());

        expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao perfil.');
        expect(screen.getByText('Novo Perfil')).toBeTruthy();
    });

    it('ao corrigir o campo, o aviso some; e com o PIN completo o perfil é criado', async () => {
        await montar();
        abrirNovoPerfilPeloControle();
        fireEvent.change(campoNome(), { target: { value: 'Joana' } });
        fireEvent.change(campoPin(), { target: { value: '123' } });
        irAteSalvarEApertarOk();
        await screen.findByRole('alert');

        fireEvent.change(campoPin(), { target: { value: '1234' } });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.click(botaoSalvar());
        await waitFor(() => {
            expect(profileService.getAllProfiles().map(p => p.name)).toContain('Joana');
        });
        expect(profileService.getAllProfiles().find(p => p.name === 'Joana')?.pin).toBeTruthy();
    });

    it('digitar no Nome depois do aviso de nome apaga o aviso', async () => {
        await montar();
        abrirNovoPerfilPeloControle();
        irAteSalvarEApertarOk();
        expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao perfil.');

        fireEvent.change(campoNome(), { target: { value: 'Ana' } });

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('editar com PIN de 2 dígitos explica e não mexe no perfil', async () => {
        await montar();
        // Foco nasce no Principal, que é o ativo: OK abre a edição dele
        apertar(ENTER);
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        fireEvent.change(campoNome(), { target: { value: 'Casa' } });
        fireEvent.change(campoPin(), { target: { value: '12' } });

        irAteSalvarEApertarOk();

        expect((await screen.findByRole('alert')).textContent).toBe('O PIN precisa ter 4 dígitos.');
        expect(campoPin().classList.contains('tv-focused')).toBe(true);
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        const principal = profileService.getActiveProfile();
        expect(principal?.name).toBe('Principal');
        expect(principal?.pin).toBeFalsy();
    });

    it('editar com o nome apagado pede o nome e mantém o antigo', async () => {
        await montar();
        apertar(ENTER);
        fireEvent.change(campoNome(), { target: { value: '' } });

        irAteSalvarEApertarOk();

        expect((await screen.findByRole('alert')).textContent).toBe('Dê um nome ao perfil.');
        expect(campoNome().classList.contains('tv-focused')).toBe(true);
        expect(profileService.getActiveProfile()?.name).toBe('Principal');
    });

    it('"Remover PIN" depois do aviso de PIN incompleto apaga o aviso e salva sem PIN', async () => {
        profileService.initialize();
        expect(await profileService.updateProfile('default', { pin: '1111' })).toBe(true);
        await montar();
        apertar(ENTER); // Principal é o ativo: abre a edição sem pedir PIN
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        fireEvent.change(campoPin(), { target: { value: '12' } });
        irAteSalvarEApertarOk();
        await screen.findByRole('alert');

        // O anel está no PIN: ↓↓ volta pros botões (Cancelar), →→ "Remover PIN"
        apertar(BAIXO);
        apertar(BAIXO);
        apertar(DIREITA);
        apertar(DIREITA);
        expect(screen.getByText('🗑 Remover PIN').classList.contains('focused')).toBe(true);
        apertar(ENTER);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('O PIN será removido ao salvar.')).toBeTruthy();

        apertar({ key: 'ArrowLeft', keyCode: 37 }); // volta pro Salvar
        apertar(ENTER);
        await waitFor(() => {
            expect(profileService.getActiveProfile()?.pin).toBeFalsy();
        });
    });

    it('clicar em "Remover PIN" depois do aviso também apaga o aviso', async () => {
        profileService.initialize();
        expect(await profileService.updateProfile('default', { pin: '1111' })).toBe(true);
        await montar();
        apertar(ENTER);
        fireEvent.change(campoPin(), { target: { value: '12' } });
        fireEvent.click(botaoSalvar());
        expect((await screen.findByRole('alert')).textContent).toBe('O PIN precisa ter 4 dígitos.');

        fireEvent.click(screen.getByText('🗑 Remover PIN'));

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('O PIN será removido ao salvar.')).toBeTruthy();
    });

    it('limite de 5 perfis: o aviso fala do limite, não da memória cheia', async () => {
        // Principal + Kids + 2 = 4: o "+ Adicionar" ainda aparece
        profileService.initialize();
        expect(await profileService.createProfile({ name: 'Visita 1', avatar: 'A' })).not.toBeNull();
        expect(await profileService.createProfile({ name: 'Visita 2', avatar: 'B' })).not.toBeNull();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await montar();
        fireEvent.click(screen.getByText('Adicionar Perfil'));
        fireEvent.change(campoNome(), { target: { value: 'Vovó' } });

        // Enquanto o formulário estava aberto, a 5ª vaga foi ocupada
        expect(await profileService.createProfile({ name: 'Visita 3', avatar: 'C' })).not.toBeNull();
        fireEvent.click(botaoSalvar());

        const aviso = await screen.findByRole('alert');
        expect(aviso.textContent).toBe('Limite de 5 perfis atingido. Exclua um perfil para criar outro.');
        expect(aviso.textContent).not.toContain('memória');
        expect(profileService.getAllProfiles().map(p => p.name)).not.toContain('Vovó');

        // De volta à lista: ela já mostra a 5ª vaga ocupada e não oferece
        // o "+ Adicionar" que acabou de ser recusado
        fireEvent.click(screen.getByText('Cancelar'));
        expect(screen.getByText('Visita 3')).toBeTruthy();
        expect(screen.queryByText('Adicionar Perfil')).toBeNull();
    });
});
