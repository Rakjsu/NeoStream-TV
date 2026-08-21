// Versão do esquema de armazenamento (item 84).
//
// O app já precisou migrar dado duas vezes (playlists e escopo por perfil), e
// nas duas a solução foi uma flag avulsa — que ninguém acha depois e que não
// diz NADA sobre o que já rodou. Aqui há um número só, e migrações numeradas
// que rodam em ordem.
//
// Regra: instalação NOVA nasce na versão atual (não roda migração nenhuma).

import { readRaw, writeRaw } from './safeStorage';
import { TODAS_AS_BASES } from './storageKeys';

const VERSION_KEY = 'neostream_schema_version';
export const CURRENT_SCHEMA = 2;

type Migration = { to: number; describe: string; run: () => void };

// Nada aqui ainda: a v2 é o estado atual do app. A migração de escopo por
// perfil da R6 tem flag própria (`neostream_scope_migrated`) e já rodou nas
// instalações existentes — reexecutá-la aqui seria pior que deixá-la onde está.
const MIGRATIONS: Migration[] = [];

function detectExistingInstall(): boolean {
    try {
        for (const base of TODAS_AS_BASES) {
            if (localStorage.getItem(base) !== null) return true;
        }
    } catch {
        return false;
    }
    return false;
}

export const storageSchema = {
    current(): number {
        const raw = Number(readRaw(VERSION_KEY));
        if (Number.isFinite(raw) && raw > 0) return raw;
        // Sem marca: ou é instalação nova (nasce na atual) ou é uma anterior
        // ao versionamento (nasce na 1, pra migração futura poder agir)
        return detectExistingInstall() ? 1 : CURRENT_SCHEMA;
    },

    /** Roda no boot, antes de qualquer leitura de dado. */
    migrate(): void {
        let version = this.current();
        for (const migration of MIGRATIONS) {
            if (migration.to <= version) continue;
            try {
                migration.run();
                version = migration.to;
            } catch (error) {
                console.error(`[storage] migração para v${migration.to} falhou:`, error);
                // Grava só até onde REALMENTE chegou e sai. Escrever
                // CURRENT_SCHEMA aqui marcaria como feita uma migração que
                // FALHOU — ela nunca mais seria tentada e o dado que ela
                // deveria converter ficaria perdido em silêncio.
                writeRaw(VERSION_KEY, String(version));
                return;
            }
        }
        writeRaw(VERSION_KEY, String(Math.max(version, CURRENT_SCHEMA)));
    },
};
