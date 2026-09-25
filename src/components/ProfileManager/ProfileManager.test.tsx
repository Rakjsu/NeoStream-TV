// @vitest-environment jsdom
//
// OK dentro do campo Nome reabria o teclado da TV num laço.
//
// O useTVNavigation, quando o OK vem de DENTRO de um campo de texto, tira o
// foco do campo (é isso que fecha o IME do Tizen) e chama `onEnter(true)`. O
// `true` existe justamente para quem escuta NÃO refocar o campo — Movies,
// Series e LiveTV respeitam. O ProfileManager ignorava o parâmetro: com a zona
// ainda em 'name', o handleEnter fazia `nameInputRef.current?.focus()` e o
// teclado subia de novo. Na TV não havia como sair do campo com OK, então não
// havia como chegar no "Salvar" — não dava pra criar perfil. O mesmo valia
// para o campo de PIN e para o formulário de edição.
//
// O teste monta o componente de verdade, com o profileService de verdade
// (localStorage do jsdom), e dispara as teclas como a TV dispara.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ProfileManager } from './ProfileManager';
import { profileService } from '../../services/profileService';

const ENTER = { key: 'Enter', keyCode: 13 };
const BAIXO = { key: 'ArrowDown', keyCode: 40 };
const DIREITA = { key: 'ArrowRight', keyCode: 39 };

/**
 * Aperta uma tecla do controle como o navegador entrega: o keydown nasce no
 * elemento FOCADO (o input, se o teclado estiver aberto) e sobe até o window,
 * onde o useTVNavigation escuta. Disparar direto no window esconderia o bug —
 * com o campo refocado, as setas nunca chegam na navegação.
 */
function apertar(tecla: { key: string; keyCode: number }): void {
    fireEvent.keyDown(document.activeElement ?? document.body, tecla);
}

function campoNome(): HTMLInputElement {
    return screen.getByPlaceholderText('Digite o nome...') as HTMLInputElement;
}

function campoPin(): HTMLInputElement {
    return screen.getByPlaceholderText('Sem PIN') as HTMLInputElement;
}

/**
 * Monta a tela e espera a lista carregar (profileService.initialize roda num
 * microtask e cria "Principal" — ativo — e "Kids"). Esperar pelo card
 * "Adicionar Perfil" não serve: com a lista ainda vazia ele já aparece.
 */
async function montar(): Promise<void> {
    render(<ProfileManager onClose={() => { /* não interessa aqui */ }} />);
    await screen.findByText('Principal');
}

/** Abre "Novo Perfil" SÓ com o controle — o campo Nome nasce focado (autoFocus). */
async function abrirNovoPerfil(): Promise<HTMLInputElement> {
    await montar();
    // Principal → Kids → "+ Adicionar". No Principal, a 1ª → vai pro
    // sub-foco "Editar" do card; a 2ª sai do card pro Kids; a 3ª pro "+".
    apertar(DIREITA);
    apertar(DIREITA);
    apertar(DIREITA);
    apertar(ENTER);
    const nome = campoNome();
    expect(screen.getByText('Novo Perfil')).toBeTruthy();
    expect(document.activeElement).toBe(nome);
    return nome;
}

describe('ProfileManager — OK dentro de um campo de texto', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    // O auto-cleanup do RTL só roda com `globals: true`, que este projeto não
    // usa — sem isto o listener do hook de um teste segue ouvindo no próximo.
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it('OK no campo Nome fecha o teclado e NÃO refoca o campo', async () => {
        const nome = await abrirNovoPerfil();
        fireEvent.change(nome, { target: { value: 'Joana' } });

        apertar(ENTER);

        // Refocar o input é reabrir o IME do Tizen: o laço sem saída.
        expect(document.activeElement).not.toBe(nome);
        // E o formulário continua aberto, com o que foi digitado
        expect(campoNome()).toBe(nome);
        expect(nome.value).toBe('Joana');
    });

    it('OK no campo PIN fecha o teclado e NÃO refoca o campo', async () => {
        const nome = await abrirNovoPerfil();
        apertar(ENTER);
        expect(document.activeElement).not.toBe(nome);

        // Fora do input: ↓ leva a zona pro PIN e OK abre o campo (esperado)
        apertar(BAIXO);
        apertar(ENTER);
        const pin = campoPin();
        expect(document.activeElement).toBe(pin);

        fireEvent.change(pin, { target: { value: '1234' } });
        apertar(ENTER);

        expect(document.activeElement).not.toBe(pin);
        expect(pin.value).toBe('1234');
    });

    it('OK de FORA do campo, com a zona no Nome, continua abrindo o teclado', async () => {
        // A guarda do fromInput não pode ter matado o caminho normal.
        const nome = await abrirNovoPerfil();
        apertar(ENTER);
        expect(document.activeElement).not.toBe(nome);

        apertar(ENTER);

        expect(document.activeElement).toBe(nome);
    });

    it('dá pra criar um perfil só com o controle: nome, OK, ↓↓↓, →, OK', async () => {
        const nome = await abrirNovoPerfil();
        fireEvent.change(nome, { target: { value: 'Joana' } });
        apertar(ENTER);

        apertar(BAIXO);   // nome → PIN
        apertar(BAIXO);   // PIN → avatares
        apertar(BAIXO);   // avatares (1 linha) → botões, em Cancelar
        apertar(DIREITA); // Cancelar → Salvar
        apertar(ENTER);

        await waitFor(() => {
            expect(profileService.getAllProfiles().some(p => p.name === 'Joana')).toBe(true);
        });
    });

    it('no "Editar Perfil" o OK dentro do Nome também não refoca, e dá pra salvar', async () => {
        await montar();
        // Foco nasce no card do Principal, que é o ativo: OK abre a edição
        apertar(ENTER);
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
        const nome = campoNome();
        expect(document.activeElement).toBe(nome);

        fireEvent.change(nome, { target: { value: 'Casa' } });
        apertar(ENTER);
        expect(document.activeElement).not.toBe(nome);

        apertar(BAIXO);   // nome → PIN
        apertar(BAIXO);   // PIN → avatares
        apertar(BAIXO);   // avatares → botões, em Cancelar
        apertar(DIREITA); // Cancelar → Salvar
        apertar(ENTER);

        await waitFor(() => {
            expect(profileService.getActiveProfile()?.name).toBe('Casa');
        });
    });
});
