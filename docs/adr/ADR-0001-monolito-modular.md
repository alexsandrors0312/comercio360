# ADR-0001 — Monólito modular

Estado: aceita na arquitetura base v0.1; aplicada em 07/09/2026.

Contexto: a fundação precisa evoluir sem distribuir prematuramente transações e permissões.

Decisão: uma aplicação Next.js, com limites explícitos entre domínio, validação, UI, configuração e adaptador de dados. `app` fica na raiz, simplificação permitida pela arquitetura. A comunicação com Supabase fica em `lib`; fixtures ficam em `mocks`.

Alternativas: monorepo com aplicações separadas e microsserviços. Não são necessários para o pacote atual e aumentariam a operação.

Impacto: build e deploy únicos; futuras extrações preservam contratos de domínio. Nenhuma migração adicional de dados é exigida por essa organização de arquivos. Reversão: mover a aplicação para `apps/web` mantendo interfaces e atualizar imports/comandos.

Risco: imports indevidos podem dissolver limites. O domínio permanece sem dependências de framework, banco ou dados fictícios; revisar esse limite nas futuras entregas.
