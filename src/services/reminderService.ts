// Lembretes de programa (backlog item 3): 🔔 num programa futuro → aviso na
// tela ~1 min antes com botão "Assistir agora". Timers vivem enquanto o app
// está aberto (sem Node/serviço na TV); o estado persiste em localStorage e
// é reidratado no boot, então lembrete perdido com o app fechado não some —
// só não dispara notificação.

const KEY = 'neostream_reminders';
const LEAD_MS = 60 * 1000; // avisa 1 min antes
const KEEP_AFTER_MS = 10 * 60 * 1000; // guarda 10 min após o início (limpeza)

export interface Reminder {
    id: string; // `${streamId}|${startMs}`
    streamId: number;
    channelName: string;
    programTitle: string;
    /** epoch ms do início do programa (já com o offset de fuso aplicado) */
    startMs: number;
}

type Listener = (reminder: Reminder) => void;

let listeners: Listener[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function read(): Reminder[] {
    try {
        const raw = localStorage.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as Reminder[]).filter(r => r && r.id && r.startMs) : [];
    } catch {
        return [];
    }
}

function write(list: Reminder[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
        // Quota — perder o lembrete é melhor que quebrar o app
    }
}

function fire(reminder: Reminder): void {
    for (const listener of listeners) {
        try {
            listener(reminder);
        } catch {
            // Um listener quebrado não pode derrubar os outros
        }
    }
}

function schedule(reminder: Reminder): void {
    clearTimer(reminder.id);
    const delay = reminder.startMs - LEAD_MS - Date.now();
    // setTimeout com delay > ~24.8 dias estoura o int32 e dispara na hora;
    // lembrete tão distante nem precisa de timer agora.
    if (delay > 2 ** 31 - 1) return;
    if (delay <= 0) {
        // Já passou da hora do aviso mas o programa ainda não começou
        if (reminder.startMs > Date.now()) fire(reminder);
        return;
    }
    timers.set(reminder.id, setTimeout(() => {
        timers.delete(reminder.id);
        fire(reminder);
        reminderService.remove(reminder.id);
    }, delay));
}

function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer) {
        clearTimeout(timer);
        timers.delete(id);
    }
}

export const reminderService = {
    reminderId(streamId: number, startMs: number): string {
        return `${streamId}|${startMs}`;
    },

    list(): Reminder[] {
        return read();
    },

    has(streamId: number, startMs: number): boolean {
        const id = this.reminderId(streamId, startMs);
        return read().some(r => r.id === id);
    },

    /** Liga/desliga o lembrete; devolve true se ficou ATIVO. */
    toggle(input: Omit<Reminder, 'id'>): boolean {
        const id = this.reminderId(input.streamId, input.startMs);
        const list = read();
        const index = list.findIndex(r => r.id === id);
        if (index >= 0) {
            list.splice(index, 1);
            write(list);
            clearTimer(id);
            return false;
        }
        const reminder: Reminder = { ...input, id };
        list.push(reminder);
        write(list);
        schedule(reminder);
        return true;
    },

    remove(id: string): void {
        write(read().filter(r => r.id !== id));
        clearTimer(id);
    },

    /** Reidrata os timers no boot e limpa os vencidos. */
    init(): void {
        const now = Date.now();
        const alive = read().filter(r => r.startMs > now - KEEP_AFTER_MS);
        write(alive);
        for (const reminder of alive) schedule(reminder);
    },

    subscribe(listener: Listener): () => void {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    },
};
