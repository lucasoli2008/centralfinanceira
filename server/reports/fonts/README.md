# Fontes dos relatórios de Obras

`Geist-{Regular,Medium,SemiBold,Bold}.ttf` — Geist Sans v1.7.2, © Vercel, licenciada sob a
[SIL Open Font License 1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.TXT).
Mesma família usada na interface (`next/font/google`), embutida aqui em TTF porque o
`@react-pdf/renderer` só aceita arquivos locais/URL em TTF ou WOFF.

Registradas em `server/reports/work-fonts.ts`. Se os arquivos não existirem no ambiente de
execução, os relatórios caem para Helvetica sem quebrar.
