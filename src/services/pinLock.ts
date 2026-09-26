// Limite de tentativas de um PIN de 4 dígitos (T048).
//
// Nasceu dentro do parentalService: sem ele o gate era uma senha de 4 dígitos
// SEM limite nenhum — 10.000 combinações, e um controle de TV faz uma
// tentativa por segundo. Uma tarde de domingo bastava. O PIN de entrada de
// cada perfil tem exatamente o mesmo espaço e ficava sem nada disso; por isso
// a trava saiu daqui para servir aos dois.
//
// O contador precisa sobreviver a fechar e reabrir o app (é o primeiro reflexo
// de quem está tentando), então quem cria a trava diz ONDE ela mora no
// armazenamento — nunca em memória.
//
// A espera cresce a cada rodada de erros: 30s, 2min, 10min, 30min. Passar de
// 30min seria punir o adulto que esqueceu o PIN — que é o caso muito mais
// comum que o do invasor.

/** Erros tolerados antes da primeira espera. */
const ERROS_ATE_TRAVAR = 5;
const ESPERAS_MS: readonly number[] = [30_000, 120_000, 600_000, 1_800_000];

export interface EstadoTrava {
    /** Erros desde o último acerto */
    erros: number;
    /** Instante (epoch ms) em que a espera acaba; 0 = sem espera */
    travadoAte: number;
    /** Quantas rodadas de espera já aconteceram (escolhe a duração) */
    rodadas: number;
}

export const SEM_TRAVA: EstadoTrava = { erros: 0, travadoAte: 0, rodadas: 0 };

/** Onde o estado da trava mora. Ler nunca lança; gravar SEM_TRAVA apaga. */
export interface ArmazemDeTrava {
    ler(): EstadoTrava;
    gravar(estado: EstadoTrava): void;
}

/** O que a tela precisa para mostrar a espera e as tentativas que restam. */
export interface TravaVisivel {
    /** Quanto falta da espera, em ms. 0 = pode tentar. */
    restanteMs(): number;
    /** Quantas tentativas ainda restam antes da próxima espera. */
    tentativasRestantes(): number;
}

export interface TravaDePin extends TravaVisivel {
    /**
     * Confere um PIN contando o erro ou zerando no acerto. Durante a espera
     * nem chega a chamar `confere`: cada tentativa recusada aqui é uma
     * tentativa que não conta pro invasor — e nem o PIN certo passa.
     */
    conferir(confere: () => Promise<boolean>): Promise<boolean>;
    /**
     * Conta um erro sem conferir PIN nenhum — para outra prova que divide o
     * MESMO limite (a senha da conta no resgate do PIN parental, T073).
     */
    registrarErro(): void;
    /** Zera a contagem — ao definir ou remover o PIN. */
    limpar(): void;
}

export function estaVazia(estado: EstadoTrava): boolean {
    return estado.erros === 0 && estado.travadoAte === 0 && estado.rodadas === 0;
}

/** Estado lido do armazenamento; lixo vira "sem trava" (nem trava nem abre). */
export function normalizarEstado(bruto: unknown): EstadoTrava {
    if (!bruto || typeof bruto !== 'object') return SEM_TRAVA;
    const parcial = bruto as Partial<Record<keyof EstadoTrava, unknown>>;
    return {
        erros: Number(parcial.erros) || 0,
        travadoAte: Number(parcial.travadoAte) || 0,
        rodadas: Number(parcial.rodadas) || 0,
    };
}

export function criarTravaDePin(armazem: ArmazemDeTrava): TravaDePin {
    const trava: TravaDePin = {
        restanteMs(): number {
            const { travadoAte } = armazem.ler();
            if (!travadoAte) return 0;
            const falta = travadoAte - Date.now();
            // Relógio da TV pra trás (ou fuso mudando) não pode travar pra sempre
            if (falta > ESPERAS_MS[ESPERAS_MS.length - 1]) {
                armazem.gravar(SEM_TRAVA);
                return 0;
            }
            return falta > 0 ? falta : 0;
        },

        tentativasRestantes(): number {
            return Math.max(0, ERROS_ATE_TRAVAR - armazem.ler().erros);
        },

        async conferir(confere: () => Promise<boolean>): Promise<boolean> {
            if (trava.restanteMs() > 0) return false;

            const ok = await confere();
            if (ok) {
                armazem.gravar(SEM_TRAVA);
                return true;
            }

            trava.registrarErro();
            return false;
        },

        registrarErro(): void {
            const estado = armazem.ler();
            const erros = estado.erros + 1;
            if (erros >= ERROS_ATE_TRAVAR) {
                const espera = ESPERAS_MS[Math.min(estado.rodadas, ESPERAS_MS.length - 1)];
                armazem.gravar({ erros: 0, travadoAte: Date.now() + espera, rodadas: estado.rodadas + 1 });
            } else {
                armazem.gravar({ ...estado, erros });
            }
        },

        limpar(): void {
            armazem.gravar(SEM_TRAVA);
        },
    };
    return trava;
}
