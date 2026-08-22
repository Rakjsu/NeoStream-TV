// Trailer (item 18) — SÓ no build de navegador.
//
// Na TV este componente não é usado: ver `abrirExterno` em services/tizenApp.
// O resumo é que o `.wgt` roda em `file://` e um iframe de outra origem que
// ganhe o foco engole o `keydown` do window, que é onde o `useTVNavigation`
// escuta. O usuário ficaria preso no trailer sem seta, sem OK e sem Voltar.
//
// No navegador (dev e build web) o embed funciona e vale a pena, então o
// recurso existe nos dois lugares — por caminhos diferentes.

import { useEffect, useRef } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './TrailerOverlay.css';

interface TrailerOverlayProps {
    /** Chave do vídeo no YouTube (não a URL inteira) */
    youtubeKey: string;
    title: string;
    onClose: () => void;
}

export function TrailerOverlay({ youtubeKey, title, onClose }: TrailerOverlayProps) {
    const painelRef = useRef<HTMLDivElement>(null);

    // O overlay é dono exclusivo das teclas: OK e Voltar fecham.
    useTVNavigation({ onEnter: onClose, onBack: onClose });

    // Tira o foco do iframe a cada montagem. Sem isto, um clique de mouse
    // dentro do player deixaria o foco lá e as teclas parariam de chegar —
    // o mesmo problema que faz o embed não existir na TV, em versão leve.
    useEffect(() => {
        painelRef.current?.focus();
    }, []);

    // youtube-nocookie: não grava histórico de visualização de quem só passou
    // pela ficha. `rel=0` evita a grade de "vídeos relacionados" no fim, que
    // num controle de TV é uma armadilha de foco a mais.
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}`
        + '?autoplay=1&rel=0&modestbranding=1';

    return (
        <div className="trailer-overlay">
            <div className="trailer-painel" ref={painelRef} tabIndex={-1}>
                <div className="trailer-topo">
                    <span className="trailer-titulo">▶ {title}</span>
                    <span className="trailer-dica">OK ou Voltar fecha</span>
                </div>
                <div className="trailer-quadro">
                    <iframe
                        src={src}
                        title={`Trailer de ${title}`}
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                    />
                </div>
            </div>
        </div>
    );
}
