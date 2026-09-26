// Profile Service for NeoStream TV
import type { Profile, ProfilesData, CreateProfileData, UpdateProfileData } from '../types/profile';
import { purgeProfileData } from './profileScope';
import { writeJson, writeRaw, removeKey } from './safeStorage';
import { criarTravaDePin, estaVazia, normalizarEstado, SEM_TRAVA, type EstadoTrava, type TravaDePin, type TravaVisivel } from './pinLock';

const STORAGE_KEY = 'neostream_tv_profiles';
const MAX_PROFILES = 5;

// ---------------------------------------------------------------------------
// Limite de tentativas do PIN de PERFIL (T048).
//
// O PIN parental já travava depois de 5 erros; o de perfil tem o mesmo espaço
// de 4 dígitos e não tinha limite nenhum — do Kids, o PIN do adulto caía numa
// tarde. A regra é a mesma (pinLock), com uma trava POR PERFIL: errar o PIN
// de um não tranca a porta do outro. Todas moram numa chave só, { id: estado },
// fora do registro do perfil: a lista de perfis é regravada a cada troca, e a
// contagem não pode depender dessa gravação.
// ---------------------------------------------------------------------------

const PIN_LOCK_KEY = 'neostream_profile_pin_lock';

function lerTravas(): Record<string, EstadoTrava> {
    const travas: Record<string, EstadoTrava> = {};
    try {
        const raw = localStorage.getItem(PIN_LOCK_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return travas;
        for (const id of Object.keys(parsed)) {
            travas[id] = normalizarEstado((parsed as Record<string, unknown>)[id]);
        }
    } catch {
        // Chave corrompida: nem trava nem abre — recomeça a contagem
    }
    return travas;
}

function gravarTravaDoPerfil(profileId: string, estado: EstadoTrava): void {
    const travas = lerTravas();
    if (estaVazia(estado)) delete travas[profileId];
    else travas[profileId] = estado;
    if (Object.keys(travas).length === 0) {
        removeKey(PIN_LOCK_KEY);
        return;
    }
    // Pelo safeStorage: com a quota cheia o contador precisa caber (poda os
    // caches), senão o limite deixava de existir sem ninguém ver
    writeRaw(PIN_LOCK_KEY, JSON.stringify(travas));
}

const travasPorPerfil = new Map<string, TravaDePin>();

function travaDoPerfil(profileId: string): TravaDePin {
    let trava = travasPorPerfil.get(profileId);
    if (!trava) {
        trava = criarTravaDePin({
            ler: () => {
                const travas = lerTravas();
                return Object.prototype.hasOwnProperty.call(travas, profileId) ? travas[profileId] : SEM_TRAVA;
            },
            gravar: estado => gravarTravaDoPerfil(profileId, estado),
        });
        travasPorPerfil.set(profileId, trava);
    }
    return trava;
}

// Simple SHA-256 hash
async function hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get all data from storage
function getStorageData(): ProfilesData {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            return { profiles: [], activeProfileId: null };
        }
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading profiles from storage:', error);
        return { profiles: [], activeProfileId: null };
    }
}

// Grava pelo safeStorage (poda os caches se a quota estourar) e CONTA se
// coube. Com a quota cheia o setItem cru falhava num console.error que
// ninguém lê na TV, e a tela seguia como se o perfil existisse.
function saveStorageData(data: ProfilesData): boolean {
    const saved = writeJson(STORAGE_KEY, data).ok;
    if (!saved) console.error('Error saving profiles to storage: quota');
    return saved;
}

// Generate unique ID
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export const profileService = {
    // Get all profiles
    getAllProfiles(): Profile[] {
        const data = getStorageData();
        return data.profiles;
    },

    // Get active profile
    getActiveProfile(): Profile | null {
        const data = getStorageData();
        if (!data.activeProfileId) return null;
        return data.profiles.find(p => p.id === data.activeProfileId) || null;
    },

    // Set active profile
    setActiveProfile(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        data.activeProfileId = profileId;
        profile.lastUsed = new Date().toISOString();
        return saveStorageData(data);
    },

    // Clear active profile
    clearActiveProfile(): void {
        const data = getStorageData();
        data.activeProfileId = null;
        saveStorageData(data);
    },

    // Create new profile
    async createProfile(profileData: CreateProfileData): Promise<Profile | null> {
        const data = getStorageData();

        if (data.profiles.length >= MAX_PROFILES) {
            console.error(`Cannot create profile: maximum of ${MAX_PROFILES} profiles reached`);
            return null;
        }

        if (!profileData.name || profileData.name.trim().length === 0) {
            console.error('Profile name is required');
            return null;
        }

        if (profileData.name.length > 20) {
            console.error('Profile name must be 20 characters or less');
            return null;
        }

        const now = new Date().toISOString();
        const newProfile: Profile = {
            id: generateId(),
            name: profileData.name.trim(),
            avatar: profileData.avatar || '👤',
            pin: profileData.pin ? await hashPin(profileData.pin) : undefined,
            isKids: profileData.isKids || false,
            createdAt: now,
            lastUsed: now
        };

        data.profiles.push(newProfile);

        // If this is the first profile, set it as active
        if (data.profiles.length === 1) {
            data.activeProfileId = newProfile.id;
        }

        // null quando não coube: o perfil sumiria no próximo boot
        if (!saveStorageData(data)) return null;
        return newProfile;
    },

    // Update profile
    async updateProfile(profileId: string, updates: UpdateProfileData): Promise<boolean> {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        if (updates.name !== undefined) {
            if (updates.name.trim().length === 0 || updates.name.length > 20) {
                console.error('Invalid profile name');
                return false;
            }
            profile.name = updates.name.trim();
        }

        if (updates.avatar !== undefined) {
            profile.avatar = updates.avatar;
        }

        if (updates.pin !== undefined) {
            if (updates.pin === null) {
                delete profile.pin;
            } else {
                profile.pin = await hashPin(updates.pin);
            }
        }

        const saved = saveStorageData(data);
        // PIN trocado ou removido: a contagem era do PIN velho. Quem chega a
        // editar já passou pela porta (T046), como no parentalService.set.
        if (saved && updates.pin !== undefined) travaDoPerfil(profileId).limpar();
        return saved;
    },

    // Delete profile
    deleteProfile(profileId: string): boolean {
        const data = getStorageData();

        if (data.activeProfileId === profileId) {
            console.error('Cannot delete active profile');
            return false;
        }

        const index = data.profiles.findIndex(p => p.id === profileId);
        if (index === -1) return false;

        // Cannot delete kids profile
        if (data.profiles[index].isKids) {
            console.error('Cannot delete Kids profile');
            return false;
        }

        const removedId = data.profiles[index].id;
        data.profiles.splice(index, 1);
        // Se a lista sem o perfil não foi gravada, ele continua existindo —
        // apagar o dado dele agora o faria voltar vazio no próximo boot
        if (!saveStorageData(data)) return false;
        // Sem isto, favoritos/progresso do perfil excluido ficariam orfaos no
        // localStorage e voltariam se alguem recriasse um perfil com o mesmo id
        purgeProfileData(removedId);
        // A trava do PIN dele também: sem isto ficava órfã na chave
        travaDoPerfil(removedId).limpar();
        return true;
    },

    // Verify PIN
    async verifyPin(profileId: string, pin: string): Promise<boolean> {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        // Perfil sem PIN nao "aceita qualquer PIN": quem chama pergunta antes
        // com hasPin(). O fail-open aqui fazia o modo Kids ser contornavel.
        if (!profile.pin) return false;

        // 5 erros e vem a espera (T048); durante ela nem o PIN certo passa
        const stored = profile.pin;
        return travaDoPerfil(profileId).conferir(async () => (await hashPin(pin)) === stored);
    },

    /**
     * A trava do PIN deste perfil, só para LER: espera restante e tentativas
     * (PinPrompt). Contar e zerar ficam aqui dentro (verifyPin/updateProfile).
     */
    travaDoPin(profileId: string): TravaVisivel {
        return travaDoPerfil(profileId);
    },

    // Check if profile has PIN
    hasPin(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        return profile ? !!profile.pin : false;
    },

    // Initialize with default profile if empty
    initialize(): void {
        const data = getStorageData();
        if (data.profiles.length === 0) {
            const now = new Date().toISOString();

            // Create default profile
            const defaultProfile: Profile = {
                id: 'default',
                name: 'Principal',
                avatar: '👤',
                createdAt: now,
                lastUsed: now
            };

            // Create Kids profile
            const kidsProfile: Profile = {
                id: 'kids-default',
                name: 'Kids',
                avatar: '👶',
                isKids: true,
                createdAt: now,
                lastUsed: now
            };

            data.profiles.push(defaultProfile, kidsProfile);
            data.activeProfileId = 'default';
            saveStorageData(data);
        }
    }
};
