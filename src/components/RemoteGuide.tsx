// Guia do controle remoto (item 57).
//
// Numa TV não existe tooltip nem menu de atalhos: o usuário descobre por
// tentativa e erro, e as color keys ficam invisíveis. Este overlay é a única
// documentação que ele vai ler.
//
// ATENÇÃO ao editar: as color keys mudam de significado por tela (LiveTV usa
// as quatro; Filmes e Séries usam só a 🟡). Guia errado é pior que guia nenhum.
// Tela nova que atende tecla colorida ganha seção aqui: o RemoteGuide.test.tsx
// varre src/ e falha apontando o arquivo e a cor que ficaram de fora.

import { useState, useMemo } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import './RemoteGuide.css';

interface KeyRow {
    keys: string;
    what: string;
}

interface GuideSection {
    title: string;
    rows: KeyRow[];
}

interface RemoteGuideProps {
    onClose: () => void;
}

export function RemoteGuide({ onClose }: RemoteGuideProps) {
    const { t } = useTranslation();
    // A lista é longa: o D-pad rola de seção em seção
    const [sectionIndex, setSectionIndex] = useState(0);

    const SECTIONS = useMemo<GuideSection[]>(() => [
        {
            title: t('guide_s_any'),
            rows: [
                { keys: '▲ ▼ ◀ ▶', what: t('guide_r_nav') },
                { keys: 'OK', what: t('guide_r_ok') },
                { keys: t('guide_key_back'), what: t('guide_r_back') },
                { keys: t('guide_key_edge'), what: t('guide_r_edge') },
            ],
        },
        {
            title: t('guide_s_home'),
            rows: [
                { keys: t('guide_key_red'), what: t('guide_r_home_red') },
            ],
        },
        {
            title: t('guide_s_live'),
            rows: [
                { keys: t('guide_key_red'), what: t('guide_r_live_red') },
                { keys: t('guide_key_green'), what: t('guide_r_live_green') },
                { keys: t('guide_key_yellow'), what: t('guide_r_live_yellow') },
                { keys: t('guide_key_blue'), what: t('guide_r_live_blue') },
            ],
        },
        {
            title: t('guide_s_catmenu'),
            rows: [
                { keys: t('guide_key_blue'), what: t('guide_r_catmenu_blue') },
            ],
        },
        {
            title: t('guide_s_favnow'),
            rows: [
                { keys: t('guide_key_yellow'), what: t('guide_r_favnow_yellow') },
                { keys: t('guide_key_reorder'), what: t('guide_r_favnow_move') },
            ],
        },
        {
            title: t('guide_s_epg'),
            rows: [
                { keys: t('guide_key_red'), what: t('guide_r_epg_red') },
                { keys: t('guide_key_green'), what: t('guide_r_epg_green') },
                { keys: t('guide_key_yellow'), what: t('guide_r_epg_yellow') },
                { keys: t('guide_key_blue'), what: t('guide_r_epg_blue') },
            ],
        },
        {
            title: t('guide_s_vod'),
            rows: [
                { keys: t('guide_key_yellow'), what: t('guide_r_vod_yellow') },
            ],
        },
        {
            title: t('guide_s_fav'),
            rows: [
                { keys: t('guide_key_red'), what: t('guide_r_fav_red') },
            ],
        },
        {
            title: t('guide_s_mylist'),
            rows: [
                { keys: t('guide_key_red'), what: t('guide_r_mylist_red') },
                { keys: t('guide_key_yellow'), what: t('guide_r_mylist_yellow') },
                { keys: t('guide_key_blue'), what: t('guide_r_mylist_blue') },
            ],
        },
        {
            title: t('guide_s_player'),
            rows: [
                { keys: 'CH+ / CH−', what: t('guide_r_player_ch') },
                { keys: t('guide_key_red'), what: t('guide_r_player_red') },
                { keys: '0 – 9', what: t('guide_r_player_digits') },
                { keys: t('guide_key_barup'), what: t('guide_r_player_barup') },
                { keys: '⏯ ⏸ ▶', what: t('guide_r_player_play') },
                { keys: '⏪ ⏩', what: t('guide_r_player_seek') },
                { keys: '⏮ ⏭', what: t('guide_r_player_ep') },
                { keys: '⏹', what: t('guide_r_player_stop') },
            ],
        },
        {
            title: t('guide_s_settings'),
            rows: [
                { keys: '◀ ▶', what: t('guide_r_settings_lr') },
                { keys: t('guide_key_red'), what: t('guide_r_settings_red') },
            ],
        },
    ], [t]);

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
                    <h2 className="guide-title">{t('guide_title')}</h2>
                    <span className="guide-sub">{t('guide_sub')}</span>
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
                    {t('guide_footer')}
                </div>
            </div>
        </div>
    );
}
