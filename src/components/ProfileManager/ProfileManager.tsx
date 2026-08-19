// ProfileManager Component - TV Optimized
import { useState, useEffect, useCallback, useRef } from 'react';
import { profileService } from '../../services/profileService';
import type { Profile } from '../../types/profile';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import './ProfileManager.css';

interface ProfileManagerProps {
    onClose: () => void;
    /** Chamado após trocar de perfil (o App remonta a página com o gate certo) */
    onProfileSwitched?: () => void;
}

const DEFAULT_AVATAR = 'P';
const avatarOptions = [DEFAULT_AVATAR, 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

type ModalMode = 'list' | 'create' | 'edit' | 'pin-verify' | 'delete-confirm';

export function ProfileManager({ onClose, onProfileSwitched }: ProfileManagerProps) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
    const [mode, setMode] = useState<ModalMode>('list');
    const [focusedIndex, setFocusedIndex] = useState(0);

    // Form states
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [formName, setFormName] = useState('');
    const [formAvatar, setFormAvatar] = useState(DEFAULT_AVATAR);
    const [formPin, setFormPin] = useState(''); // vazio = manter/sem PIN
    const [removePin, setRemovePin] = useState(false);
    const [avatarFocusIndex, setAvatarFocusIndex] = useState(0);
    // Zonas do formulário: nome → PIN → avatares → botões (tudo por D-pad)
    const [editFocusZone, setEditFocusZone] = useState<'name' | 'pin' | 'avatars' | 'buttons'>('name');
    const [buttonFocusIndex, setButtonFocusIndex] = useState(0); // 0 = cancel, 1 = save, 2 = remover PIN (edit)
    const nameInputRef = useRef<HTMLInputElement>(null);
    const pinInputRef = useRef<HTMLInputElement>(null);

    // PIN states
    const [pendingProfile, setPendingProfile] = useState<Profile | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');

    // Delete confirm
    const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

    // Close button focus
    const [closeButtonFocused, setCloseButtonFocused] = useState(false);

    const refreshProfiles = useCallback(() => {
        setProfiles(profileService.getAllProfiles());
        setActiveProfile(profileService.getActiveProfile());
    }, []);

    // Load profiles
    useEffect(() => {
        void Promise.resolve().then(() => {
            profileService.initialize();
            refreshProfiles();
        });
    }, [refreshProfiles]);

    // Calculate total focusable items (profiles + add button if < 5)
    const totalItems = profiles.length + (profiles.length < 5 ? 1 : 0);

    // Start editing a profile
    const startEdit = useCallback((profile: Profile) => {
        setEditingProfile(profile);
        setFormName(profile.name);
        setFormAvatar(profile.avatar);
        setFormPin('');
        setRemovePin(false);
        setAvatarFocusIndex(Math.max(0, avatarOptions.indexOf(profile.avatar)));
        setEditFocusZone('name');
        setButtonFocusIndex(0);
        setMode('edit');
    }, []);

    // Handle create profile
    const handleCreateProfile = useCallback(async () => {
        if (!formName.trim()) return;
        if (formPin && formPin.length !== 4) return;

        await profileService.createProfile({
            name: formName.trim(),
            avatar: formAvatar,
            pin: formPin || undefined
        });
        refreshProfiles();
        setMode('list');
    }, [formAvatar, formName, formPin, refreshProfiles]);

    // Handle edit profile
    const handleEditProfile = useCallback(async () => {
        if (!editingProfile || !formName.trim()) return;
        if (formPin && formPin.length !== 4) return;

        // PIN: vazio = mantém o atual; 4 dígitos = troca; removePin = tira
        await profileService.updateProfile(editingProfile.id, {
            name: formName.trim(),
            avatar: formAvatar,
            ...(removePin ? { pin: null } : formPin ? { pin: formPin } : {})
        });
        refreshProfiles();
        setEditingProfile(null);
        setMode('list');
    }, [editingProfile, formAvatar, formName, formPin, removePin, refreshProfiles]);

    // Handle navigation
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (mode === 'list') {
            // Grid navigation (3 columns)
            const cols = 3;
            if (closeButtonFocused) {
                // From close button, only down goes back to grid
                if (direction === 'down') {
                    setCloseButtonFocused(false);
                    setFocusedIndex(0);
                }
            } else {
                if (direction === 'left') {
                    setFocusedIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'right') {
                    setFocusedIndex(prev => Math.min(totalItems - 1, prev + 1));
                } else if (direction === 'up') {
                    // If at top row (index 0-2), go to close button
                    if (focusedIndex < cols) {
                        setCloseButtonFocused(true);
                    } else {
                        setFocusedIndex(prev => Math.max(0, prev - cols));
                    }
                } else if (direction === 'down') {
                    setFocusedIndex(prev => Math.min(totalItems - 1, prev + cols));
                }
            }
        } else if (mode === 'create' || mode === 'edit') {
            if (editFocusZone === 'name') {
                if (direction === 'down') setEditFocusZone('pin');
            } else if (editFocusZone === 'pin') {
                if (direction === 'up') setEditFocusZone('name');
                else if (direction === 'down') setEditFocusZone('avatars');
            } else if (editFocusZone === 'avatars') {
                // Avatar grid navigation (8 columns)
                const cols = 8;
                if (direction === 'left') {
                    setAvatarFocusIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'right') {
                    setAvatarFocusIndex(prev => Math.min(avatarOptions.length - 1, prev + 1));
                } else if (direction === 'up') {
                    // Primeira linha de avatares volta pro campo de PIN
                    if (avatarFocusIndex < cols) {
                        setEditFocusZone('pin');
                    } else {
                        setAvatarFocusIndex(prev => Math.max(0, prev - cols));
                    }
                } else if (direction === 'down') {
                    // Check if at last row of avatars
                    const nextIndex = avatarFocusIndex + cols;
                    if (nextIndex >= avatarOptions.length) {
                        // Move to buttons
                        setEditFocusZone('buttons');
                        setButtonFocusIndex(0);
                    } else {
                        setAvatarFocusIndex(nextIndex);
                    }
                }
            } else if (editFocusZone === 'buttons') {
                // Buttons navigation (cancel, save[, remover PIN no edit])
                const maxButton = mode === 'edit' && editingProfile?.pin ? 2 : 1;
                if (direction === 'left') {
                    setButtonFocusIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'right') {
                    setButtonFocusIndex(prev => Math.min(maxButton, prev + 1));
                } else if (direction === 'up') {
                    // Move back to avatars
                    setEditFocusZone('avatars');
                }
            }
        }
    }, [mode, totalItems, editFocusZone, avatarFocusIndex, closeButtonFocused, focusedIndex, editingProfile]);

    const handleEnter = useCallback(() => {
        if (mode === 'list') {
            if (closeButtonFocused) {
                // Close button - close the modal
                onClose();
                return;
            }
            if (focusedIndex < profiles.length) {
                const profile = profiles[focusedIndex];
                const isActive = profile.id === activeProfile?.id;

                if (isActive) {
                    // Active profile - open edit mode (unless it's Kids profile)
                    if (!profile.isKids) {
                        startEdit(profile);
                    }
                } else {
                    // Non-active profile - switch to it
                    if (profile.pin) {
                        // Has PIN - verify first
                        setPendingProfile(profile);
                        setPinInput('');
                        setPinError('');
                        setMode('pin-verify');
                    } else {
                        // No PIN - activate directly
                        profileService.setActiveProfile(profile.id);
                        refreshProfiles();
                        onProfileSwitched?.();
                        onClose();
                    }
                }
            } else {
                // Add new profile
                setFormName('');
                setFormAvatar(DEFAULT_AVATAR);
                setFormPin('');
                setRemovePin(false);
                setAvatarFocusIndex(0);
                setEditFocusZone('name');
                setButtonFocusIndex(0);
                setMode('create');
            }
        } else if (mode === 'create' || mode === 'edit') {
            if (editFocusZone === 'name') {
                // Foca o input — abre o IME nativo da TV
                nameInputRef.current?.focus();
            } else if (editFocusZone === 'pin') {
                pinInputRef.current?.focus();
            } else if (editFocusZone === 'avatars') {
                // Select avatar
                setFormAvatar(avatarOptions[avatarFocusIndex]);
            } else if (editFocusZone === 'buttons') {
                if (buttonFocusIndex === 0) {
                    // Cancel
                    setMode('list');
                    setEditFocusZone('name');
                } else if (buttonFocusIndex === 1) {
                    // Save
                    if (mode === 'create') {
                        handleCreateProfile();
                    } else {
                        handleEditProfile();
                    }
                } else {
                    // Remover PIN (toggle)
                    setRemovePin(prev => !prev);
                    setFormPin('');
                }
            }
        }
    }, [mode, closeButtonFocused, focusedIndex, profiles, activeProfile, onClose, onProfileSwitched, editFocusZone, buttonFocusIndex, avatarFocusIndex, startEdit, refreshProfiles, handleCreateProfile, handleEditProfile]);

    const handleBack = useCallback(() => {
        if (mode === 'list') {
            onClose();
        } else {
            setMode('list');
            setEditingProfile(null);
            setPendingProfile(null);
            setDeleteTarget(null);
        }
    }, [mode, onClose]);

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        enabled: true
    });

    // Handle PIN verification
    const handlePinSubmit = async () => {
        if (!pendingProfile || pinInput.length !== 4) return;

        const isValid = await profileService.verifyPin(pendingProfile.id, pinInput);
        if (isValid) {
            profileService.setActiveProfile(pendingProfile.id);
            refreshProfiles();
            onProfileSwitched?.();
            onClose();
        } else {
            setPinError('PIN incorreto');
            setPinInput('');
        }
    };

    // Handle delete profile
    const handleDeleteProfile = () => {
        if (!deleteTarget) return;

        profileService.deleteProfile(deleteTarget.id);
        refreshProfiles();
        setDeleteTarget(null);
        setMode('list');
        setFocusedIndex(0);
    };

    // Start delete confirmation
    const startDelete = (profile: Profile) => {
        if (profile.id === activeProfile?.id) {
            return; // Cannot delete active profile
        }
        if (profile.isKids) {
            return; // Cannot delete kids profile
        }
        setDeleteTarget(profile);
        setMode('delete-confirm');
    };

    return (
        <div className="pm-overlay">
            {/* Animated Background */}
            <div className="pm-backdrop">
                <div className="pm-orb pm-orb-1" />
                <div className="pm-orb pm-orb-2" />
                <div className="pm-orb pm-orb-3" />
            </div>

            {/* Header */}
            <div className="pm-header">
                <h1 className="pm-title">
                    <span className="pm-title-icon">Perfis</span>
                    Gerenciar Perfis
                </h1>
                <button
                    className={`pm-close-btn ${closeButtonFocused ? 'focused' : ''}`}
                    onClick={onClose}
                >
                    X
                </button>
            </div>

            {/* Main Content */}
            {mode === 'list' && (
                <div className="pm-profiles-grid">
                    {profiles.map((profile, index) => {
                        const isActive = profile.id === activeProfile?.id;
                        const isFocused = focusedIndex === index;

                        return (
                            <div
                                key={profile.id}
                                className={`pm-profile-card ${isActive ? 'active' : ''} ${isFocused ? 'focused' : ''}`}
                                onClick={() => {
                                    setFocusedIndex(index);
                                    if (isActive) {
                                        // Active profile - open edit (unless Kids)
                                        if (!profile.isKids) {
                                            startEdit(profile);
                                        }
                                    } else {
                                        // Non-active - switch profile
                                        if (profile.pin) {
                                            setPendingProfile(profile);
                                            setPinInput('');
                                            setPinError('');
                                            setMode('pin-verify');
                                        } else {
                                            profileService.setActiveProfile(profile.id);
                                            refreshProfiles();
                                            onProfileSwitched?.();
                                            onClose();
                                        }
                                    }
                                }}
                            >
                                {isActive && (
                                    <div className="pm-active-badge">
                                        <span>✓</span> Ativo
                                    </div>
                                )}

                                <div className="pm-avatar">
                                    <span className="pm-avatar-emoji">{profile.avatar}</span>
                                </div>

                                <h3 className="pm-profile-name">
                                    {profile.name}
                                    {profile.isKids && <span className="pm-kids-badge">Kids</span>}
                                </h3>

                                {profile.pin && (
                                    <div className="pm-pin-indicator">
                                        PIN ativo
                                    </div>
                                )}

                                {/* Action buttons (only for non-kids profiles) */}
                                {!profile.isKids && (
                                    <div className="pm-actions">
                                        <button
                                            className="pm-btn pm-btn-edit"
                                            onClick={(e) => { e.stopPropagation(); startEdit(profile); }}
                                        >
                                            Editar
                                        </button>
                                        <button
                                            className="pm-btn pm-btn-delete"
                                            onClick={(e) => { e.stopPropagation(); startDelete(profile); }}
                                            disabled={isActive || profiles.length <= 1}
                                        >
                                            Excluir
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Add New Profile Card */}
                    {profiles.length < 5 && (
                        <button
                            className={`pm-add-card ${focusedIndex === profiles.length ? 'focused' : ''}`}
                            onClick={() => {
                                setFocusedIndex(profiles.length);
                                setFormName('');
                                setFormAvatar(DEFAULT_AVATAR);
                                setFormPin('');
                                setRemovePin(false);
                                setEditFocusZone('name');
                                setButtonFocusIndex(0);
                                setMode('create');
                            }}
                        >
                            <div className="pm-add-icon">+</div>
                            <span className="pm-add-label">Adicionar Perfil</span>
                        </button>
                    )}
                </div>
            )}

            {/* Create/Edit Profile Modal */}
            {(mode === 'create' || mode === 'edit') && (
                <div className="pm-modal">
                    <div className="pm-modal-header">
                        <span className="pm-modal-icon">{mode === 'create' ? '+' : 'Editar'}</span>
                        <h2>{mode === 'create' ? 'Novo Perfil' : 'Editar Perfil'}</h2>
                    </div>

                    <div className="pm-form">
                        <label className="pm-label">Nome do Perfil</label>
                        <input
                            ref={nameInputRef}
                            type="text"
                            className={`pm-input ${editFocusZone === 'name' ? 'tv-focused' : ''}`}
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Digite o nome..."
                            maxLength={20}
                            autoFocus
                        />

                        <label className="pm-label">
                            PIN (4 dígitos){mode === 'edit' && editingProfile?.pin ? ' — vazio mantém o atual' : ' — opcional'}
                        </label>
                        <input
                            ref={pinInputRef}
                            type="text"
                            className={`pm-input ${editFocusZone === 'pin' ? 'tv-focused' : ''}`}
                            value={formPin}
                            onChange={(e) => {
                                setFormPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                                setRemovePin(false);
                            }}
                            placeholder={mode === 'edit' && editingProfile?.pin ? '••••' : 'Sem PIN'}
                            maxLength={4}
                            inputMode="numeric"
                        />
                        {removePin && (
                            <p className="pm-pin-remove-note">O PIN será removido ao salvar.</p>
                        )}

                        <label className="pm-label">Avatar</label>
                        <div className="pm-avatar-grid">
                            {avatarOptions.map((avatar, index) => (
                                <button
                                    key={avatar}
                                    className={`pm-avatar-option ${formAvatar === avatar ? 'selected' : ''} ${avatarFocusIndex === index ? 'focused' : ''}`}
                                    onClick={() => setFormAvatar(avatar)}
                                >
                                    {avatar}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pm-modal-buttons">
                        <button
                            className={`pm-btn pm-btn-cancel ${editFocusZone === 'buttons' && buttonFocusIndex === 0 ? 'focused' : ''}`}
                            onClick={() => { setMode('list'); setEditFocusZone('name'); }}
                        >
                            Cancelar
                        </button>
                        <button
                            className={`pm-btn pm-btn-save ${editFocusZone === 'buttons' && buttonFocusIndex === 1 ? 'focused' : ''}`}
                            onClick={mode === 'create' ? handleCreateProfile : handleEditProfile}
                            disabled={!formName.trim()}
                        >
                            ✓ Salvar
                        </button>
                        {mode === 'edit' && editingProfile?.pin && (
                            <button
                                className={`pm-btn pm-btn-cancel ${removePin ? 'pm-btn-danger-active' : ''} ${editFocusZone === 'buttons' && buttonFocusIndex === 2 ? 'focused' : ''}`}
                                onClick={() => {
                                    setRemovePin(prev => !prev);
                                    setFormPin('');
                                }}
                            >
                                {removePin ? '↩ Manter PIN' : '🗑 Remover PIN'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* PIN Verification Modal */}
            {mode === 'pin-verify' && pendingProfile && (
                <div className="pm-pin-modal">
                    <div className="pm-pin-header">
                        <span className="pm-pin-icon">PIN</span>
                        <h2>Digite o PIN</h2>
                        <p>Perfil: <strong>{pendingProfile.name}</strong></p>
                    </div>

                    <div className="pm-pin-input-container">
                        {[0, 1, 2, 3].map((index) => (
                            <div
                                key={index}
                                className={`pm-pin-digit ${pinInput.length > index ? 'filled' : ''} ${pinError ? 'error' : ''}`}
                            >
                                {pinInput[index] ? '•' : ''}
                            </div>
                        ))}
                    </div>

                    <input
                        type="password"
                        maxLength={4}
                        value={pinInput}
                        onChange={(e) => {
                            setPinInput(e.target.value.replace(/\D/g, ''));
                            setPinError('');
                        }}
                        onKeyPress={(e) => {
                            if (e.key === 'Enter' && pinInput.length === 4) {
                                handlePinSubmit();
                            }
                        }}
                        autoFocus
                        className="pm-hidden-input"
                    />

                    {pinError && (
                        <p className="pm-pin-error">! {pinError}</p>
                    )}

                    <div className="pm-pin-buttons">
                        <button className="pm-btn pm-btn-cancel" onClick={() => setMode('list')}>
                            Cancelar
                        </button>
                        <button
                            className="pm-btn pm-btn-save"
                            onClick={handlePinSubmit}
                            disabled={pinInput.length !== 4}
                        >
                            ✓ Entrar
                        </button>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {mode === 'delete-confirm' && deleteTarget && (
                <div className="pm-modal pm-modal-delete">
                    <div className="pm-modal-header">
                        <span className="pm-modal-icon danger">Excluir</span>
                        <h2>Excluir Perfil?</h2>
                    </div>

                    <p className="pm-delete-msg">
                        Deseja excluir o perfil <strong>{deleteTarget.name}</strong>?
                        <br />
                        <span className="pm-delete-warning">Esta ação não pode ser desfeita.</span>
                    </p>

                    <div className="pm-modal-buttons">
                        <button className="pm-btn pm-btn-cancel" onClick={() => setMode('list')}>
                            Cancelar
                        </button>
                        <button className="pm-btn pm-btn-danger" onClick={handleDeleteProfile}>
                            Excluir
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
