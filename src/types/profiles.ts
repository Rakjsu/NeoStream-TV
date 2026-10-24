// Profile Types for NeoStream TV

export interface Profile {
    id: string;
    name: string;
    avatar: string; // Emoji
    pin?: string; // SHA-256 hash (optional)
    isKids?: boolean;
    createdAt: string;
    lastUsed: string;
}

export interface ProfilesData {
    profiles: Profile[];
    activeProfileId: string | null;
}

export interface CreateProfileData {
    name: string;
    avatar: string;
    pin?: string; // Plain text, will be hashed
    isKids?: boolean;
}

export interface UpdateProfileData {
    name?: string;
    avatar?: string;
    pin?: string | null; // null to remove PIN
}
