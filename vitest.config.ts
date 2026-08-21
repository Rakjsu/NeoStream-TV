import { defineConfig } from 'vitest/config'

// Config SEPARADA do vite.config.ts de propósito: aquele carrega o
// @vitejs/plugin-legacy e o terser, que não servem pra nada em teste e
// custam segundos por execução.
export default defineConfig({
    test: {
        // Ambiente node por padrão. O único arquivo que precisa de DOM é o
        // teste do useTVNavigation, que declara jsdom no próprio arquivo.
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        // TZ fixo: sete módulos dependem do relógio e o EPG depende de fuso.
        // Sem isto o primeiro teste vermelho aparece no CI, numa máquina UTC,
        // e não na máquina de quem escreveu.
        env: { TZ: 'America/Sao_Paulo' },
        reporters: 'dot',
    },
})
