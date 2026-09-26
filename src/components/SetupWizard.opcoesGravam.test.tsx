// @vitest-environment jsdom
//
// T116: o assistente de primeira configuração tinha uma etapa "Capas e
// sinopses (opcional)" cujas DUAS opções eram o mesmo `apply: () => { }` —
// "Tenho uma chave — configuro depois" e "Não vou usar TMDB" levavam ao mesmo
// lugar, e a pessoa saía do assistente exatamente como entrou. O campo da chave
// continua onde sempre esteve (Configurações → Integração TMDB).
//
// O contrato aqui é geral, não "a etapa X sumiu": no assistente, escolher uma
// opção que AINDA NÃO está marcada tem de gravar ESSA escolha — reabrindo o
// assistente, é ela que aparece marcada. Uma etapa nova que só enfeita falha
// dizendo qual etapa e qual opção.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { SetupWizard } from './SetupWizard';
import { themeService, ACCENTS, BACKGROUNDS, type AccentId, type BackgroundId } from '../services/themeService';
import { a11yService } from '../services/a11yService';

/** Flag de "assistente concluído": muda ao TERMINAR, não ao escolher. */
const FLAG_CONCLUIDO = 'neostream_wizard_done';

function tecla(key: string) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/** Anda o assistente com ▼ (avança SEM escolher) e devolve o título de cada etapa. */
function titulosDasEtapas(): string[] {
    const onFinish = vi.fn();
    const { container, unmount } = render(<SetupWizard onFinish={onFinish} />);
    const titulos: string[] = [];
    // Teto só pra não girar pra sempre se o ▼ parar de avançar
    while (!onFinish.mock.calls.length && titulos.length < 20) {
        titulos.push(container.querySelector('.wizard-title')?.textContent ?? '');
        tecla('ArrowDown');
    }
    unmount();
    expect(onFinish).toHaveBeenCalledTimes(1);
    return titulos;
}

/** Monta um assistente novo (lê o que está gravado) parado na etapa pedida. */
function abrirNaEtapa(etapa: number, titulo: string) {
    const montado = render(<SetupWizard onFinish={() => { /* não interessa */ }} />);
    for (let i = 0; i < etapa; i++) tecla('ArrowDown');
    expect(montado.container.querySelector('.wizard-title')?.textContent).toBe(titulo);
    const opcoes = () => Array.from(montado.container.querySelectorAll('.wizard-option'));
    return { ...montado, opcoes };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('SetupWizard — toda opção do assistente vale alguma coisa (T116)', () => {
    it('escolher uma opção não marcada grava ESSA escolha, em todas as etapas', () => {
        const titulos = titulosDasEtapas();
        expect(titulos.length).toBeGreaterThan(0);

        const enfeites: string[] = [];
        const semEscolha: string[] = [];

        titulos.forEach((titulo, etapa) => {
            const sonda = abrirNaEtapa(etapa, titulo);
            const total = sonda.opcoes().length;
            sonda.unmount();

            let conferidas = 0;
            for (let opcao = 0; opcao < total; opcao++) {
                localStorage.clear();
                const escolha = abrirNaEtapa(etapa, titulo);
                for (let i = 0; i < opcao; i++) tecla('ArrowRight');

                // O ▶ tem de levar o foco à opção da vez, não a uma qualquer
                const alvo = escolha.opcoes()[opcao];
                expect(alvo.classList.contains('tv-focused'), `etapa "${titulo}": o foco não chegou à opção ${opcao}`).toBe(true);
                const rotulo = alvo.textContent ?? '';
                if (alvo.classList.contains('selected')) {
                    // Já é o valor atual: confirmar não tem o que mudar
                    escolha.unmount();
                    continue;
                }

                tecla('Enter');
                escolha.unmount();
                conferidas++;

                // Reabre do zero: só o que foi GRAVADO chega aqui
                const reaberto = abrirNaEtapa(etapa, titulo);
                const marcadas = reaberto.opcoes()
                    .filter(el => el.classList.contains('selected'))
                    .map(el => el.textContent ?? '');
                reaberto.unmount();
                if (marcadas.length !== 1 || marcadas[0] !== rotulo) {
                    enfeites.push(`etapa "${titulo}" → opção "${rotulo}" (reaberto marca: ${JSON.stringify(marcadas)})`);
                }
            }
            // Etapa em que tudo já vem marcado não oferece escolha nenhuma
            if (conferidas === 0) semEscolha.push(titulo);
        });

        expect(semEscolha, `etapas sem nenhuma opção a escolher: ${semEscolha.join(', ')}`).toEqual([]);
        expect(enfeites, `opções que não gravam a escolha:\n${enfeites.join('\n')}`).toEqual([]);
    });

    it('as etapas são fundo, cor e tamanho, e cada uma grava no serviço que o título promete', () => {
        // O teste genérico acima não vê uma etapa boa sumir junto com a do
        // TMDB, nem as opções de uma etapa aparecerem sob o título de outra:
        // aqui cada título fica amarrado ao serviço que ele configura
        const servicoDa: Record<string, { ler: () => string; rotuloDe: (valor: string) => string }> = {
            'Fundo da tela': { ler: () => themeService.getBackground(), rotuloDe: v => BACKGROUNDS[v as BackgroundId] },
            'Cor de destaque': { ler: () => themeService.getAccent(), rotuloDe: v => ACCENTS[v as AccentId].label },
            'Tamanho da interface': { ler: () => String(a11yService.getTextScale()), rotuloDe: v => `${v}%` },
        };
        const titulos = titulosDasEtapas();
        expect(titulos).toEqual(Object.keys(servicoDa));

        titulos.forEach((titulo, etapa) => {
            const { ler, rotuloDe } = servicoDa[titulo];
            localStorage.clear();
            const escolha = abrirNaEtapa(etapa, titulo);
            const opcoes = escolha.opcoes();
            const alvo = opcoes.findIndex(el => !el.classList.contains('selected'));
            expect(alvo, `etapa "${titulo}" sem opção a escolher`).toBeGreaterThanOrEqual(0);
            const rotulo = opcoes[alvo].textContent ?? '';
            for (let i = 0; i < alvo; i++) tecla('ArrowRight');

            const antes = ler();
            tecla('Enter');
            escolha.unmount();
            const depois = ler();
            expect(depois, `etapa "${titulo}" não mexeu no próprio serviço`).not.toBe(antes);
            expect(rotuloDe(depois), `etapa "${titulo}" gravou outra opção`).toBe(rotulo);
        });
    });

    it('etapa que fala do TMDB tem onde pôr a chave', () => {
        const titulos = titulosDasEtapas();
        const sonda = render(<SetupWizard onFinish={() => { /* não interessa */ }} />);
        const trilha = sonda.container.querySelector('.wizard-steps')?.textContent ?? '';
        sonda.unmount();

        // A trilha do topo lista as mesmas etapas que o ▼ percorre
        for (const titulo of titulos) expect(trilha).toContain(titulo);

        const semCampo: string[] = [];
        titulos.forEach((titulo, etapa) => {
            const { container, unmount } = abrirNaEtapa(etapa, titulo);
            const texto = container.querySelector('.wizard-panel')?.textContent ?? '';
            if (/TMDB/i.test(texto) && !container.querySelector('.wizard-panel input')) semCampo.push(titulo);
            unmount();
        });
        expect(semCampo, `etapas que prometem o TMDB sem campo para a chave: ${semCampo.join(', ')}`).toEqual([]);
    });

    it('confirmar a última etapa conclui uma vez só e solta o controle remoto ao desmontar', () => {
        const titulos = titulosDasEtapas();
        localStorage.clear();

        const onFinish = vi.fn();
        const { unmount } = render(<SetupWizard onFinish={onFinish} />);
        for (let i = 0; i < titulos.length; i++) tecla('Enter');

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(FLAG_CONCLUIDO)).toBe('1');

        // O App desmonta o assistente no onFinish: dali em diante as teclas
        // são das páginas, não dele
        unmount();
        tecla('Enter');
        tecla('Backspace');
        expect(onFinish).toHaveBeenCalledTimes(1);
    });
});
