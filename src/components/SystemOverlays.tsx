// Overlays de sistema: diagnóstico (item 59) e backup por QR (item 63).
//
// Ambos são telas de leitura com poucas ações — o D-pad percorre uma lista
// curta de botões e Voltar fecha.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { useTVNavigation } from '../hooks/useTVNavigation';
import {
    deviceReport,
    getErrorLog,
    clearErrorLog,
    measureProviderLatency,
    type LoggedError,
} from '../services/diagnostics';
import { measureProviderSpeed, speedVerdict } from '../services/speedTest';
import { accountService } from '../services/accountService';
import { backupSize, MAX_PAYLOAD_BYTES } from '../services/backupService';
import './SystemOverlays.css';

function formatWhen(at: number): string {
    const d = new Date(at);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ===================== Diagnóstico (item 59) =====================

type DiagAction = 'latency' | 'speed' | 'clear' | 'close';

const ACTION_LABELS: Record<DiagAction, string> = {
    latency: '📡 Medir latência',
    speed: '⚡ Testar velocidade',
    clear: '🧹 Limpar erros',
    close: '✕ Fechar',
};

interface DiagnosticsOverlayProps {
    onClose: () => void;
    /** Canal usado como cobaia no teste de velocidade (item 67) */
    speedTestStreamId?: number | null;
}

export function DiagnosticsOverlay({ onClose, speedTestStreamId }: DiagnosticsOverlayProps) {
    const device = useMemo(() => deviceReport(), []);
    const account = useMemo(() => accountService.get(), []);
    const [errors, setErrors] = useState<LoggedError[]>(() => getErrorLog());
    const [latency, setLatency] = useState('—');
    const [speed, setSpeed] = useState('—');
    const [busy, setBusy] = useState(false);
    const [actionIndex, setActionIndex] = useState(0);
    // Fechar a tela no meio do teste tem que SOLTAR a conexão: o provedor
    // conta conexões simultâneas e uma pendurada custa uma tela em outro cômodo
    const speedAbortRef = useRef<AbortController | null>(null);
    // A lista de erros passa de 6 linhas e não há mouse pra rolar
    const errorsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return () => speedAbortRef.current?.abort();
    }, []);

    const actions = useMemo<DiagAction[]>(() => {
        const list: DiagAction[] = ['latency'];
        // Sem canal carregado não há o que baixar pra medir
        if (speedTestStreamId != null) list.push('speed');
        list.push('clear', 'close');
        return list;
    }, [speedTestStreamId]);

    const runLatency = useCallback(async () => {
        setBusy(true);
        setLatency('medindo…');
        const result = await measureProviderLatency();
        setLatency(result.ms != null ? `${result.ms} ms` : (result.error || 'falhou'));
        setBusy(false);
    }, []);

    const runSpeed = useCallback(async () => {
        if (speedTestStreamId == null) return;
        setBusy(true);
        setSpeed('baixando…');
        const controller = new AbortController();
        speedAbortRef.current = controller;
        const result = await measureProviderSpeed(speedTestStreamId, { signal: controller.signal });
        speedAbortRef.current = null;
        setSpeed(result.mbps != null
            ? `${result.mbps.toFixed(1)} Mbps — ${speedVerdict(result.mbps)}`
            : (result.error || 'falhou'));
        setBusy(false);
    }, [speedTestStreamId]);

    const run = useCallback((action: DiagAction) => {
        if (busy) return;
        if (action === 'latency') void runLatency();
        else if (action === 'speed') void runSpeed();
        else if (action === 'clear') { clearErrorLog(); setErrors([]); }
        else onClose();
    }, [busy, runLatency, runSpeed, onClose]);

    useTVNavigation({
        onNavigate: (direction) => {
            if (direction === 'left') setActionIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'right') setActionIndex(prev => Math.min(actions.length - 1, prev + 1));
            // ↑↓ rolam a lista de erros: sem mouse, a partir do 7º item ela
            // era simplesmente inalcançável
            else if (direction === 'down') errorsRef.current?.scrollBy({ top: 90 });
            else if (direction === 'up') errorsRef.current?.scrollBy({ top: -90 });
        },
        onEnter: () => run(actions[actionIndex]),
        // Fechar durante o teste é legítimo — e é o que solta a conexão
        onBack: onClose,
    });

    return (
        <div className="sysov-overlay">
            <div className="sysov-panel">
                <h2 className="sysov-title">🩺 Diagnóstico</h2>

                <div className="sysov-grid">
                    <div className="sysov-row"><span>Versão</span><b>{device.version} ({device.target})</b></div>
                    <div className="sysov-row"><span>Tela</span><b>{device.screen}</b></div>
                    <div className="sysov-row">
                        <span>Memória do aparelho</span>
                        <b>{device.deviceMemoryGb != null ? `${device.deviceMemoryGb} GB` : 'não informada'}</b>
                    </div>
                    <div className="sysov-row">
                        <span>Memória do app</span>
                        <b>{device.heapUsedMb != null ? `${device.heapUsedMb} / ${device.heapLimitMb} MB` : 'não informada'}</b>
                    </div>
                    <div className="sysov-row"><span>Rede</span><b>{device.online ? 'conectada' : 'sem conexão'}</b></div>
                    <div className="sysov-row">
                        <span>Banda estimada pela TV</span>
                        <b>{device.downlinkMbps != null ? `${device.downlinkMbps} Mbps` : 'não informada'}</b>
                    </div>
                    <div className="sysov-row">
                        <span>Dados guardados</span>
                        <b>{device.storageUsedKb != null ? `${device.storageUsedKb} KB` : '—'}</b>
                    </div>
                    <div className="sysov-row"><span>Latência do provedor</span><b>{latency}</b></div>
                    <div className="sysov-row"><span>Velocidade do provedor</span><b>{speed}</b></div>
                    {account && (
                        <div className="sysov-row"><span>Servidor</span><b>{account.serverUrl || '—'}</b></div>
                    )}
                </div>

                <h3 className="sysov-subtitle">
                    Últimos erros ({errors.length}){errors.length > 5 ? ' · ▲▼ rolam' : ''}
                </h3>
                <div className="sysov-errors" ref={errorsRef}>
                    {errors.length === 0 ? (
                        <p className="sysov-empty">Nenhum erro registrado desde que o app abriu.</p>
                    ) : (
                        errors.map((error, index) => (
                            <div key={`${error.at}-${index}`} className="sysov-error">
                                <span className="sysov-error-time">{formatWhen(error.at)}</span>
                                <span className="sysov-error-msg">{error.message}</span>
                                {error.source && <span className="sysov-error-src">{error.source}</span>}
                            </div>
                        ))
                    )}
                </div>

                <div className="sysov-actions">
                    {actions.map((action, index) => (
                        <button
                            key={action}
                            className={`sysov-btn ${index === actionIndex ? 'tv-focused' : ''}`}
                            onClick={() => run(action)}
                        >
                            {ACTION_LABELS[action]}
                        </button>
                    ))}
                </div>
                <div className="sysov-hint">◀ ▶ escolhe · OK executa · Voltar fecha</div>
            </div>
        </div>
    );
}

// ===================== Backup por QR (item 63) =====================

/** Desenha o QR como UM path só: um rect por módulo derrubaria a TV. */
function qrPath(qr: ReturnType<typeof qrcode>, count: number): string {
    const parts: string[] = [];
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
        }
    }
    return parts.join('');
}

interface QrResult {
    count: number;
    path: string;
    bytes: number;
    error?: string;
}

interface QrBackupOverlayProps {
    onClose: () => void;
}

export function QrBackupOverlay({ onClose }: QrBackupOverlayProps) {
    useTVNavigation({ onEnter: onClose, onBack: onClose });

    // useState com inicializador preguicoso em vez de useMemo: gerar o QR e
    // caro e roda UMA vez: o compilador do React nao consegue provar a
    // memoizacao deste bloco (try/catch + laco), e o state resolve sem promessa
    const [result] = useState<QrResult>(() => {
        const { json, bytes, fits } = backupSize();
        if (!fits) {
            return {
                count: 0,
                path: '',
                bytes,
                error: `As preferências ocupam ${bytes} bytes e o limite de um QR legível a distância é ${MAX_PAYLOAD_BYTES}.`,
            };
        }
        try {
            // Correção L: com a TV parada e o celular perto, capacidade vale
            // mais do que resistência a código riscado
            const qr = qrcode(0, 'L');
            qr.addData(json);
            qr.make();
            const count = qr.getModuleCount();
            return { count, path: qrPath(qr, count), bytes };
        } catch (error) {
            return {
                count: 0,
                path: '',
                bytes,
                error: error instanceof Error ? error.message : 'Não foi possível gerar o código.',
            };
        }
    });

    const side = result.count + 4;

    return (
        <div className="sysov-overlay">
            <div className="sysov-panel sysov-panel-qr">
                <h2 className="sysov-title">📱 Backup das preferências</h2>

                {result.error ? (
                    <p className="sysov-empty">{result.error}</p>
                ) : (
                    <div className="sysov-qr-wrap">
                        <svg
                            className="sysov-qr"
                            viewBox={`-2 -2 ${side} ${side}`}
                            shapeRendering="crispEdges"
                        >
                            <rect x="-2" y="-2" width={side} height={side} fill="#fff" />
                            <path d={result.path} fill="#000" />
                        </svg>
                        <p className="sysov-qr-caption">
                            Aponte a câmera do celular e guarde o texto do código.
                            <br />
                            {result.bytes} bytes de ajustes — <b>sem senha, sem endereço do
                            provedor e sem chave do TMDB</b>, porque um código na tela da sala
                            é lido por qualquer câmera do cômodo.
                        </p>
                    </div>
                )}

                <div className="sysov-hint">OK ou Voltar fecha</div>
            </div>
        </div>
    );
}
