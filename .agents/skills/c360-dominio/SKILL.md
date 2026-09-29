---
name: c360-dominio
description: Criar regras puras, normalização e validações de um módulo aceito do Comércio 360, com testes de fronteira.
---

# Domínio e validação

Leia `AGENTS.md`, `context.md` e o contrato aceito do módulo. Consulte `packages/domain/`, `packages/validation/` e testes pertinentes; mantenha regras puras independentes de Supabase, rede e interface.

Explicite unidades, limites, estados e erros. Diferencie valor ausente de zero; para dinheiro, use representação e arredondamento definidos pelo contrato, sem inventar política comercial. Cubra entradas inválidas, fronteiras e exemplos aceitos com testes proporcionais. Se a regra necessária ainda não foi decidida, devolva a pergunta e o impacto em vez de completar por plausibilidade.

Entregue resultado e evidências conforme `docs/ai/CONTRATOS_HARNESS.md`; não transforme a proposta de Catálogo 002 em autorização para implementar.
