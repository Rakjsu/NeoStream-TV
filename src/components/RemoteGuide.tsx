// Guia do controle remoto (item 57).
//
// Numa TV não existe tooltip nem menu de atalhos: o usuário descobre por
// tentativa e erro, e as color keys ficam invisíveis. Este overlay é a única
// documentação que ele vai ler.
//
// ATENÇÃO ao editar: as color keys mudam de significado por tela (LiveTV usa
// as quatro; Filmes e Séries usam só a 🟡). Guia errado é pior que guia nenhum.

import { useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './RemoteGuide.css';

interface KeyRow {
    keys: string;
    what: string;
}

interface GuideSection {
    title: string;
    rows: KeyRow[];
}

const SECTIONS: GuideSection[] = [
    {
        title: 'Em qualquer tela',
        rows: [
            { keys: '▲ ▼ ◀ ▶', what: 'Navegar entre os itens' },
            { keys: 'OK', what: 'Abrir / confirmar o item em foco' },
            { keys: 'VOLTAR', what: 'Fechar o que está aberto ou voltar' },
            { keys: '◀ na borda', what: 'Abrir o menu lateral' },
        ],
    },
    {
        title: 'TV ao Vivo',
        rows: [
            { keys: '🔴 Vermelho', what: 'Mostrar só canais com programação (EPG)' },
            { keys: '🟢 Verde', what: 'Sortear um canal aleatório' },
            { keys: '🟡 Amarelo', what: 'Favoritar o canal em foco' },
            { keys: '🔵 Azul', what: 'Ocultar o canal em foco da lista' },
        ],
    },
    {
        title: 'Filmes e Séries',
        rows: [
            { keys: '🟡 Amarelo', what: 'Menu rápido do card, sem abrir a ficha' },
        ],
    },
    {
        title: 'Durante a reprodução',
        rows: [
            { keys: 'CH+ / CH−', what: 'Trocar de canal ao vivo (e de rádio)' },
            { keys: '0 – 9', what: 'Ir direto para o número do canal' },
            { keys: '▲ na barra', what: 'Focar a barra e pular com ◀ ▶ (10s → 30s → 1min)' },
            { keys: '⏯ ⏸ ▶', what: 'Pausar e retomar' },
            { keys: '⏪ ⏩', what: 'Voltar e avançar em filmes e episódios' },
            { keys: '⏮ ⏭', what: 'Episódio anterior e próximo' },
            { keys: '⏹', what: 'Parar e fechar o player' },
        ],
    },
    {
        title: 'Configurações',
        rows: [
            { keys: '◀ ▶', what: 'Mudar o valor da linha em foco' },
            { keys: '🔴 Vermelho', what: 'Remover a playlist em foco' },
        ],
    },
];

interface RemoteGuideProps {
    onClose: () => void;
}

export function RemoteGuide({ onClose }: RemoteGuideProps) {
    // A lista é longa: o D-pad rola de seção em seção
    const [sectionIndex, setSectionIndex] = useState(0);

    useTVNavigation({
        onNavigate: (direction) => {
            if (direction === 'down') {
                setSectionIndex(prev => Math.min(SECTIONS.length - 1, prev + 1));
            } else if (direction === 'up') {
                setSectionIndex(prev => Math.max(0, prev - 1));
            }
        },
        onEnter: onClose,
        onBack: onClose,
    });

    return (
        <div className="guide-overlay">
            <div className="guide-panel">
                <div className="guide-header">
                    <h2 className="guide-title">🎛 Guia do controle remoto</h2>
                    <span className="guide-sub">▲▼ percorre · OK ou Voltar fecha</span>
                </div>

                <div className="guide-body">
                    {SECTIONS.map((section, index) => (
                        <section
                            key={section.title}
                            className={`guide-section ${index === sectionIndex ? 'current' : ''}`}
                            ref={index === sectionIndex
                                ? (node) => { node?.scrollIntoView({ block: 'nearest' }); }
                                : undefined}
                        >
                            <h3 className="guide-section-title">{section.title}</h3>
                            {section.rows.map(row => (
                                <div key={row.keys + row.what} className="guide-row">
                                    <span className="guide-key">{row.keys}</span>
                                    <span className="guide-what">{row.what}</span>
                                </div>
                            ))}
                        </section>
                    ))}
                </div>

                <div className="guide-footer">
                    As teclas coloridas mudam de função conforme a tela — o rodapé de
                    cada tela sempre mostra as dela.
                </div>
            </div>
        </div>
    );
}
