// @vitest-environment jsdom
//
// 🔒 Editar ou excluir um perfil ALHEIO não pedia PIN nenhum (T046).
//
// A troca de perfil passa por uma porta (PIN do perfil; PIN parental ao sair
// do Kids), mas os botões Editar/Excluir do card abriam direto. Do perfil Kids
// a criança focava o card Principal, ▶ até "Editar", OK, descia até
// "🗑 Remover PIN" e salvava: o PIN do adulto sumia sem ninguém provar nada.
// Pelo "Excluir" era pior — o perfil e os dados dele iam embora.
//
// A regra agora: mexer num perfil que NÃO é o ativo exige exatamente o que
// entrar nele exigiria. O próprio perfil ativo continua editável sem PIN.
//
// Tudo aqui roda na tela de verdade, com o profileService e o parentalService
// de verdade (localStorage do jsdom), e as teclas chegam como a TV entrega.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { ProfileManager } from './ProfileManager';
import { profileService } from '../../services/profileService';
import { parentalService } from '../../services/parentalService';

const ENTER = { key: 'Enter', keyCode: 13 };
const BAIXO = { key: 'ArrowDown', keyCode: 40 };
const DIREITA = { key: 'ArrowRight', keyCode: 39 };
const ESQUERDA = { key: 'ArrowLeft', keyCode: 37 };
const VOLTAR = { key: 'XF86Back', keyCode: 10009 };

const PIN_ADULTO = '1234';
const PIN_PARENTAL = '9090';

function apertar(tecla: { key: string; keyCode: number }): void {
    fireEvent.keyDown(document.activeElement ?? document.body, tecla);
}

/** Números do controle: o PinPrompt escuta no window (4º dígito confirma). */
function digitar(pin: string): void {
    for (const d of pin) fireEvent.keyDown(window, { key: d, keyCode: 48 + Number(d) });
}

function promptDePin(): HTMLElement | null {
    return document.querySelector('.pin-overlay');
}

function card(nome: string): HTMLElement {
    const el = screen.getByText(nome).closest('.pm-profile-card');
    if (!el) throw new Error(`card "${nome}" não encontrado`);
    return el as HTMLElement;
}

function botaoDoCard(nome: string, classe: '.pm-btn-edit' | '.pm-btn-delete'): HTMLButtonElement {
    const b = card(nome).querySelector<HTMLButtonElement>(classe);
    if (!b) throw new Error(`card "${nome}" sem ${classe}`);
    return b;
}

/**
 * Principal (id 'default') ganha PIN e o Kids vira o ativo: é a TV na mão
 * da criança. O card focado ao abrir é o índice 0, o Principal.
 */
async function prepararKidsAtivo(opcoes: { pinAdulto?: boolean; parental?: boolean } = {}): Promise<void> {
    const { pinAdulto = true, parental = false } = opcoes;
    profileService.initialize();
    if (pinAdulto) expect(await profileService.updateProfile('default', { pin: PIN_ADULTO })).toBe(true);
    if (parental) expect(await parentalService.set(PIN_PARENTAL)).toBe(true);
    expect(profileService.setActiveProfile('kids-default')).toBe(true);
}

async function montar(): Promise<void> {
    render(<ProfileManager onClose={() => { /* não interessa aqui */ }} />);
    await screen.findByText('Principal');
    // A lista chega num microtask fora do act: esvazia os efeitos antes da 1ª
    // tecla, senão o ouvinte do useTVNavigation ainda é o do estado vazio.
    await act(async () => { await Promise.resolve(); });
}

/**
 * O prompt de PIN muda de estado FORA do act (a conferência do PIN é
 * assíncrona): o DOM já mostra o texto novo, mas o efeito que re-registra o
 * ouvinte de dígitos pode não ter rodado — e o 4º dígito cairia no ouvinte
 * velho (ainda "conferindo", que ignora o envio). Esvazia antes de digitar.
 */
async function esvaziarEfeitos(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

function pinDoAdultoIntacto(): boolean {
    return profileService.hasPin('default');
}

describe('ProfileManager — perfil alheio só se mexe com o PIN dele (T046)', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it('do Kids, o caminho do achado (▶ Editar, OK, Remover PIN, Salvar) não tira o PIN do adulto', async () => {
        await prepararKidsAtivo();
        await montar();

        apertar(DIREITA);  // card Principal → "Editar"
        apertar(ENTER);    // antes: abria o formulário sem pedir nada
        apertar(ENTER);    // OK no campo Nome fecha o teclado da TV
        apertar(BAIXO);    // nome → PIN
        apertar(BAIXO);    // PIN → avatares
        apertar(BAIXO);    // avatares → botões (Cancelar)
        apertar(DIREITA);  // → Salvar
        apertar(DIREITA);  // → 🗑 Remover PIN
        apertar(ENTER);    // marca a remoção
        apertar(ESQUERDA); // ← Salvar
        apertar(ENTER);    // salva

        // Espera o desfecho: ou a porta segurou (PIN na tela; as teclas
        // seguintes viraram dígitos soltos no teclado dela, nada enviado), ou
        // o "Salvar" terminou e o formulário fechou. Só então confere o PIN.
        await waitFor(() => {
            expect(promptDePin() !== null || screen.queryByText('Editar Perfil') === null).toBe(true);
        });
        expect(pinDoAdultoIntacto()).toBe(true);
        expect(promptDePin()).not.toBeNull();
        expect(screen.queryByText('Editar Perfil')).toBeNull();
    });

    it('OK em "Editar" no card alheio pede o PIN dele ANTES de abrir o formulário', async () => {
        await prepararKidsAtivo();
        await montar();

        apertar(DIREITA);
        apertar(ENTER);

        expect(promptDePin()).not.toBeNull();
        expect(screen.getByText('Perfil: Principal')).toBeTruthy();
        // O prompt diz o que o PIN libera — não "Entrar", que é o da troca
        expect(screen.getByText('Editar perfil')).toBeTruthy();
        expect(screen.queryByText('Entrar')).toBeNull();
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        // PIN errado: continua fechado
        digitar('0000');
        expect(await screen.findByText('PIN incorreto.')).toBeTruthy();
        await esvaziarEfeitos();
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        // PIN certo: agora sim, o formulário — do perfil certo
        digitar(PIN_ADULTO);
        expect(await screen.findByText('Editar Perfil')).toBeTruthy();
        expect(promptDePin()).toBeNull();
        expect((screen.getByPlaceholderText('Digite o nome...') as HTMLInputElement).value).toBe('Principal');
        // Provar o PIN pra editar NÃO troca de perfil
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('com o PIN provado, dá pra remover o PIN pelo D-pad (a porta não tranca o dono)', async () => {
        await prepararKidsAtivo();
        await montar();
        apertar(DIREITA);
        apertar(ENTER);
        digitar(PIN_ADULTO);
        await screen.findByText('Editar Perfil');
        await act(async () => { await Promise.resolve(); });

        apertar(ENTER);    // o Nome nasce com o teclado aberto: OK fecha
        apertar(BAIXO);
        apertar(BAIXO);
        apertar(BAIXO);
        apertar(DIREITA);
        apertar(DIREITA);
        apertar(ENTER);    // 🗑 Remover PIN
        expect(screen.getByText('O PIN será removido ao salvar.')).toBeTruthy();
        apertar(ESQUERDA);
        apertar(ENTER);    // Salvar

        await waitFor(() => expect(pinDoAdultoIntacto()).toBe(false));
    });

    it('OK em "Excluir" no card alheio pede o PIN antes do diálogo; errado não abre, certo abre', async () => {
        await prepararKidsAtivo();
        await montar();

        apertar(DIREITA);  // "Editar"
        apertar(DIREITA);  // "Excluir"
        apertar(ENTER);

        expect(promptDePin()).not.toBeNull();
        expect(screen.getByText('Excluir perfil')).toBeTruthy();
        expect(screen.queryByText('Excluir Perfil?')).toBeNull();

        digitar('0000');
        expect(await screen.findByText('PIN incorreto.')).toBeTruthy();
        await esvaziarEfeitos();
        expect(screen.queryByText('Excluir Perfil?')).toBeNull();

        digitar(PIN_ADULTO);
        expect(await screen.findByText('Excluir Perfil?')).toBeTruthy();
        expect(promptDePin()).toBeNull();
        // O diálogo continua nascendo em "Cancelar"; o perfil ainda existe
        const cancelar = screen.getAllByText('Cancelar').find(b => b.closest('.pm-modal-delete'));
        expect(cancelar?.className).toContain('tv-focused');
        expect(profileService.getAllProfiles().some(p => p.id === 'default')).toBe(true);
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');

        // E o diálogo é do perfil CERTO: ▶ Excluir, OK apaga o Principal
        await act(async () => { await Promise.resolve(); });
        apertar(DIREITA);
        apertar(ENTER);
        await waitFor(() => expect(profileService.getAllProfiles().some(p => p.id === 'default')).toBe(false));
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('pelo clique (mouse/ponteiro) os botões Editar e Excluir passam pela mesma porta', async () => {
        await prepararKidsAtivo();
        await montar();

        fireEvent.click(botaoDoCard('Principal', '.pm-btn-edit'));
        expect(promptDePin()).not.toBeNull();
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        apertar(VOLTAR); // cancela o PIN
        await waitFor(() => expect(promptDePin()).toBeNull());
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        fireEvent.click(botaoDoCard('Principal', '.pm-btn-delete'));
        expect(promptDePin()).not.toBeNull();
        expect(screen.queryByText('Excluir Perfil?')).toBeNull();
    });

    it('Voltar no PIN do Editar cancela sem abrir nada e sem trocar de perfil', async () => {
        await prepararKidsAtivo();
        await montar();
        apertar(DIREITA);
        apertar(ENTER);
        expect(promptDePin()).not.toBeNull();

        apertar(VOLTAR);

        await waitFor(() => expect(promptDePin()).toBeNull());
        expect(screen.queryByText('Editar Perfil')).toBeNull();
        expect(screen.getByText('Gerenciar Perfis')).toBeTruthy();
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('do Kids com PIN parental, editar um adulto SEM PIN pede o PIN parental', async () => {
        await prepararKidsAtivo({ pinAdulto: false, parental: true });
        await montar();

        apertar(DIREITA);
        apertar(ENTER);

        expect(promptDePin()).not.toBeNull();
        // O prompt diz o que vai acontecer — não "Sair do modo Kids"
        expect(screen.getByText(/Controle parental/)).toBeTruthy();
        expect(screen.queryByText(/Sair do modo Kids/)).toBeNull();
        expect(screen.getByText('Digite o PIN parental para editar "Principal".')).toBeTruthy();
        expect(screen.getByText('Editar perfil')).toBeTruthy();
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        digitar('0000');
        expect(await screen.findByText('PIN incorreto.')).toBeTruthy();
        await esvaziarEfeitos();
        expect(parentalService.tentativasRestantes()).toBe(4);
        expect(screen.queryByText('Editar Perfil')).toBeNull();

        digitar(PIN_PARENTAL);
        expect(await screen.findByText('Editar Perfil')).toBeTruthy();
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('do Kids com PIN parental e adulto com PIN: pede os dois, como a troca pediria', async () => {
        await prepararKidsAtivo({ pinAdulto: true, parental: true });
        await montar();

        apertar(DIREITA);
        apertar(DIREITA);  // "Excluir"
        apertar(ENTER);

        // 1º o parental, dizendo o que vai acontecer: EXCLUIR, não editar nem entrar
        expect(screen.getByText('Digite o PIN parental para excluir "Principal".')).toBeTruthy();
        expect(screen.getByText('Excluir perfil')).toBeTruthy();

        digitar(PIN_PARENTAL);
        // Passou o parental: vem o PIN do próprio perfil, ainda sem diálogo
        expect(await screen.findByText('Perfil: Principal')).toBeTruthy();
        await esvaziarEfeitos();
        // A ação atravessa os dois prompts: segue sendo "Excluir", não a troca
        expect(screen.getByText('Excluir perfil')).toBeTruthy();
        expect(screen.queryByText('Excluir Perfil?')).toBeNull();

        digitar(PIN_ADULTO);
        expect(await screen.findByText('Excluir Perfil?')).toBeTruthy();
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('Voltar no parental do Editar não deixa a ação presa: o OK no card volta a ser a troca', async () => {
        await prepararKidsAtivo({ pinAdulto: false, parental: true });
        let fechou = false;
        render(<ProfileManager onClose={() => { fechou = true; }} />);
        await screen.findByText('Principal');
        await act(async () => { await Promise.resolve(); });

        apertar(DIREITA);  // "Editar"
        apertar(ENTER);
        expect(screen.getByText('Digite o PIN parental para editar "Principal".')).toBeTruthy();
        apertar(VOLTAR);
        await waitFor(() => expect(promptDePin()).toBeNull());
        expect(screen.queryByText('Editar Perfil')).toBeNull();
        await act(async () => { await Promise.resolve(); });

        apertar(ESQUERDA); // volta pro card
        apertar(ENTER);    // troca de perfil
        expect(screen.getByText(/Sair do modo Kids/)).toBeTruthy();
        expect(screen.getByText('Digite o PIN parental para entrar em "Principal".')).toBeTruthy();
        digitar(PIN_PARENTAL);

        await waitFor(() => expect(fechou).toBe(true));
        expect(profileService.getActiveProfile()?.id).toBe('default');
    });

    it('o perfil ATIVO continua editável sem PIN (quem está nele já passou pela porta)', async () => {
        profileService.initialize();
        expect(await profileService.updateProfile('default', { pin: PIN_ADULTO })).toBe(true);
        await montar();

        apertar(ENTER); // card do Principal, que é o ativo

        expect(promptDePin()).toBeNull();
        expect(screen.getByText('Editar Perfil')).toBeTruthy();
    });

    it('perfil alheio SEM PIN, visto de um perfil adulto, abre direto (nada a provar)', async () => {
        profileService.initialize();
        expect(await profileService.createProfile({ name: 'Visita', avatar: 'B' })).not.toBeNull();
        await montar();

        fireEvent.click(botaoDoCard('Visita', '.pm-btn-edit'));
        expect(promptDePin()).toBeNull();
        expect(screen.getByText('Editar Perfil')).toBeTruthy();

        fireEvent.click(screen.getByText('Cancelar'));
        fireEvent.click(botaoDoCard('Visita', '.pm-btn-delete'));
        expect(promptDePin()).toBeNull();
        expect(screen.getByText('Excluir Perfil?')).toBeTruthy();
    });

    it('a troca de perfil segue igual: PIN certo entra no perfil e fecha', async () => {
        await prepararKidsAtivo();
        let fechou = false;
        render(<ProfileManager onClose={() => { fechou = true; }} />);
        await screen.findByText('Principal');
        await act(async () => { await Promise.resolve(); });

        apertar(ENTER); // card Principal (não é o ativo): troca
        expect(screen.getByText('Perfil: Principal')).toBeTruthy();
        digitar(PIN_ADULTO);

        await waitFor(() => expect(fechou).toBe(true));
        expect(profileService.getActiveProfile()?.id).toBe('default');
    });
});
