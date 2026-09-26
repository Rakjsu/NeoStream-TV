// ProfileManager Component - TV Optimized
import { useState, useEffect, useCallback, useRef } from 'react';
import { profileService } from '../../services/profileService';
import type { Profile } from '../../types/profile';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import './ProfileManager.css';
import { parentalService } from '../../services/parentalService';
import { PinPrompt } from '../PinPrompt';

interface ProfileManagerProps {
    onClose: () => void;
    /** Chamado após trocar de perfil (o App remonta a página com o gate certo) */
    onProfileSwitched?: () => void;
}

const DEFAULT_AVATAR = 'P';
// Gravação que não coube nem depois de podar os caches (T107): sem isto a
// tela voltava pra lista como se o perfil existisse, e ele sumia no boot.
const SEM_ESPACO = 'Não foi possível salvar: a memória da TV está cheia. Libere espaço em Configurações → Sistema → Apagar dados e tente de novo.';
const avatarOptions = [DEFAULT_AVATAR, 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

type ModalMode = 'list' | 'create' | 'edit' | 'pin-verify' | 'delete-confirm';

/**
 * O que a pessoa quer fazer com um perfil. Entrar, editar e excluir passam
 * pela MESMA porta de PIN (T046): editar/excluir abriam direto, e do Kids
 * dava pra tirar o PIN do adulto ou apagar o perfil dele sem provar nada.
 */
type AcaoPerfil = 'switch' | 'edit' | 'delete';
const ROTULO_ACAO: Record<AcaoPerfil, string> = {
    switch: 'Entrar',
    edit: 'Editar perfil',
    delete: 'Excluir perfil',
};

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
    const [saveError, setSaveError] = useState('');
    const [avatarFocusIndex, setAvatarFocusIndex] = useState(0);
    // Zonas do formulário: nome → PIN → avatares → botões (tudo por D-pad)
    const [editFocusZone, setEditFocusZone] = useState<'name' | 'pin' | 'avatars' | 'buttons'>('name');
    const [buttonFocusIndex, setButtonFocusIndex] = useState(0); // 0 = cancel, 1 = save, 2 = remover PIN (edit)
    const nameInputRef = useRef<HTMLInputElement>(null);
    const pinInputRef = useRef<HTMLInputElement>(null);

    // PIN states
    const [pendingProfile, setPendingProfile] = useState<Profile | null>(null);
    // Perfil que só entra depois do PIN PARENTAL (saída do modo Kids, item 55)
    const [parentalTarget, setParentalTarget] = useState<Profile | null>(null);
    // O que acontece quando o PIN (parental e/ou do perfil) for aceito
    const [pendingAction, setPendingAction] = useState<AcaoPerfil>('switch');
    // Sub-foco DENTRO do card: os botões Editar/Excluir existiam no desenho e
    // nenhuma seta chegava neles — não havia como excluir um perfil pela TV.
    const [cardZone, setCardZone] = useState<'card' | 'edit' | 'delete'>('card');
    // Botão do diálogo de exclusão: 0 = cancelar, 1 = excluir
    const [deleteFocusIndex, setDeleteFocusIndex] = useState(0);

    // Delete confirm
    const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

    // Close button focus
    const [closeButtonFocused, setCloseButtonFocused] = useState(false);

    const refreshProfiles = useCallback(() => {
        setProfiles(profileService.getAllProfiles());
        setActiveProfile(profileService.getActiveProfile());
    }, []);

    const commitSwitch = useCallback((profile: Profile) => {
        profileService.setActiveProfile(profile.id);
        refreshProfiles();
        onProfileSwitched?.();
        onClose();
    }, [refreshProfiles, onProfileSwitched, onClose]);

    /** Abre o formulário de edição — só depois da porta (pedirPinDoPerfil). */
    const abrirEdicao = useCallback((profile: Profile) => {
        setEditingProfile(profile);
        setFormName(profile.name);
        setFormAvatar(profile.avatar);
        setFormPin('');
        setRemovePin(false);
        setAvatarFocusIndex(Math.max(0, avatarOptions.indexOf(profile.avatar)));
        setEditFocusZone('name');
        setButtonFocusIndex(0);
        setSaveError('');
        setMode('edit');
    }, []);

    /** Abre a confirmação de exclusão — só depois da porta (pedirPinDoPerfil). */
    const abrirExclusao = useCallback((profile: Profile) => {
        setDeleteTarget(profile);
        // Nasce em "Cancelar": exclusão nunca é o padrão
        setDeleteFocusIndex(0);
        setSaveError('');
        setMode('delete-confirm');
    }, []);

    const executarAcao = useCallback((profile: Profile, acao: AcaoPerfil) => {
        if (acao === 'switch') commitSwitch(profile);
        else if (acao === 'edit') abrirEdicao(profile);
        else abrirExclusao(profile);
    }, [commitSwitch, abrirEdicao, abrirExclusao]);

    /**
     * Porta ÚNICA de PIN para entrar, editar ou excluir um perfil. Mexer num
     * perfil que NÃO é o ativo exige exatamente o que entrar nele exigiria:
     * o PIN parental ao sair do Kids e o PIN do próprio perfil. Editar o
     * perfil ativo não pede nada — quem está nele já passou pela porta.
     */
    const pedirPinDoPerfil = useCallback((profile: Profile, acao: AcaoPerfil) => {
        if (acao !== 'switch' && profile.id === activeProfile?.id) {
            executarAcao(profile, acao);
            return;
        }
        const leavingKids = !!activeProfile?.isKids && !profile.isKids;
        if (leavingKids && parentalService.requires('leaveKids')) {
            setPendingAction(acao);
            setParentalTarget(profile);
            return;
        }
        if (profile.pin) {
            setPendingAction(acao);
            setPendingProfile(profile);
            setMode('pin-verify');
            return;
        }
        executarAcao(profile, acao);
    }, [activeProfile, executarAcao]);

    /**
     * Caminho ÚNICO de troca de perfil. Havia dois (tecla OK e clique no card)
     * com a mesma lógica duplicada — e a trava do modo Kids precisa valer nos
     * dois, senão sair do Kids por clique burlava o controle parental.
     */
    const requestSwitch = useCallback((profile: Profile) => {
        pedirPinDoPerfil(profile, 'switch');
    }, [pedirPinDoPerfil]);

    // Load profiles
    useEffect(() => {
        void Promise.resolve().then(() => {
            profileService.initialize();
            refreshProfiles();
        });
    }, [refreshProfiles]);

    // Calculate total focusable items (profiles + add button if < 5)
    const totalItems = profiles.length + (profiles.length < 5 ? 1 : 0);

    // Start editing a profile (perfil alheio com PIN passa pela porta antes)
    const startEdit = useCallback((profile: Profile) => {
        pedirPinDoPerfil(profile, 'edit');
    }, [pedirPinDoPerfil]);

    // Handle create profile
    const handleCreateProfile = useCallback(async () => {
        if (!formName.trim()) return;
        if (formPin && formPin.length !== 4) return;

        const criado = await profileService.createProfile({
            name: formName.trim(),
            avatar: formAvatar,
            pin: formPin || undefined
        });
        if (!criado) {
            setSaveError(SEM_ESPACO);
            return;
        }
        refreshProfiles();
        setMode('list');
    }, [formAvatar, formName, formPin, refreshProfiles]);

    // Handle edit profile
    const handleEditProfile = useCallback(async () => {
        if (!editingProfile || !formName.trim()) return;
        if (formPin && formPin.length !== 4) return;

        // PIN: vazio = mantém o atual; 4 dígitos = troca; removePin = tira
        const salvo = await profileService.updateProfile(editingProfile.id, {
            name: formName.trim(),
            avatar: formAvatar,
            ...(removePin ? { pin: null } : formPin ? { pin: formPin } : {})
        });
        if (!salvo) {
            setSaveError(SEM_ESPACO);
            return;
        }
        refreshProfiles();
        setEditingProfile(null);
        setMode('list');
    }, [editingProfile, formAvatar, formName, formPin, removePin, refreshProfiles]);

    // Handle navigation
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (mode === 'delete-confirm') {
            // ←→ escolhem entre Cancelar e Excluir
            if (direction === 'left') setDeleteFocusIndex(0);
            else if (direction === 'right') setDeleteFocusIndex(1);
            return;
        }
        if (mode === 'list') {
            // Com o foco num card, ←→ percorrem card → Editar → Excluir.
            // Os perfis Kids e o card "+ Adicionar" não têm essas ações.
            const perfilFocado = focusedIndex < profiles.length ? profiles[focusedIndex] : null;
            // O perfil ATIVO não pode ser excluído (nem o Kids, nem o último):
            // deixar o sub-foco chegar num botão desabilitado dá uma tecla que
            // não responde — pior que não ter o botão.
            const podeExcluir = !!perfilFocado
                && perfilFocado.id !== activeProfile?.id
                && profiles.length > 1;
            const temAcoes = !!perfilFocado && !perfilFocado.isKids;

            if (temAcoes && (direction === 'left' || direction === 'right')) {
                const ordem: Array<'card' | 'edit' | 'delete'> = podeExcluir
                    ? ['card', 'edit', 'delete']
                    : ['card', 'edit'];
                const atual = ordem.indexOf(cardZone);
                if (direction === 'right' && atual < ordem.length - 1) {
                    setCardZone(ordem[atual + 1]);
                    return;
                }
                if (direction === 'left' && atual > 0) {
                    setCardZone(ordem[atual - 1]);
                    return;
                }
            }
            // Sair do card zera o sub-foco: voltar depois e cair no "Excluir"
            // seria uma surpresa desagradável
            setCardZone('card');
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
    }, [mode, totalItems, editFocusZone, avatarFocusIndex, closeButtonFocused, focusedIndex,
        editingProfile, profiles, cardZone, activeProfile]);

    const handleDeleteProfile = useCallback(() => {
        if (!deleteTarget) return;
        // Sem zerar o sub-foco, o "Excluir" fica destacado no card que herdou
        // a posição do perfil recém-apagado — pronto pra apagar o próximo
        setCardZone('card');
        if (!profileService.deleteProfile(deleteTarget.id)) {
            // Fica no diálogo: o perfil continua existindo
            setSaveError(SEM_ESPACO);
            return;
        }
        refreshProfiles();
        setDeleteTarget(null);
        setMode('list');
        setFocusedIndex(0);
        setDeleteFocusIndex(0);
    }, [deleteTarget, refreshProfiles]);

    /**
     * Abre a confirmação de exclusão (o perfil ativo e o Kids não podem).
     * Excluir apaga o perfil E os dados dele: passa pela mesma porta de PIN.
     */
    const startDelete = useCallback((profile: Profile) => {
        if (profile.id === activeProfile?.id) return;
        if (profile.isKids) return;
        pedirPinDoPerfil(profile, 'delete');
    }, [activeProfile, pedirPinDoPerfil]);

    const handleEnter = useCallback((fromInput?: boolean) => {
        // OK vindo de dentro do campo Nome/PIN já fechou o teclado; seguir
        // adiante refocaria o mesmo campo e o IME do Tizen subiria em laço
        if (fromInput) return;
        if (mode === 'delete-confirm') {
            if (deleteFocusIndex === 1) handleDeleteProfile();
            else { setMode('list'); setDeleteTarget(null); }
            return;
        }
        if (mode === 'list') {
            if (closeButtonFocused) {
                // Close button - close the modal
                onClose();
                return;
            }
            if (focusedIndex < profiles.length) {
                const profile = profiles[focusedIndex];
                const isActive = profile.id === activeProfile?.id;

                // Sub-foco nos botões do card vence a ação padrão
                if (cardZone === 'edit' && !profile.isKids) {
                    startEdit(profile);
                    return;
                }
                if (cardZone === 'delete' && !profile.isKids) {
                    startDelete(profile);
                    return;
                }

                if (isActive) {
                    // Active profile - open edit mode (unless it's Kids profile)
                    if (!profile.isKids) {
                        startEdit(profile);
                    }
                } else {
                    requestSwitch(profile);
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
                setSaveError('');
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
    }, [mode, closeButtonFocused, focusedIndex, profiles, activeProfile, onClose, editFocusZone,
        buttonFocusIndex, avatarFocusIndex, startEdit, handleCreateProfile, handleEditProfile,
        requestSwitch, cardZone, deleteFocusIndex, handleDeleteProfile, startDelete]);

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
        // Com um diálogo de PIN na tela, o OK aqui embaixo trocava o perfil
        // focado por trás dele — vale pro PIN parental e pro do perfil.
        enabled: !parentalTarget && mode !== 'pin-verify',
    });

    // Handle PIN verification. Devolve false pro PinPrompt mostrar "PIN
    // incorreto" e limpar os dígitos — o estado do erro é dele.
    const handlePinSubmit = async (pin: string): Promise<boolean> => {
        if (!pendingProfile) return false;
        const isValid = await profileService.verifyPin(pendingProfile.id, pin);
        if (!isValid) return false;
        const target = pendingProfile;
        setPendingProfile(null);
        // Troca fecha o gerenciador; editar/excluir trocam o modo em seguida
        setMode('list');
        executarAcao(target, pendingAction);
        return true;
    };

    // Handle delete profile
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
                                        requestSwitch(profile);
                                    }
                                }}
                            >
                                {isActive && (
                                    <div className="pm-active-badge">
                                        <span>✓</span> <span>Ativo</span>
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
                                            className={`pm-btn pm-btn-edit ${isFocused && cardZone === 'edit' ? 'tv-focused' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); startEdit(profile); }}
                                        >
                                            Editar
                                        </button>
                                        <button
                                            className={`pm-btn pm-btn-delete ${isFocused && cardZone === 'delete' ? 'tv-focused' : ''}`}
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
                                setSaveError('');
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
                        {saveError && <p className="pm-pin-remove-note" role="alert">{saveError}</p>}

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
            {/* PIN de entrada do perfil: teclado na tela navegável por D-pad.
                Antes era um <input> escondido com autoFocus — o IME nativo da
                TV nem sempre abre, e sem ele NADA digitava: o perfil protegido
                ficava inacessível no controle. */}
            {mode === 'pin-verify' && pendingProfile && (
                <PinPrompt
                    title="Digite o PIN"
                    hint={`Perfil: ${pendingProfile.name}`}
                    confirmLabel={ROTULO_ACAO[pendingAction]}
                    onSubmit={handlePinSubmit}
                    onCancel={() => {
                        setMode('list');
                        setPendingProfile(null);
                    }}
                />
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
                    {saveError && <p className="pm-pin-remove-note" role="alert">{saveError}</p>}
                    <p className="pm-hint">◀ ▶ escolhe · OK confirma · Voltar cancela</p>

                    <div className="pm-modal-buttons">
                        <button
                            className={`pm-btn pm-btn-cancel ${deleteFocusIndex === 0 ? 'tv-focused' : ''}`}
                            onClick={() => { setMode('list'); setDeleteTarget(null); }}
                        >
                            Cancelar
                        </button>
                        <button
                            className={`pm-btn pm-btn-danger ${deleteFocusIndex === 1 ? 'tv-focused' : ''}`}
                            onClick={handleDeleteProfile}
                        >
                            Excluir
                        </button>
                    </div>
                </div>
            )}
            {/* Sair do modo Kids exige o PIN parental (item 55) — e mexer
                num perfil adulto a partir do Kids também (T046) */}
            {parentalTarget && (
                <PinPrompt
                    title={pendingAction === 'switch' ? 'Sair do modo Kids' : 'Controle parental'}
                    parental
                    confirmLabel={pendingAction === 'switch' ? undefined : ROTULO_ACAO[pendingAction]}
                    hint={pendingAction === 'switch'
                        ? `Digite o PIN parental para entrar em "${parentalTarget.name}".`
                        : `Digite o PIN parental para ${pendingAction === 'edit' ? 'editar' : 'excluir'} "${parentalTarget.name}".`}
                    onSubmit={async (pin) => {
                        const ok = await parentalService.verify(pin);
                        if (!ok) return false;
                        const target = parentalTarget;
                        setParentalTarget(null);
                        // O PIN do PRÓPRIO perfil ainda vale depois deste
                        // (a ação pendente segue a mesma até o fim)
                        if (target.pin) {
                            setPendingProfile(target);
                            setMode('pin-verify');
                        } else {
                            executarAcao(target, pendingAction);
                        }
                        return true;
                    }}
                    onCancel={() => setParentalTarget(null)}
                />
            )}
        </div>
    );
}
