// Sidebar Navigation Component - Matching NeoStream Desktop Design

import { useState, useMemo } from 'react';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import { useFocusZone } from '../../contexts/FocusContext';
import { useTranslation } from '../../hooks/useTranslation';
import type { TranslationKey } from '../../i18n';
import './Sidebar.css';

interface SidebarProps {
    activeItem: string;
    onItemSelect: (itemId: string) => void;
    onLogout: () => void;
    onProfileClick: () => void;
    /** Voltar com a sidebar focada: sobe um degrau (página → Home → sair) */
    onBack?: () => void;
    focused?: boolean;
}

interface MenuItem {
    id: string;
    label: string;
    emoji: string;
    gradient: string;
    requiresTV?: boolean;
    requiresVOD?: boolean;
}

const allMenuItems: MenuItem[] = [
    { id: 'search', label: 'Buscar', emoji: '🔍', gradient: 'linear-gradient(135deg, #64748b, #475569)' },
    { id: 'home', label: 'Início', emoji: '🏠', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    { id: 'live', label: 'TV ao Vivo', emoji: '📺', gradient: 'linear-gradient(135deg, #a855f7, #7c3aed)', requiresTV: true },
    { id: 'movies', label: 'Filmes', emoji: '🎬', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', requiresVOD: true },
    { id: 'series', label: 'Séries', emoji: '📺', gradient: 'linear-gradient(135deg, #ec4899, #db2777)', requiresVOD: true },
    { id: 'mylist', label: 'Minha Lista', emoji: '📑', gradient: 'linear-gradient(135deg, #14b8a6, #0891b2)' },
    { id: 'favorites', label: 'Favoritos', emoji: '❤️', gradient: 'linear-gradient(135deg, #ef4444, #dc2626)' },
    { id: 'settings', label: 'Configurações', emoji: '⚙️', gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' },
];

export function Sidebar({ activeItem, onItemSelect, onLogout, onProfileClick, focused = false , onBack}: SidebarProps) {
    const { setFocusZone } = useFocusZone();
    const { t } = useTranslation();

    // Get include preferences from localStorage
    const includeTV = localStorage.getItem('includeTV') !== 'false';
    const includeVOD = localStorage.getItem('includeVOD') !== 'false';

    // Filter menu items based on preferences
    const menuItems = useMemo(() => {
        return allMenuItems.filter(item => {
            if (item.requiresTV && !includeTV) return false;
            if (item.requiresVOD && !includeVOD) return false;
            return true;
        });
    }, [includeTV, includeVOD]);

    const [focusedIndex, setFocusedIndex] = useState(
        menuItems.findIndex(item => item.id === activeItem)
    );
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (direction === 'up') {
            setFocusedIndex(prev => Math.max(0, prev - 1));
        } else if (direction === 'down') {
            setFocusedIndex(prev => Math.min(menuItems.length + 1, prev + 1)); // +1 profile, +1 logout
        } else if (direction === 'right') {
            // Move focus to content area
            setFocusZone('content');
        }
    };

    const handleEnter = () => {
        if (focusedIndex === menuItems.length + 1) {
            // Logout button
            onLogout();
        } else if (focusedIndex === menuItems.length) {
            // Profile button - open profile manager
            onProfileClick();
        } else {
            const item = menuItems[focusedIndex];
            if (item) {
                onItemSelect(item.id);
                // 'search' abre o overlay (zona 'overlay' setada pelo App) —
                // forcar 'content' aqui reativaria a pagina atras da busca
                if (item.id !== 'search') {
                    setFocusZone('content'); // Move to content after selecting
                }
            }
        }
    };

    // Only enable TV navigation when sidebar is focused
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack,
        enabled: focused,
    });

    return (
        <>
            <div className={`sidebar ${focused ? 'sidebar-focused' : ''}`}>
                {/* Animated Background */}
                <div className="sidebar-bg">
                    <div className="bg-gradient" />
                    <div className="bg-glow" />
                </div>

                {/* Logo */}
                <div className="logo-container">
                    <div className="logo-wrapper">
                        <svg className="logo-svg" width="44" height="44" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#a855f7" />
                                    <stop offset="100%" stopColor="#ec4899" />
                                </linearGradient>
                            </defs>
                            <path d="M 10,10 L 10,90 L 90,50 Z" fill="none" stroke="url(#logoGradient)" strokeWidth="6" strokeLinejoin="round" />
                            <rect className="bar bar-1" x="35" y="35" width="6" height="30" fill="url(#logoGradient)" rx="3" />
                            <rect className="bar bar-2" x="45" y="25" width="6" height="50" fill="url(#logoGradient)" rx="3" />
                            <rect className="bar bar-3" x="55" y="40" width="6" height="20" fill="url(#logoGradient)" rx="3" />
                        </svg>
                        <div className="logo-ring" />
                    </div>
                </div>

                {/* Navigation */}
                <nav className="nav-container">
                    {menuItems.map((item, index) => {
                        const isActive = activeItem === item.id;
                        const isFocused = focused && focusedIndex === index;
                        const isHovered = hoveredItem === item.id;

                        return (
                            <button
                                key={item.id}
                                onClick={() => onItemSelect(item.id)}
                                onMouseEnter={() => setHoveredItem(item.id)}
                                onMouseLeave={() => setHoveredItem(null)}
                                onFocus={() => setFocusedIndex(index)}
                                className={`nav-item ${isActive ? 'active' : ''} ${isFocused ? 'tv-focused' : ''}`}
                                style={{ animationDelay: `${index * 0.05}s` }}
                                data-focusable="true"
                            >
                                {/* Background Glow */}
                                <div
                                    className="item-glow"
                                    style={{
                                        background: item.gradient,
                                        opacity: isActive ? 0.25 : isFocused || isHovered ? 0.15 : 0
                                    }}
                                />

                                {/* Icon */}
                                <div className="item-icon-wrapper">
                                    <span className="item-icon">{item.emoji}</span>
                                </div>

                                {/* Active Indicator */}
                                {isActive && (
                                    <div className="active-indicator">
                                        <div className="indicator-bar" style={{ background: item.gradient }} />
                                    </div>
                                )}

                                {/* Tooltip */}
                                <div className={`tooltip ${isFocused || isHovered ? 'visible' : ''}`}>
                                    <span className="tooltip-emoji">{item.emoji}</span>
                                    <span className="tooltip-label">{t(`sidebar_${item.id}` as TranslationKey)}</span>
                                </div>
                            </button>
                        );
                    })}
                </nav>

                {/* Bottom Section */}
                <div className="bottom-section">
                    {/* Profile Button */}
                    <button
                        className={`profile-btn ${focused && focusedIndex === menuItems.length ? 'tv-focused' : ''}`}
                        onClick={onProfileClick}
                        onMouseEnter={() => setHoveredItem('profile')}
                        onMouseLeave={() => setHoveredItem(null)}
                        onFocus={() => setFocusedIndex(menuItems.length)}
                        data-focusable="true"
                    >
                        <div className="profile-ring" />
                        <div className="profile-inner">
                            <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <linearGradient id="profileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#a855f7" />
                                        <stop offset="100%" stopColor="#ec4899" />
                                    </linearGradient>
                                </defs>
                                <circle cx="50" cy="35" r="14" fill="none" stroke="url(#profileGrad)" strokeWidth="6" />
                                <path d="M 20,85 C 20,65 30,55 50,55 C 70,55 80,65 80,85" fill="none" stroke="url(#profileGrad)" strokeWidth="6" strokeLinecap="round" />
                            </svg>
                        </div>
                        {/* Profile Tooltip */}
                        <div className={`tooltip ${(focused && focusedIndex === menuItems.length) || hoveredItem === 'profile' ? 'visible' : ''}`}>
                            <span className="tooltip-emoji">👤</span>
                            <span className="tooltip-label">{t('sidebar_profile' as TranslationKey)}</span>
                        </div>
                    </button>

                    {/* Logout */}
                    <button
                        className={`logout-btn ${focused && focusedIndex === menuItems.length + 1 ? 'tv-focused' : ''}`}
                        onClick={onLogout}
                        onMouseEnter={() => setHoveredItem('logout')}
                        onMouseLeave={() => setHoveredItem(null)}
                        onFocus={() => setFocusedIndex(menuItems.length + 1)}
                        data-focusable="true"
                    >
                        <svg className="logout-icon" viewBox="0 0 24 24" fill="none" width="22" height="22">
                            <path d="M9 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        {/* Logout Tooltip */}
                        <div className={`tooltip danger ${(focused && focusedIndex === menuItems.length + 1) || hoveredItem === 'logout' ? 'visible' : ''}`}>
                            <span className="tooltip-emoji">🚪</span>
                            <span className="tooltip-label">{t('sidebar_logout')}</span>
                        </div>
                    </button>
                </div>
            </div>
        </>
    );
}
