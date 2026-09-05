// Grade de programação multi-canal (backlog item 1) — o guia clássico:
// canais nas linhas, tempo nas colunas.
//
// Duas decisões que definem o componente:
//
// 1. **EPG preguiçoso por linha visível.** Uma lista de canais Xtream tem
//    centenas de entradas e o `get_simple_data_table` é UMA requisição por
//    canal. Buscar tudo travaria a TV por minutos e derrubaria o painel do
//    provedor. Aqui só as linhas na tela (mais uma margem pequena, pra rolagem
//    não piscar) são buscadas, e o resultado fica em cache no epgService.
//
// 2. **A janela de tempo anda, a lista de canais rola.** São dois eixos
//    independentes num controle que só tem quatro setas: ←→ caminham pelos
//    programas da linha e empurram a janela quando chegam na borda; ↑↓ trocam
//    de canal mantendo o horário. É o que o usuário de TV já espera.

import { useState, useEffect, useRef, useCallback } from 'react';
import { epgService, type EpgProgram } from '../services/epgService';
import {
    programasNaJanela, faixaDoPrograma, noAr, alinharJanela, indiceNoInstante,
    instanteNaJanela, moverJanela as moverJanelaPura, podarPorAlcance,
} from '../services/epgGridLayout';
import { useTVNavigation } from '../hooks/useTVNavigation';
import type { LiveStream } from '../types';
import './EpgGrid.css';

/** Linhas de canal visíveis ao mesmo tempo. */
const LINHAS_VISIVEIS = 7;
/** Margem de linhas buscadas além das visíveis (rolar não deve piscar). */
const MARGEM_LINHAS = 3;
/** Largura da janela de tempo. */
const JANELA_MS = 150 * 60 * 1000; // 2h30
/** Passo do deslocamento da janela. */
const PASSO_MS = 30 * 60 * 1000;
/** Quantas requisições de EPG em paralelo. Painel Xtream não gosta de mais. */
const PARALELAS = 3;

function relogio(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const alinhar = (ms: number) => alinharJanela(ms, PASSO_MS);

interface EpgGridProps {
    channels: LiveStream[];
    onClose: () => void;
    onPlay: (channel: LiveStream) => void;
    /** Tocar do arquivo (a página monta a URL de timeshift) */
    onPlayArchive: (channel: LiveStream, programs: EpgProgram[], index: number) => void;
    /** Liga/desliga lembrete; devolve se ficou ativo */
    onToggleReminder: (channel: LiveStream, program: EpgProgram) => boolean;
    isReminded: (channel: LiveStream, program: EpgProgram) => boolean;
    /** Canal que começa em foco (o que estava selecionado na página) */
    initialChannelId?: number;
}

export function EpgGrid({
    channels, onClose, onPlay, onPlayArchive, onToggleReminder, isReminded, initialChannelId,
}: EpgGridProps) {
    // Date.now() no render viola react-hooks/purity — congelado em state e
    // atualizado por tick (a linha do AGORA precisa andar sozinha)
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [janelaInicio, setJanelaInicio] = useState(() => alinhar(Date.now()));
    const [linha, setLinha] = useState(() => {
        const i = channels.findIndex(c => c.stream_id === initialChannelId);
        return i >= 0 ? i : 0;
    });
    // O foco é ancorado num INSTANTE, não num índice de coluna. Índice se
    // perde: o EPG chega linha a linha, e descer de canal antes de a linha
    // carregar deixaria a lista vazia e o índice cairia pra 0 — a posição no
    // tempo evaporava a cada canal. Com o instante, descer mantém o horário e
    // o programa certo acende sozinho quando o EPG daquela linha chega.
    const [instanteFoco, setInstanteFoco] = useState(() => Date.now());
    const [epgPorCanal, setEpgPorCanal] = useState<Map<number, EpgProgram[]>>(new Map());
    const [carregando, setCarregando] = useState<Set<number>>(new Set());
    const [aviso, setAviso] = useState('');
    // Ligar/desligar lembrete não muda nenhum state próprio: este contador é o
    // que faz o ⏰ aparecer no bloco
    const [lembreteTick, setLembreteTick] = useState(0);
    void lembreteTick;

    const janelaFim = janelaInicio + JANELA_MS;
    const buscadosRef = useRef<Set<number>>(new Set());

    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);

    // A faixa visível é DERIVADA da linha focada (nada de state nem effect:
    // setState dentro de effect é proibido pelo lint do projeto). A linha
    // focada fica no meio, que é o que dá contexto de cima e de baixo.
    const primeiraLinha = Math.max(
        0,
        Math.min(
            Math.max(0, channels.length - LINHAS_VISIVEIS),
            linha - Math.floor(LINHAS_VISIVEIS / 2)
        )
    );

    // ---- EPG preguiçoso: só o que está (quase) na tela ----
    useEffect(() => {
        const inicio = Math.max(0, primeiraLinha - MARGEM_LINHAS);
        const fim = Math.min(channels.length, primeiraLinha + LINHAS_VISIVEIS + MARGEM_LINHAS);
        const pendentes = channels
            .slice(inicio, fim)
            .filter(canal => !buscadosRef.current.has(canal.stream_id));
        if (pendentes.length === 0) return;

        let cancelado = false;
        pendentes.forEach(canal => buscadosRef.current.add(canal.stream_id));
        setCarregando(prev => {
            const proximo = new Set(prev);
            pendentes.forEach(canal => proximo.add(canal.stream_id));
            return proximo;
        });

        // Fila com concorrência limitada: disparar 10 requisições de uma vez
        // faz painel Xtream devolver 521 e a grade nasce vazia
        const fila = [...pendentes];
        const trabalhador = async () => {
            while (fila.length > 0 && !cancelado) {
                const canal = fila.shift();
                if (!canal) return;
                const programas = await epgService.getDayEpg(canal.stream_id);
                if (cancelado) return;
                setEpgPorCanal(prev => podarPorAlcance(
                    new Map(prev).set(canal.stream_id, programas),
                    channels, inicio, fim, buscadosRef.current
                ));
                setCarregando(prev => {
                    const proximo = new Set(prev);
                    proximo.delete(canal.stream_id);
                    return proximo;
                });
            }
        };
        void Promise.all(Array.from({ length: PARALELAS }, trabalhador));

        return () => { cancelado = true; };
    }, [primeiraLinha, channels]);

    const canalAtual = channels[linha];
    const programasDoCanal = canalAtual ? epgPorCanal.get(canalAtual.stream_id) : undefined;

    /** Programas que aparecem na janela atual, na ordem do relógio. */
    const naJanela = useCallback((streamId: number): EpgProgram[] => {
        const todos = epgPorCanal.get(streamId);
        if (!todos) return [];
        return programasNaJanela(todos, janelaInicio, janelaFim);
    }, [epgPorCanal, janelaInicio, janelaFim]);

    const visiveisDaLinha = canalAtual ? naJanela(canalAtual.stream_id) : [];
    const colunaFocada = indiceNoInstante(visiveisDaLinha, instanteFoco);
    const focado: EpgProgram | undefined =
        colunaFocada >= 0 ? visiveisDaLinha[colunaFocada] : undefined;

    /**
     * Anda com a janela E com o foco juntos: separá-los tira o foco da tela.
     * A conta fica FORA do updater — updater de setState tem que ser puro, e
     * disparar outro setState lá dentro roda duas vezes em modo estrito.
     */
    const moverJanela = useCallback((passos: number) => {
        const proxima = moverJanelaPura(janelaInicio, passos, PASSO_MS, nowMs);
        const andou = proxima - janelaInicio;
        if (andou === 0) return; // já está no limite
        setJanelaInicio(proxima);
        setInstanteFoco(atual => instanteNaJanela(atual + andou, proxima, JANELA_MS));
    }, [janelaInicio, nowMs]);

    const navegar = (direcao: 'up' | 'down' | 'left' | 'right') => {
        setAviso('');
        if (direcao === 'up') {
            setLinha(prev => Math.max(0, prev - 1));
            return;
        }
        if (direcao === 'down') {
            setLinha(prev => Math.min(channels.length - 1, prev + 1));
            return;
        }
        if (direcao === 'right') {
            const proximo = visiveisDaLinha[colunaFocada + 1];
            // Cai no INÍCIO do próximo programa; na borda (ou sem EPG) é a
            // janela que anda, levando o foco junto
            if (proximo) setInstanteFoco(proximo.start);
            else moverJanela(1);
            return;
        }
        const anterior = colunaFocada > 0 ? visiveisDaLinha[colunaFocada - 1] : undefined;
        if (anterior) setInstanteFoco(anterior.start);
        else moverJanela(-1);
    };

    const confirmar = () => {
        if (!canalAtual) return;
        if (!focado) {
            // Linha sem EPG: OK ainda assim assiste ao canal — é o que a
            // pessoa queria de qualquer jeito
            onPlay(canalAtual);
            return;
        }
        if (noAr(focado, nowMs)) {
            onPlay(canalAtual);
            return;
        }
        if (focado.end <= nowMs) {
            const temArquivo = Number(canalAtual.tv_archive) > 0 && focado.hasArchive !== false;
            if (!temArquivo) {
                setAviso('Este canal não guarda programas passados.');
                return;
            }
            const todos = programasDoCanal || [];
            const index = todos.findIndex(p => p.start === focado.start);
            if (index >= 0) onPlayArchive(canalAtual, todos, index);
            return;
        }
        // Futuro: lembrete
        const ativo = onToggleReminder(canalAtual, focado);
        setLembreteTick(t => t + 1);
        setAviso(ativo ? '⏰ Lembrete criado.' : 'Lembrete removido.');
    };

    useTVNavigation({
        onNavigate: navegar,
        onEnter: confirmar,
        onBack: onClose,
        onAction: (acao) => {
            if (acao === 'red') moverJanela(-2);          // 🔴 −1 h
            else if (acao === 'green') moverJanela(2);    // 🟢 +1 h
            else if (acao === 'yellow') {                 // 🟡 volta pro agora
                setJanelaInicio(alinhar(nowMs));
                setInstanteFoco(nowMs);
                setAviso('');
            } else if (acao === 'blue' && canalAtual) {   // 🔵 assiste já
                onPlay(canalAtual);
            }
        },
    });

    // Régua: uma marca a cada 30 min
    const marcas: number[] = [];
    for (let t = janelaInicio; t < janelaFim; t += PASSO_MS) marcas.push(t);

    const pct = (ms: number) => ((ms - janelaInicio) / JANELA_MS) * 100;
    const agoraPct = pct(nowMs);
    const linhasVisiveis = channels.slice(primeiraLinha, primeiraLinha + LINHAS_VISIVEIS);

    const rotuloDia = new Date(janelaInicio).toDateString() === new Date(nowMs).toDateString()
        ? 'Hoje'
        : new Date(janelaInicio).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });

    return (
        <div className="epgrid-overlay">
            <div className="epgrid-panel">
                <div className="epgrid-header">
                    <h2 className="epgrid-title">📊 Guia de programação</h2>
                    <span className="epgrid-day">{rotuloDia}</span>
                </div>

                {/* Régua de horas */}
                <div className="epgrid-ruler">
                    <div className="epgrid-ruler-gutter" />
                    <div className="epgrid-ruler-track">
                        {marcas.map(t => (
                            <span key={t} className="epgrid-tick" style={{ left: `${pct(t)}%` }}>
                                {relogio(t)}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Linhas de canal */}
                <div className="epgrid-rows">
                    {agoraPct >= 0 && agoraPct <= 100 && (
                        <div className="epgrid-now-layer">
                            <div className="epgrid-now-line" style={{ left: `${agoraPct}%` }} />
                        </div>
                    )}

                    {linhasVisiveis.map((canal, i) => {
                        const index = primeiraLinha + i;
                        const ehLinhaFocada = index === linha;
                        const programas = naJanela(canal.stream_id);
                        const buscando = carregando.has(canal.stream_id);
                        const jaVeio = epgPorCanal.has(canal.stream_id);

                        return (
                            <div
                                key={canal.stream_id}
                                className={`epgrid-row ${ehLinhaFocada ? 'is-focused-row' : ''}`}
                            >
                                <div className="epgrid-channel">
                                    {canal.stream_icon
                                        ? <img className="epgrid-logo" src={canal.stream_icon} alt="" loading="lazy" />
                                        : <span className="epgrid-logo epgrid-logo-empty">📺</span>}
                                    <span className="epgrid-channel-name">{canal.name}</span>
                                </div>

                                <div className="epgrid-track">
                                    {programas.length === 0 && (
                                        <div className="epgrid-empty">
                                            {buscando || !jaVeio ? 'Carregando…' : 'Sem programação'}
                                        </div>
                                    )}
                                    {programas.map((programa, pIndex) => {
                                        // Já vem recortado na borda da janela: um programa de
                                        // 3h numa janela de 2h30 não pode vazar pra fora
                                        const { left, width } = faixaDoPrograma(programa, janelaInicio, JANELA_MS);
                                        const estaNoAr = noAr(programa, nowMs);
                                        const passado = programa.end <= nowMs;
                                        const focadoAqui = ehLinhaFocada && pIndex === colunaFocada;
                                        const comLembrete = programa.start > nowMs
                                            && isReminded(canal, programa);

                                        return (
                                            <div
                                                key={`${programa.start}-${pIndex}`}
                                                className={`epgrid-prog${estaNoAr ? ' is-live' : ''}`
                                                    + `${passado ? ' is-past' : ''}`
                                                    + `${focadoAqui ? ' tv-focused' : ''}`}
                                                style={{ left: `${left}%`, width: `${width}%` }}
                                                title={programa.title}
                                            >
                                                <span className="epgrid-prog-time">{relogio(programa.start)}</span>
                                                <span className="epgrid-prog-title">
                                                    {comLembrete ? '⏰ ' : ''}{programa.title}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Detalhe do programa focado */}
                <div className="epgrid-detail">
                    {focado ? (
                        <>
                            <div className="epgrid-detail-head">
                                <span className="epgrid-detail-title">{focado.title}</span>
                                <span className="epgrid-detail-time">
                                    {relogio(focado.start)} – {relogio(focado.end)}
                                </span>
                            </div>
                            {focado.description && (
                                <p className="epgrid-detail-desc">{focado.description}</p>
                            )}
                        </>
                    ) : (
                        <span className="epgrid-detail-title">
                            {canalAtual ? canalAtual.name : 'Nenhum canal'}
                        </span>
                    )}
                    {aviso && <span className="epgrid-aviso">{aviso}</span>}
                </div>

                <div className="epgrid-hints">
                    <span>OK: no ar assiste · passado abre o arquivo · futuro cria lembrete</span>
                    <span className="hint-red">🔴 −1h</span>
                    <span className="hint-green">🟢 +1h</span>
                    <span className="hint-yellow">🟡 Agora</span>
                    <span className="hint-blue">🔵 Assistir</span>
                    <span>Voltar fecha</span>
                </div>
            </div>
        </div>
    );
}
