// @vitest-environment jsdom
//
// ➕ Boot: a tela de spinner não aceitava tecla nenhuma.
//
// Enquanto o app confere a credencial salva com o provedor, o App devolvia
// logo + spinner + a palavra "NeoStream" — antes de qualquer FocusContext,
// Sidebar ou useTVNavigation. Num Wi-Fi ruim de TV eram até ~15 s sem dizer o
// que estava fazendo e sem aceitar Voltar: o usuário concluía que travou e
// desligava a TV no botão. A tela seguinte (sem conexão, com "tentar de novo"
// e "usar outro login") só aparecia DEPOIS do prazo estourar.
//
// O teste monta o App DE VERDADE com uma credencial salva e um provedor que
// nunca responde, e dirige a tela pelo teclado como o controle remoto dirige.
import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import App from './App';
import { api } from './services/api';

/** O aviso de "está demorando" aparece passados ~8 s. */
const DEMORANDO_MS = 8000;
/** Prazo de cada tentativa de login no api.authenticate. */
const PRAZO_TENTATIVA_MS = 15000;

interface Pedido {
  url: string;
  signal: AbortSignal;
  /** O provedor finalmente responde (login aceito). Pedido abortado já morreu: não faz nada. */
  responderOk: () => void;
}

let pedidos: Pedido[] = [];

/** Login aceito pelo provedor, no formato do player_api.php. */
const RESPOSTA_OK = {
  user_info: { auth: 1, username: 'u', status: 'Active' },
  server_info: { url: 'provedor.invalid', port: '8080' },
};

/** Provedor mudo: o pedido só termina quando alguém o aborta (ou o teste manda responder). */
function fetchPendurado(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal as AbortSignal;
  return new Promise<Response>((resolve, reject) => {
    pedidos.push({
      url: String(url),
      signal,
      responderOk: () => resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(RESPOSTA_OK),
      } as Response),
    });
    signal.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')));
  });
}

/** Espera a CONDIÇÃO (o vi.waitFor anda o relógio falso a cada conferida). */
async function esperar(condicao: () => void): Promise<void> {
  await act(async () => {
    await vi.waitFor(condicao);
  });
}

/** Voltar do controle da Samsung (key 'XF86Back'). */
function apertarVoltar(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'XF86Back', bubbles: true, cancelable: true }));
  });
}

/** Cada chamada de api.authenticate e se ela já terminou (bem ou mal). */
function vigiarLogins(): { feito: boolean }[] {
  const logins: { feito: boolean }[] = [];
  const original = api.authenticate.bind(api);
  vi.spyOn(api, 'authenticate').mockImplementation((...args: Parameters<typeof api.authenticate>) => {
    const login = { feito: false };
    logins.push(login);
    const promessa = original(...args);
    promessa.then(() => { login.feito = true; }, () => { login.feito = true; });
    return promessa;
  });
  return logins;
}

/** Timers com um prazo específico: quem armou e quem desarmou. */
function vigiarTimers() {
  const armados = new Map<number, unknown[]>();
  const desarmados = new Set<unknown>();
  const armar = globalThis.setTimeout;
  const desarmar = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
    const id = armar(fn, ms, ...args);
    const lista = armados.get(ms ?? 0) ?? [];
    lista.push(id);
    armados.set(ms ?? 0, lista);
    return id;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id?: ReturnType<typeof setTimeout>) => {
    desarmados.add(id);
    desarmar(id);
  }) as typeof clearTimeout);
  return {
    armadosCom: (ms: number) => armados.get(ms) ?? [],
    foiDesarmado: (id: unknown) => desarmados.has(id),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  localStorage.clear();
  sessionStorage.clear();
  // Aparelho já configurado, com login salvo: é o boot de todo dia
  localStorage.setItem('neostream_settings', JSON.stringify({ language: 'pt', autoPlay: true, preferredQuality: 'auto' }));
  localStorage.setItem('neostream_credentials', JSON.stringify({ url: 'http://provedor.invalid:8080', username: 'u', password: 'p' }));
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(fetchPendurado));
  // O console.error do "Auto-login failed" é esperado no caminho do prazo
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('boot com o provedor demorando', () => {
  it('diz o que está fazendo enquanto espera o provedor', async () => {
    render(<App />);
    await esperar(() => expect(pedidos).toHaveLength(1));

    expect(screen.getByText('Conectando ao provedor…')).toBeTruthy();
    expect(screen.getByText('Pressione Voltar para cancelar')).toBeTruthy();
  });

  it('passados ~8 s avisa que está demorando mais que o normal', async () => {
    render(<App />);
    await esperar(() => expect(pedidos).toHaveLength(1));
    expect(screen.queryByText('Está demorando mais que o normal.')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEMORANDO_MS);
    });

    expect(screen.getByText('Está demorando mais que o normal.')).toBeTruthy();
    // Ainda é o spinner: o aviso não encerra a tentativa
    expect(screen.queryByText('Sem conexão com o servidor')).toBeNull();
  });

  it('Voltar no spinner aborta a tentativa e cai na tela de sem conexão, sem esperar o prazo', async () => {
    const timers = vigiarTimers();
    render(<App />);
    await esperar(() => expect(pedidos).toHaveLength(1));

    apertarVoltar();

    await esperar(() => expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy());
    // O pedido ao provedor foi cancelado de verdade, não só escondido
    expect(pedidos[0].signal.aborted).toBe(true);
    // A tela de sem conexão tem as duas saídas
    expect(screen.getByText(/Tentar novamente/)).toBeTruthy();
    expect(screen.getByText(/Usar outro login/)).toBeTruthy();

    // Os cronômetros da tentativa morreram com ela: o do aviso de demora e o
    // prazo de 15 s do login
    const avisos = timers.armadosCom(DEMORANDO_MS);
    const prazos = timers.armadosCom(PRAZO_TENTATIVA_MS);
    expect(avisos).toHaveLength(1);
    expect(prazos).toHaveLength(1);
    expect(timers.foiDesarmado(avisos[0])).toBe(true);
    expect(timers.foiDesarmado(prazos[0])).toBe(true);

    // Cancelar é desistir: o prazo passar não dispara o outro protocolo nem
    // tira o usuário da tela que ele escolheu
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_TENTATIVA_MS * 2);
    });
    expect(pedidos).toHaveLength(1);
    expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy();
    // Desistir não é falha de login: nada de "Auto-login failed" no log
    expect(console.error).not.toHaveBeenCalledWith('Auto-login failed:', expect.anything());
  });

  it('depois de cancelar, "Tentar novamente" faz uma tentativa nova que o cancelamento velho não derruba', async () => {
    render(<App />);
    await esperar(() => expect(pedidos).toHaveLength(1));
    apertarVoltar();
    await esperar(() => expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy());

    // OK na tela de sem conexão (o foco começa em "Tentar novamente")
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    await esperar(() => expect(pedidos).toHaveLength(2));
    expect(pedidos[1].signal.aborted).toBe(false);
    expect(screen.getByText('Conectando ao provedor…')).toBeTruthy();
    expect(screen.queryByText('Sem conexão com o servidor')).toBeNull();

    // E o Voltar continua valendo na tentativa nova
    apertarVoltar();
    await esperar(() => expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy());
    expect(pedidos[1].signal.aborted).toBe(true);
  });

  it('com duas conferências em voo (o StrictMode do main.tsx roda o efeito duas vezes) só a última vale, e o Voltar derruba as duas', async () => {
    const logins = vigiarLogins();
    render(<StrictMode><App /></StrictMode>);
    await esperar(() => expect(pedidos).toHaveLength(2));

    // A 1ª foi substituída pela 2ª: morre calada, sem tirar o usuário do spinner
    await esperar(() => expect(logins[0]?.feito).toBe(true));
    expect(pedidos[0].signal.aborted).toBe(true);
    expect(pedidos[1].signal.aborted).toBe(false);
    expect(screen.getByText('Conectando ao provedor…')).toBeTruthy();
    expect(screen.queryByText('Sem conexão com o servidor')).toBeNull();

    apertarVoltar();
    await esperar(() => expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy());
    expect(pedidos.every(p => p.signal.aborted)).toBe(true);

    // O provedor responder agora não tira o usuário da tela que ele escolheu
    pedidos.forEach(p => p.responderOk());
    await esperar(() => expect(logins.every(l => l.feito)).toBe(true));
    expect(screen.getByText('Sem conexão com o servidor')).toBeTruthy();
    expect(pedidos).toHaveLength(2);
  });
});
