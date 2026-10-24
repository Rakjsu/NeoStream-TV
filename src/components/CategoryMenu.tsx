// Category Menu Component - Hamburger Button + Slide Panel
// Matching Original App Animations
// TV: painel navegável por D-pad (↑↓ move, OK seleciona, Voltar fecha);
// ref.open() abre; onOpenChange avisa a página pra desabilitar o hook dela.

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import './CategoryMenu.css';

export interface CategoryMenuHandle {
    open: () => void;
}

interface CategoryMenuProps {
    categories: Category[];
    selectedCategory: string;
    onSelectCategory: (categoryId: string) => void;
    type?: 'live' | 'vod' | 'series';
    /** Destaque visual do botão hamburger quando focado pelo D-pad */
    tvFocused?: boolean;
    /** Avisa a página quando o painel abre/fecha (pra pausar o hook dela) */
    onOpenChange?: (open: boolean) => void;
    /** Categorias virtuais extras no topo da lista (ex.: ⭐ Favoritos) */
    extraCategories?: Category[];
    /** Categorias ocultas (item 16) — 🔵 alterna na categoria focada */
    hiddenCategoryIds?: Set<string>;
    onToggleHideCategory?: (categoryId: string) => void;
}

export const CategoryMenu = forwardRef<CategoryMenuHandle, CategoryMenuProps>(
    function CategoryMenu({
        categories,
        selectedCategory,
        onSelectCategory,
        type = 'vod',
        tvFocused = false,
        onOpenChange,
        extraCategories = [],
        hiddenCategoryIds,
        onToggleHideCategory,
    }, ref) {
        const { t } = useTranslation();
        const [isOpen, setIsOpen] = useState(false);
        const [isClosing, setIsClosing] = useState(false);
        const [focusedIndex, setFocusedIndex] = useState(0);
        const panelRef = useRef<HTMLDivElement>(null);
        const listRef = useRef<HTMLDivElement>(null);

        // "Todos" + extras + categorias do provedor
        const allEntries: Category[] = [
            { category_id: 'all', category_name: '', parent_id: 0 },
            ...extraCategories,
            ...categories,
        ];

        const notifyOpenChange = (open: boolean) => {
            onOpenChange?.(open);
        };

        // Timer da animação de fechar. Guardado pra ser desarmado quando o
        // fechamento termina antes (tecla durante a animação) e no desmonte.
        const closeTimerRef = useRef<number | null>(null);

        const finishClose = () => {
            if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
            setIsOpen(false);
            setIsClosing(false);
            notifyOpenChange(false);
        };

        const handleClose = () => {
            // Já fechando (Voltar/OK de novo, clique no fundo): não arma outro
            // timer nem avisa a página duas vezes — só encerra a animação.
            if (closeTimerRef.current !== null) {
                finishClose();
                return;
            }
            setIsClosing(true);
            // Wait for closing animation to finish. onOpenChange(false) só no
            // fim: reabilitar o hook da página com o painel ainda visível
            // deixava 300ms de teclas vazando pro grid atrás do painel.
            closeTimerRef.current = window.setTimeout(finishClose, 300);
        };

        // Desmontou no meio da animação: só desarma o timer. LiveTV, Filmes e
        // Séries renderizam o menu sem condição, então ele só desmonta junto
        // com a página — não sobra ninguém pra avisar.
        useEffect(() => () => {
            if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        }, []);

        const handleOpen = () => {
            setIsClosing(false);
            setIsOpen(true);
            // Foco inicial na categoria selecionada
            const idx = allEntries.findIndex(c => c.category_id === selectedCategory);
            setFocusedIndex(Math.max(0, idx));
            notifyOpenChange(true);
        };

        useImperativeHandle(ref, () => ({
            open: () => {
                if (!isOpen) handleOpen();
            },
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }), [isOpen, selectedCategory, categories, extraCategories]);

        const handleToggle = () => {
            if (isOpen) {
                handleClose();
            } else {
                handleOpen();
            }
        };

        const handleSelectCategory = (categoryId: string) => {
            onSelectCategory(categoryId);
            handleClose();
        };

        // D-pad dentro do painel. Continua ouvindo durante a animação de
        // fechar: a página só religa no fim dela, e com os dois desligados o
        // controle ficava 300ms morto. Nesse intervalo qualquer tecla encerra
        // o fechamento na hora e é consumida aqui — não vaza pra grade com o
        // painel ainda na tela, nem seleciona outra categoria.
        useTVNavigation({
            onNavigate: (direction) => {
                if (isClosing) {
                    finishClose();
                    return;
                }
                if (direction === 'up') {
                    setFocusedIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'down') {
                    setFocusedIndex(prev => Math.min(allEntries.length - 1, prev + 1));
                }
            },
            onEnter: () => {
                if (isClosing) {
                    finishClose();
                    return;
                }
                const entry = allEntries[focusedIndex];
                if (entry) handleSelectCategory(entry.category_id);
            },
            onBack: handleClose,
            onAction: (action) => {
                // Durante a animação: 🔵 e as outras teclas de ação encerram o
                // fechamento. 'enter'/'back' não — o hook chama onAction logo
                // depois do onEnter/onBack da mesma tecla, que já responderam.
                if (isClosing) {
                    if (action !== 'enter' && action !== 'back') finishClose();
                    return;
                }
                // 🔵 oculta/mostra a categoria focada (não vale pras virtuais)
                if (action === 'blue' && onToggleHideCategory) {
                    const entry = allEntries[focusedIndex];
                    if (entry && entry.category_id !== 'all' && entry.category_id !== 'FAVORITES') {
                        onToggleHideCategory(entry.category_id);
                    }
                }
            },
            enabled: isOpen,
        });

        // Mantém o item focado visível
        useEffect(() => {
            if (!isOpen) return;
            const focused = listRef.current?.querySelector('.category-item.tv-focused');
            focused?.scrollIntoView({ block: 'nearest' });
        }, [focusedIndex, isOpen]);

        const getCategoryIcon = (name: string): string => {
            const lower = name.toLowerCase();
            if (lower.includes('ação') || lower.includes('action')) return t('genre_action');
            if (lower.includes('aventura') || lower.includes('adventure')) return t('genre_adventure');
            if (lower.includes('drama')) return t('genre_drama');
            if (lower.includes('romance')) return t('genre_romance');
            if (lower.includes('comédia') || lower.includes('comedy')) return t('genre_comedy');
            if (lower.includes('terror') || lower.includes('horror')) return t('genre_horror');
            if (lower.includes('suspense') || lower.includes('thriller')) return t('genre_thriller');
            if (lower.includes('ficção') || lower.includes('sci-fi')) return t('genre_scifi');
            if (lower.includes('fantasia') || lower.includes('fantasy')) return t('genre_fantasy');
            if (lower.includes('animação') || lower.includes('animation')) return t('genre_animation');
            if (lower.includes('anime')) return t('genre_anime');
            if (lower.includes('infantil') || lower.includes('kids')) return t('genre_kids');
            if (lower.includes('documentário') || lower.includes('documentary')) return t('genre_doc');
            if (lower.includes('crime') || lower.includes('policial')) return t('genre_crime');
            if (lower.includes('guerra') || lower.includes('war')) return t('genre_war');
            if (lower.includes('esporte') || lower.includes('sport')) return t('genre_sport');
            if (lower.includes('música') || lower.includes('music')) return t('genre_music');
            if (lower.includes('favorito')) return '⭐';
            if (type === 'live') return 'TV';
            return type === 'vod' ? t('type_movie') : t('type_series');
        };

        const getTypeLabel = () => {
            if (type === 'live') return t('cat_all_live');
            if (type === 'vod') return t('cat_all_vod');
            return t('cat_all_series');
        };

        return (
            <>
                {/* Hamburger Toggle Button */}
                <button
                    className={`category-toggle-btn ${isOpen ? 'active' : ''} ${tvFocused ? 'tv-focused' : ''}`}
                    onClick={handleToggle}
                >
                    <span className="hamburger-line line-1" />
                    <span className="hamburger-line line-2" />
                    <span className="hamburger-line line-3" />
                </button>

                {/* Backdrop */}
                {(isOpen || isClosing) && (
                    <div
                        className="category-backdrop"
                        onClick={handleClose}
                        style={{ opacity: isClosing ? 0 : 1, transition: 'opacity 0.3s ease' }}
                    />
                )}

                {/* Category Panel */}
                {(isOpen || isClosing) && (
                    <div
                        ref={panelRef}
                        className={`category-panel ${isOpen && !isClosing ? 'open' : ''} ${isClosing ? 'closing' : ''}`}
                    >
                        {/* Header */}
                        <div className="category-panel-header">
                            <div className="header-content">
                                <h2>{t('cat_title')}</h2>
                                <p>{t('cat_subtitle')}{onToggleHideCategory ? t('cat_hide_hint') : ''}</p>
                            </div>
                            <button className="close-btn" onClick={handleClose}>
                                X
                            </button>
                        </div>

                        {/* Category List */}
                        <div ref={listRef} className="category-list">
                            {allEntries.map((cat, index) => {
                                const isAll = cat.category_id === 'all';
                                return (
                                    <button
                                        key={cat.category_id}
                                        className={`category-item ${selectedCategory === cat.category_id ? 'selected' : ''} ${focusedIndex === index ? 'tv-focused' : ''} ${hiddenCategoryIds?.has(cat.category_id) ? 'category-hidden' : ''}`}
                                        onClick={() => handleSelectCategory(cat.category_id)}
                                    >
                                        <div className="category-icon">
                                            {isAll ? 'TV' : getCategoryIcon(cat.category_name)}
                                        </div>
                                        <span className="category-name">
                                            {isAll ? getTypeLabel() : cat.category_name}
                                        </span>
                                        {!isAll && cat.category_id !== 'FAVORITES' && onToggleHideCategory && (
                                            <span
                                                className="category-hide-toggle"
                                                title={t('cat_hide_title')}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleHideCategory(cat.category_id);
                                                }}
                                            >
                                                🙈
                                            </span>
                                        )}
                                        {selectedCategory === cat.category_id && <div className="selected-dot" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </>
        );
    }
);
