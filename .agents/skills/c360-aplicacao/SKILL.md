---
name: c360-aplicacao
description: Implementar Server Actions, consultas e adaptadores de servidor do Comércio 360 a partir de contratos de domínio e dados aceitos.
---

# Aplicação e backend

Leia `AGENTS.md`, `context.md`, interfaces aceitas e somente os fluxos afetados. Antes de editar código Next.js, leia os guias pertinentes em `node_modules/next/dist/docs/`, como exige `AGENTS.md`.

Revalide usuário, vínculo e loja no servidor em cada operação; cookie de contexto é preferência, nunca permissão. Preserve a distinção entre ausência de acesso, erro de entrada e falha de infraestrutura. Use chave administrativa fora do runtime web. `React.cache` de `requireAccess` vale apenas na renderização da mesma requisição; não faça autorização persistente com esse cache.

Cubra revogação e isolamento tenant/loja nos testes afetados. Siga `docs/ai/CONTRATOS_HARNESS.md` ao relatar alteração e evidência; retorne ao orquestrador se DTO, RPC ou política de acesso estiverem indefinidos.
