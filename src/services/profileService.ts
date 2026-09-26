// Profile Service for NeoStream TV
import type { Profile, ProfilesData, CreateProfileData, UpdateProfileData } from '../types/profile';
import { purgeProfileData } from './profileScope';
import { writeJson } from './safeStorage';

const STORAGE_KEY = 'neostream_tv_profiles';
/** Teto de perfis. Exportado para a tela dizer o número quando ele bate (T047). */
export const MAX_PROFILES = 5;

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

        return saveStorageData(data);
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

        const hashedPin = await hashPin(pin);
        return hashedPin === profile.pin;
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
