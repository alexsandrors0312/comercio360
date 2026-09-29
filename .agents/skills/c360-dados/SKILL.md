---
name: c360-dados
description: Implementar ou revisar migrações, RLS, RPCs e integridade PostgreSQL do Comércio 360 em um pacote autorizado.
---

# Dados do Comércio 360

Leia `AGENTS.md`, `context.md`, o contrato aceito e somente as migrações, helpers e testes SQL relevantes. As migrações `202609070001_foundation.sql` e `202609080001_tenant_key_guards.sql` já foram aplicadas: acrescente migração incremental, não reescreva o histórico nem use reset/repair para contornar divergência.

Preserve `organizations.id` como raiz do tenant, FKs compostas para impedir referências cruzadas, acesso explícito à loja, RLS e auditoria atômica append-only. Não trate papel de gerente ou proprietário como bypass de loja. Teste fronteiras de tenant, revogação e mutações estruturais quando afetadas. Para Storage, leia a especificação de arquivos do pacote antes de propor políticas.

Reporte SQL/arquivos alterados, base, verificações realmente executadas e riscos no formato de `docs/ai/CONTRATOS_HARNESS.md`. Não aplique banco remoto, não manipule credenciais e devolva decisões de produto abertas ao orquestrador.
