// Controle parental (item 55).
//
// Um PIN único do APARELHO, separado do PIN de entrada de cada perfil: ele
// protege as duas portas de saída do modo Kids — abrir as Configurações e
// trocar de um perfil kids para um perfil adulto. Sem isso o gate Kids era
// decorativo: bastava abrir o gerenciador e clicar no perfil Principal, que
// nasce sem PIN nenhum.

import { writeRaw, removeKey } from './safeStorage';
import { criarTravaDePin, estaVazia, normalizarEstado, SEM_TRAVA, type EstadoTrava } from './pinLock';

const PIN_KEY = 'neostream_parental_pin';
const GATES_KEY = 'neostream_parental_gates';
const LOCK_KEY = 'neostream_parental_lock';
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

// ---------------------------------------------------------------------------
// Limite de tentativas: 5 erros e a espera cresce (30s, 2min, 10min, 30min).
// A regra mora em pinLock (é a mesma do PIN de perfil, T048); aqui só o lugar
// onde o estado vive — a chave de sempre, no formato de sempre, para quem já
// estava em espera continuar em espera depois de atualizar o app.
// ---------------------------------------------------------------------------

function lerTrava(): EstadoTrava {
    try {
        const raw = localStorage.getItem(LOCK_KEY);
        return raw ? normalizarEstado(JSON.parse(raw)) : SEM_TRAVA;
    } catch {
        return SEM_TRAVA;
    }
}

function gravarTrava(estado: EstadoTrava): void {
    if (estaVazia(estado)) {
        removeKey(LOCK_KEY);
        return;
    }
    // Pelo safeStorage: com a quota cheia a gravação crua falhava muda, o
    // contador nunca persistia e o limite de 5 erros deixava de existir.
    writeRaw(LOCK_KEY, JSON.stringify(estado));
}

const trava = criarTravaDePin({ ler: lerTrava, gravar: gravarTrava });

async function hash(pin: string): Promise<string> {
    const data = new TextEncoder().encode(SALT + pin);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export const parentalService = {
    /** Há PIN parental configurado neste aparelho? */
    isSet(): boolean {
        return !!localStorage.getItem(PIN_KEY);
    },

    /**
     * Grava o PIN. FALSE também quando não coube (quota cheia mesmo depois de
     * podar os caches): a tela não pode anunciar "PIN criado" para um PIN que
     * some no próximo boot — o controle parental ficaria desligado sem aviso.
     */
    async set(pin: string): Promise<boolean> {
        if (!/^\d{4}$/.test(pin)) return false;
        if (!writeRaw(PIN_KEY, await hash(pin)).ok) return false;
        // Quem consegue DEFINIR o PIN já provou que é o dono do aparelho
        gravarTrava(SEM_TRAVA);
        return true;
    },

    clear(): void {
        removeKey(PIN_KEY);
        gravarTrava(SEM_TRAVA);
    },

    /**
     * Confere o PIN. Sem PIN configurado retorna FALSE de propósito: quem
     * chama pergunta antes se o gate está ativo (isSet), e um verify
     * fail-open transforma "sem PIN" em "qualquer PIN serve".
     */
    async verify(pin: string): Promise<boolean> {
        const stored = localStorage.getItem(PIN_KEY);
        if (!stored) return false;
        // Em espera nem chega a comparar (a trava recusa antes do hash)
        return trava.conferir(async () => (await hash(pin)) === stored);
    },

    /** Quanto falta da espera, em ms. 0 = pode tentar. */
    travaRestanteMs(): number {
        return trava.restanteMs();
    },

    /** Quantas tentativas ainda restam antes da próxima espera. */
    tentativasRestantes(): number {
        return trava.tentativasRestantes();
    },

    /** Zera a contagem — usado ao definir ou remover o PIN. */
    limparTrava(): void {
        trava.limpar();
    },

    getGates(): ParentalGates {
        try {
            const raw = localStorage.getItem(GATES_KEY);
            return raw ? { ...DEFAULT_GATES, ...JSON.parse(raw) } : DEFAULT_GATES;
        } catch {
            return DEFAULT_GATES;
        }
    },

    /** FALSE quando a trava não coube: a tela mantém o estado anterior. */
    setGates(gates: Partial<ParentalGates>): boolean {
        return writeRaw(GATES_KEY, JSON.stringify({ ...this.getGates(), ...gates })).ok;
    },

    /** O PIN é exigido pra esta porta agora? */
    requires(gate: keyof ParentalGates): boolean {
        return this.isSet() && this.getGates()[gate];
    },
};
