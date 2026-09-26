// @vitest-environment jsdom
//
// T064: o cache do EPG é chaveado SÓ pelo stream_id, e ids Xtream começam em 1
// em todo provedor. Quem saía da conta e entrava noutra na mesma sessão (ou
// adicionava uma playlist, que autentica por cima SEM logout) via na grade
// da conta nova os programas da ANTERIOR, por até 5-10 minutos, sem erro.
//
// Aqui o api é o DE VERDADE (logout, authenticate, makeRequest): só o fetch é
// falso, e responde dizendo de qual conta (usuário@servidor) veio o programa.
// Assim o teste prova a ligação inteira api -> registro de caches ->
// epgService, e não um clearCache chamado à mão.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { epgService } from './epgService';

const SERVIDOR_A = 'http://provedor-a.test';
const SERVIDOR_B = 'http://provedor-b.test';
const CANAL = 1; // o mesmo id nas duas contas: é o caso comum

const b64 = (texto: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(texto)));

/** Identidade da conta que o fetch falso usa pra carimbar o programa. */
const conta = (servidor: string, usuario = 'usuario-teste') =>
    `${usuario}@${new URL(servidor).host}`;
const programaDe = (servidor: string, usuario?: string) =>
    `Programa de ${conta(servidor, usuario)}`;

/** Um programa "no ar agora", com o título dizendo de qual conta veio. */
function listagem(titulo: string) {
    const agora = Math.floor(Date.now() / 1000);
    return {
        epg_listings: [{
            title: b64(titulo),
            start_timestamp: agora - 600,
            stop_timestamp: agora + 3000,
        }],
    };
}

function resposta(corpo: unknown) {
    const texto = JSON.stringify(corpo);
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => corpo,
        text: async () => texto,
    };
}

const AUTH_OK = { user_info: { auth: 1, status: 'Active' }, server_info: {} };
const AUTH_RECUSADO = { user_info: { auth: 0 } };
const SENHA_ERRADA = 'senha-errada';

/** Contas cujas respostas de EPG ficam presas até o teste soltar ("em voo"). */
let prender = new Set<string>();
/** Contas cujo LOGIN fica preso até o teste soltar `login:<conta>`. */
let prenderLogin = new Set<string>();
let segurar: { conta: string; soltar: () => void }[] = [];

const fetchFalso = vi.fn(async (entrada: string) => {
    const url = new URL(entrada);
    const acao = url.searchParams.get('action');
    const quem = `${url.searchParams.get('username')}@${url.host}`;
    if (!acao) {
        if (url.searchParams.get('password') === SENHA_ERRADA) return resposta(AUTH_RECUSADO);
        if (prenderLogin.has(quem)) {
            return new Promise(resolve => {
                segurar.push({ conta: `login:${quem}`, soltar: () => resolve(resposta(AUTH_OK)) });
            });
        }
        return resposta(AUTH_OK);
    }
    const titulo = `Programa de ${quem}`;
    const corpo = listagem(acao === 'get_simple_data_table' ? `${titulo} (dia)` : titulo);
    if (prender.has(quem)) {
        return new Promise(resolve => {
            segurar.push({ conta: quem, soltar: () => resolve(resposta(corpo)) });
        });
    }
    return resposta(corpo);
});

function soltar(deQuem: string) {
    segurar.filter(s => s.conta === deQuem).forEach(s => s.soltar());
}

const pedidosDeEpgPara = (quem: string) =>
    fetchFalso.mock.calls.filter(([u]) => {
        const url = new URL(u);
        return `${url.searchParams.get('username')}@${url.host}` === quem
            && url.searchParams.get('action') === 'get_short_epg';
    }).length;

async function entrar(servidor: string, usuario = 'usuario-teste') {
    await api.authenticate(servidor, usuario, 'senha-teste');
}

const tituloAgora = async () => (await epgService.getChannelEpg(CANAL)).now?.title;
const tituloDoDia = async () => (await epgService.getDayEpg(CANAL))[0]?.title;

beforeEach(() => {
    vi.stubGlobal('fetch', fetchFalso);
    fetchFalso.mockClear();
    prender = new Set();
    prenderLogin = new Set();
    segurar = [];
    localStorage.clear();
    api.logout();
    // Isola os testes entre si; DENTRO de cada um só logout/authenticate limpam
    epgService.clearCache();
});

afterEach(() => {
    segurar.forEach(s => s.soltar());
    api.logout();
    vi.unstubAllGlobals();
});

describe('EPG x troca de conta (T064)', () => {
    it('logout e login noutro provedor: o mesmo stream_id busca o EPG da conta NOVA', async () => {
        await entrar(SERVIDOR_A);
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A));

        api.logout();
        // Só o logout já solta o EPG da conta que saiu (sem conta, nem há o
        // que buscar: vem vazio em vez do programa do A)
        expect(await tituloAgora()).toBeUndefined();
        await entrar(SERVIDOR_B);

        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_B));
        expect(pedidosDeEpgPara(conta(SERVIDOR_B))).toBe(1);
    });

    it('a agenda do dia (cache próprio) também cai no logout', async () => {
        await entrar(SERVIDOR_A);
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_A)} (dia)`);

        api.logout();
        expect(await tituloDoDia()).toBeUndefined();
        await entrar(SERVIDOR_B);

        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_B)} (dia)`);
    });

    it('adicionar playlist (authenticate por cima, SEM logout) também troca o EPG', async () => {
        await entrar(SERVIDOR_A);
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A));
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_A)} (dia)`);

        await entrar(SERVIDOR_B);

        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_B));
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_B)} (dia)`);
    });

    it('mesmo servidor com OUTRO usuário, sem logout: EPG do usuário novo', async () => {
        await entrar(SERVIDOR_A, 'usuario-um');
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A, 'usuario-um'));

        await entrar(SERVIDOR_A, 'usuario-dois');

        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A, 'usuario-dois'));
    });

    it('pedido da conta velha em voo no logout não é reaproveitado pela nova', async () => {
        await entrar(SERVIDOR_A);
        prender.add(conta(SERVIDOR_A));
        const doA = epgService.getChannelEpg(CANAL);
        await vi.waitFor(() => expect(segurar).toHaveLength(1));

        api.logout();
        await entrar(SERVIDOR_B);

        // Antes o dedupe de "em voo" devolvia a promessa do A pro B
        const doB = epgService.getChannelEpg(CANAL);
        soltar(conta(SERVIDOR_A));
        expect((await doB).now?.title).toBe(programaDe(SERVIDOR_B));
        // Quem pediu na conta velha ainda recebe a resposta dela (não fica pendurado)
        expect((await doA).now?.title).toBe(programaDe(SERVIDOR_A));
    });

    it('resposta da conta velha que chega DEPOIS do login na nova não vai pro cache', async () => {
        await entrar(SERVIDOR_A);
        prender.add(conta(SERVIDOR_A));
        const doA = epgService.getChannelEpg(CANAL);
        const diaDoA = epgService.getDayEpg(CANAL);
        await vi.waitFor(() => expect(segurar).toHaveLength(2));

        api.logout();
        await entrar(SERVIDOR_B);
        // O provedor velho responde só agora, com a conta nova já ativa
        soltar(conta(SERVIDOR_A));
        // Quem pediu recebe a resposta que pediu; só o cache não fica com ela
        expect((await doA).now?.title).toBe(programaDe(SERVIDOR_A));
        expect((await diaDoA)[0]?.title).toBe(`${programaDe(SERVIDOR_A)} (dia)`);

        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_B));
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_B)} (dia)`);
    });

    it('resposta atrasada da conta velha não desfaz o dedupe do pedido da nova', async () => {
        await entrar(SERVIDOR_A);
        prender.add(conta(SERVIDOR_A));
        const doA = epgService.getChannelEpg(CANAL);
        await vi.waitFor(() => expect(segurar).toHaveLength(1));

        api.logout();
        await entrar(SERVIDOR_B);
        prender.add(conta(SERVIDOR_B));
        const doB1 = epgService.getChannelEpg(CANAL);
        await vi.waitFor(() => expect(segurar).toHaveLength(2));

        // O A termina enquanto o B ainda está em voo: o "em voo" é do B agora
        soltar(conta(SERVIDOR_A));
        await doA;
        const doB2 = epgService.getChannelEpg(CANAL);

        soltar(conta(SERVIDOR_B));
        expect((await doB1).now?.title).toBe(programaDe(SERVIDOR_B));
        expect((await doB2).now?.title).toBe(programaDe(SERVIDOR_B));
        expect(pedidosDeEpgPara(conta(SERVIDOR_B))).toBe(1);
    });

    it('EPG pedido enquanto o login da conta nova ainda não respondeu não fica pra ela', async () => {
        await entrar(SERVIDOR_A);
        prenderLogin.add(conta(SERVIDOR_B));
        const login = entrar(SERVIDOR_B);
        await vi.waitFor(() => expect(segurar).toHaveLength(1));

        // O servidor novo ainda não respondeu: a conta ativa continua a A, e o
        // EPG que chega agora é (corretamente) dela
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A));
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_A)} (dia)`);

        // A troca de conta é no SUCESSO do login: é aí que o cache tem de cair
        soltar(`login:${conta(SERVIDOR_B)}`);
        await login;
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_B));
        expect(await tituloDoDia()).toBe(`${programaDe(SERVIDOR_B)} (dia)`);
    });

    it('login recusado (senha errada ao adicionar playlist) não joga fora o EPG da conta ativa', async () => {
        await entrar(SERVIDOR_A);
        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A));

        await expect(api.authenticate(SERVIDOR_B, 'usuario-teste', SENHA_ERRADA)).rejects.toThrow();

        expect(await tituloAgora()).toBe(programaDe(SERVIDOR_A));
        expect(pedidosDeEpgPara(conta(SERVIDOR_A))).toBe(1);
    });
});

// Espera em "em voo" por CONDIÇÃO (vi.waitFor até o fetch estar preso), sem contar microtasks.
// Os hosts .test e as credenciais usuario-*/senha-teste são fictícios; não há dado real.
