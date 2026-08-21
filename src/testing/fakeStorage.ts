// localStorage de mentira COM QUOTA, para os testes.
//
// O jsdom tem localStorage, mas o `setItem` dele nunca lança
// QuotaExceededError — e a quota é exatamente o comportamento crítico do
// safeStorage, do progressService e do catalogCache. Um stub de vinte linhas
// cobre o que o jsdom não cobre, e roda em ambiente node (mais rápido).

export interface FakeStorage {
    store: Map<string, string>;
    /** Bytes usados (UTF-16: 2 por unidade de código, como a spec) */
    used(): number;
}

/**
 * Instala um localStorage falso no globalThis.
 * @param quotaBytes teto em bytes; Infinity por padrão
 */
export function installFakeStorage(quotaBytes = Infinity): FakeStorage {
    const store = new Map<string, string>();
    const bytes = (chave: string, valor: string) => (chave.length + valor.length) * 2;
    const used = () => {
        let total = 0;
        for (const [chave, valor] of store) total += bytes(chave, valor);
        return total;
    };

    const fake = {
        getItem: (chave: string) => store.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
            const anterior = store.has(chave) ? bytes(chave, store.get(chave) as string) : 0;
            if (used() - anterior + bytes(chave, valor) > quotaBytes) {
                const erro = new Error('QuotaExceededError');
                erro.name = 'QuotaExceededError';
                throw erro;
            }
            store.set(chave, valor);
        },
        removeItem: (chave: string) => { store.delete(chave); },
        clear: () => { store.clear(); },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
    };

    (globalThis as unknown as { localStorage: unknown }).localStorage = fake;
    return { store, used };
}

/** Define o perfil ativo (os serviços leem isto pra escopar as chaves). */
export function setPerfilAtivo(id: string | null): void {
    if (id === null) {
        localStorage.removeItem('neostream_tv_profiles');
        return;
    }
    localStorage.setItem('neostream_tv_profiles', JSON.stringify({
        profiles: [{ id, name: id, avatar: '👤', createdAt: '', lastUsed: '' }],
        activeProfileId: id,
    }));
}
