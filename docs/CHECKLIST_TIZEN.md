# Checklist Tizen / TV-first

Use antes de empacotar para Samsung Tizen ou quando mexer em
navegação, foco, inputs ou player.

## Navegação por D-pad
- [ ] ↑ ↓ ← → movem foco em todas as direções esperadas
- [ ] Enter (OK) ativa o item focado
- [ ] Back (tecla Voltar do controle) volta uma camada e nunca fecha o app sem intenção
- [ ] Nenhum item interativo fica inalcançável só com D-pad (sem depender de mouse)
- [ ] Em modais/players, o D-pad da página é desativado
  (`useTVNavigation({ enabled: false })`) e o controle vai para o modal

## Foco visível
- [ ] Todo elemento focável tem indicador visual claro (outline, scale, borda)
- [ ] Foco inicial faz sentido ao entrar em cada tela
- [ ] Ao fechar modal/player, o foco volta para o elemento que abriu

## Inputs (crítico no Tizen)
- [ ] Backspace e IME seguem funcionando nos inputs do Login (que são
      controlados — o que importa é o bypass do `useTVNavigation`, abaixo)
- [ ] Sem `type="password"` (usar máscara manual) e sem `readOnly`
- [ ] `tizenhwkey` capturado para fechar o teclado nativo
- [ ] Backspace funciona durante digitação
- [ ] `useTVNavigation` é bypassado quando o foco está num input

## Player
- [ ] Abre ao Enter ou ao clicar em "Assistir"
- [ ] Botão "Fechar" e tecla Back fecham o player
- [ ] `isLive`/`contentType="live"` setados corretamente para canais ao vivo
- [ ] Quality menu navega com D-pad
- [ ] Em VOD, posição de retomada (`resumeTime`) é respeitada

## Build
Os portões de qualidade do CI (`.github/workflows/ci.yml`, tabela "Quality
gates" do README) valem aqui também: empacotar sem eles é mandar pra TV o
que o CI recusaria.

- [ ] `npx tsc -b` passa sem erros (o mesmo type-check do build e do CI;
      `tsc --noEmit` deixa erros passarem num projeto com references)
- [ ] `npm run lint` passa sem warnings
- [ ] `npm test` passa (suíte inteira verde)
- [ ] `npm run check:css` passa — CSS que o Chromium 69 ignora não quebra o
      build nem aparece no navegador de dev: só some na TV
- [ ] `npm run build` (Web) gera artefatos sem erro
- [ ] `npm run build:tizen` gera output com transpile legacy aplicado
- [ ] `npm audit --omit=dev --audit-level=high` passa — só as dependências de produção, as que vão
      dentro do `.wgt` (a TV não se atualiza sozinha: pacote vulnerável fica lá até reinstalar)
- [ ] `npm run check:bundle` passa — sempre DEPOIS do `build:tizen`, que é
      quem produz o `dist-tizen/assets` que ele mede
- [ ] `tizen/config.xml` com `id`/`version` corretos para release

## Visual em TV
- [ ] Layout legível a ~3m de distância (fontes ≥ 22px em listas, ≥ 32px em títulos)
- [ ] Contraste alto, evitar cinza-claro sobre branco
- [ ] Sem scroll com mouse — tudo deve responder a Page Up/Down ou D-pad
- [ ] Imagens com fallback (`brokenImages` Set já implementado em LiveTV/Movies)
