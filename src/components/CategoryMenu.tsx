// Category Menu Component - Hamburger Button + Slide Panel
// Matching Original App Animations
// TV: painel navegável por D-pad (↑↓ move, OK seleciona, Voltar fecha);
// ref.open() abre; onOpenChange avisa a página pra desabilitar o hook dela.

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
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
    }, ref) {
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

        const handleClose = () => {
            setIsClosing(true);
            // Wait for closing animation to finish. onOpenChange(false) só no
            // fim: reabilitar o hook da página com o painel ainda visível
            // deixava 300ms de teclas vazando pro grid atrás do painel.
            setTimeout(() => {
                setIsOpen(false);
                setIsClosing(false);
                notifyOpenChange(false);
            }, 300);
        };

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

        // D-pad dentro do painel
        useTVNavigation({
            onNavigate: (direction) => {
                if (direction === 'up') {
                    setFocusedIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'down') {
                    setFocusedIndex(prev => Math.min(allEntries.length - 1, prev + 1));
                }
            },
            onEnter: () => {
                const entry = allEntries[focusedIndex];
                if (entry) handleSelectCategory(entry.category_id);
            },
            onBack: handleClose,
            enabled: isOpen && !isClosing,
        });

        // Mantém o item focado visível
        useEffect(() => {
            if (!isOpen) return;
            const focused = listRef.current?.querySelector('.category-item.tv-focused');
            focused?.scrollIntoView({ block: 'nearest' });
        }, [focusedIndex, isOpen]);

        const getCategoryIcon = (name: string): string => {
            const lower = name.toLowerCase();
            if (lower.includes('ação') || lower.includes('action')) return 'Ação';
            if (lower.includes('aventura') || lower.includes('adventure')) return 'Aventura';
            if (lower.includes('drama')) return 'Drama';
            if (lower.includes('romance')) return 'Romance';
            if (lower.includes('comédia') || lower.includes('comedy')) return 'Comédia';
            if (lower.includes('terror') || lower.includes('horror')) return 'Terror';
            if (lower.includes('suspense') || lower.includes('thriller')) return 'Suspense';
            if (lower.includes('ficção') || lower.includes('sci-fi')) return 'Sci-Fi';
            if (lower.includes('fantasia') || lower.includes('fantasy')) return 'Fantasia';
            if (lower.includes('animação') || lower.includes('animation')) return 'Animação';
            if (lower.includes('anime')) return 'Anime';
            if (lower.includes('infantil') || lower.includes('kids')) return 'Kids';
            if (lower.includes('documentário') || lower.includes('documentary')) return 'Doc';
            if (lower.includes('crime') || lower.includes('policial')) return 'Crime';
            if (lower.includes('guerra') || lower.includes('war')) return 'Guerra';
            if (lower.includes('esporte') || lower.includes('sport')) return 'Esporte';
            if (lower.includes('música') || lower.includes('music')) return 'Música';
            if (lower.includes('favorito')) return '⭐';
            if (type === 'live') return 'TV';
            return type === 'vod' ? 'Filme' : 'Série';
        };

        const getTypeLabel = () => {
            if (type === 'live') return 'Todos os Canais';
            if (type === 'vod') return 'Todos os Filmes';
            return 'Todas as Séries';
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
                                <h2>Categorias</h2>
                                <p>Explore por gênero</p>
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
                                        className={`category-item ${selectedCategory === cat.category_id ? 'selected' : ''} ${focusedIndex === index ? 'tv-focused' : ''}`}
                                        style={isAll ? undefined : { animationDelay: `${0.1 + index * 0.03}s` }}
                                        onClick={() => handleSelectCategory(cat.category_id)}
                                    >
                                        <div className="category-icon">
                                            {isAll ? 'TV' : getCategoryIcon(cat.category_name)}
                                        </div>
                                        <span className="category-name">
                                            {isAll ? getTypeLabel() : cat.category_name}
                                        </span>
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
