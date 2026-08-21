// Controle parental (item 55).
//
// Um PIN único do APARELHO, separado do PIN de entrada de cada perfil: ele
// protege as duas portas de saída do modo Kids — abrir as Configurações e
// trocar de um perfil kids para um perfil adulto. Sem isso o gate Kids era
// decorativo: bastava abrir o gerenciador e clicar no perfil Principal, que
// nasce sem PIN nenhum.

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
// Limite de tentativas.
//
// Sem isto o gate era uma senha de 4 dígitos SEM limite nenhum: 10.000
// combinações, e um controle de TV faz uma tentativa por segundo. Uma tarde de
// domingo bastava. E como o contador de tentativas precisa sobreviver a fechar
// e reabrir o app (é o primeiro reflexo de quem está tentando), ele vive em
// localStorage e não em memória.
//
// A espera cresce a cada rodada de erros: 30s, 2min, 10min, 30min. Passar de
// 30min seria punir o adulto que esqueceu o PIN — que é o caso muito mais
// comum que o do invasor.
// ---------------------------------------------------------------------------

/** Erros tolerados antes da primeira espera. */
const ERROS_ATE_TRAVAR = 5;
const ESPERAS_MS = [30_000, 120_000, 600_000, 1_800_000];

interface EstadoTrava {
    /** Erros desde o último acerto */
    erros: number;
    /** Instante (epoch ms) em que a espera acaba; 0 = sem espera */
    travadoAte: number;
    /** Quantas rodadas de espera já aconteceram (escolhe a duração) */
    rodadas: number;
}

const SEM_TRAVA: EstadoTrava = { erros: 0, travadoAte: 0, rodadas: 0 };

function lerTrava(): EstadoTrava {
    try {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return SEM_TRAVA;
        const parsed = JSON.parse(raw) as Partial<EstadoTrava>;
        return {
            erros: Number(parsed.erros) || 0,
            travadoAte: Number(parsed.travadoAte) || 0,
            rodadas: Number(parsed.rodadas) || 0,
        };
    } catch {
        return SEM_TRAVA;
    }
}

function gravarTrava(estado: EstadoTrava): void {
    if (estado.erros === 0 && estado.travadoAte === 0 && estado.rodadas === 0) {
        safeWrite(LOCK_KEY, null);
        return;
    }
    safeWrite(LOCK_KEY, JSON.stringify(estado));
}

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
        // Quem consegue DEFINIR o PIN já provou que é o dono do aparelho
        gravarTrava(SEM_TRAVA);
        return true;
    },

    clear(): void {
        safeWrite(PIN_KEY, null);
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
        // Em espera nem chega a comparar: cada tentativa recusada aqui é uma
        // tentativa que não conta pro invasor
        if (this.travaRestanteMs() > 0) return false;

        const ok = (await hash(pin)) === stored;
        const estado = lerTrava();
        if (ok) {
            gravarTrava(SEM_TRAVA);
            return true;
        }

        const erros = estado.erros + 1;
        if (erros >= ERROS_ATE_TRAVAR) {
            const espera = ESPERAS_MS[Math.min(estado.rodadas, ESPERAS_MS.length - 1)];
            gravarTrava({ erros: 0, travadoAte: Date.now() + espera, rodadas: estado.rodadas + 1 });
        } else {
            gravarTrava({ ...estado, erros });
        }
        return false;
    },

    /** Quanto falta da espera, em ms. 0 = pode tentar. */
    travaRestanteMs(): number {
        const { travadoAte } = lerTrava();
        if (!travadoAte) return 0;
        const falta = travadoAte - Date.now();
        // Relógio da TV pra trás (ou fuso mudando) não pode travar pra sempre
        if (falta > ESPERAS_MS[ESPERAS_MS.length - 1]) {
            gravarTrava(SEM_TRAVA);
            return 0;
        }
        return falta > 0 ? falta : 0;
    },

    /** Quantas tentativas ainda restam antes da próxima espera. */
    tentativasRestantes(): number {
        return Math.max(0, ERROS_ATE_TRAVAR - lerTrava().erros);
    },

    /** Zera a contagem — usado ao definir ou remover o PIN. */
    limparTrava(): void {
        gravarTrava(SEM_TRAVA);
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
