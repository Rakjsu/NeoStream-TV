// Controle parental (item 55).
//
// Um PIN único do APARELHO, separado do PIN de entrada de cada perfil: ele
// protege as duas portas de saída do modo Kids — abrir as Configurações e
// trocar de um perfil kids para um perfil adulto. Sem isso o gate Kids era
// decorativo: bastava abrir o gerenciador e clicar no perfil Principal, que
// nasce sem PIN nenhum.

const PIN_KEY = 'neostream_parental_pin';
const GATES_KEY = 'neostream_parental_gates';
// O hash mora em localStorage de um aparelho doméstico e o espaço é de 4
// dígitos: o sal não torna isso forte, só impede que a mesma tabela sirva
// para todos os aparelhos. Isto é um obstáculo para criança, não um cofre.
const SALT = 'neostream-tv-parental-v1';

export interface ParentalGates {
    /** Pedir PIN pra abrir as Configurações */
    settings: boolean;
    /** Pedir PIN pra sair de um perfil kids */
    leaveKids: boolean;
}

const DEFAULT_GATES: ParentalGates = { settings: true, leaveKids: true };

async function hash(pin: string): Promise<string> {
    const data = new TextEncoder().encode(SALT + pin);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function safeWrite(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // quota — a preferência se perde, o app não cai
    }
}

export const parentalService = {
    /** Há PIN parental configurado neste aparelho? */
    isSet(): boolean {
        return !!localStorage.getItem(PIN_KEY);
    },

    async set(pin: string): Promise<boolean> {
        if (!/^\d{4}$/.test(pin)) return false;
        safeWrite(PIN_KEY, await hash(pin));
        return true;
    },

    clear(): void {
        safeWrite(PIN_KEY, null);
    },

    /**
     * Confere o PIN. Sem PIN configurado retorna FALSE de propósito: quem
     * chama pergunta antes se o gate está ativo (isSet), e um verify
     * fail-open transforma "sem PIN" em "qualquer PIN serve".
     */
    async verify(pin: string): Promise<boolean> {
        const stored = localStorage.getItem(PIN_KEY);
        if (!stored) return false;
        return (await hash(pin)) === stored;
    },

    getGates(): ParentalGates {
        try {
            const raw = localStorage.getItem(GATES_KEY);
            return raw ? { ...DEFAULT_GATES, ...JSON.parse(raw) } : DEFAULT_GATES;
        } catch {
            return DEFAULT_GATES;
        }
    },

    setGates(gates: Partial<ParentalGates>): void {
        safeWrite(GATES_KEY, JSON.stringify({ ...this.getGates(), ...gates }));
    },

    /** O PIN é exigido pra esta porta agora? */
    requires(gate: keyof ParentalGates): boolean {
        return this.isSet() && this.getGates()[gate];
    },
};
