---
name: c360-verificar
description: Validar uma entrega do Comércio 360 por QA independente ou revisão de segurança e arquitetura, com evidência reproduzível.
---

# Verificar uma entrega

Leia `AGENTS.md`, `context.md`, contrato, base e alteração candidata. Escolha um modo explícito: **QA** executa critérios e testes pertinentes; **Segurança/Arquitetura** revisa autorização, tenant, concorrência, auditoria, arquivos e fronteiras modulares. Na revisão independente, examine a alteração antes de adotar o relato do autor. Não aprove o próprio trabalho.

Identifique ambiente e base de cada evidência. PGlite, Auth simulado, navegador local, Supabase descartável e HTTPS de aplicação são provas distintas. Um teste não executado é `not_run`, com motivo; não enfraqueça asserções para obter PASS. Registre condição de disparo, impacto, arquivo/linha e reprodução de cada achado.

Use o contrato de revisão e resultado em `docs/ai/CONTRATOS_HARNESS.md`. A conclusão `no_blocking_findings` significa apenas ausência de achados bloqueantes no escopo examinado, não aprovação geral ou gate de produção.
