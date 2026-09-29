---
name: c360-orquestrar
description: Planejar, delegar e integrar um pacote autorizado do Comércio 360; usar ao coordenar trabalho entre especialidades, não para uma correção isolada.
---

# Orquestrar o Comércio 360

Leia `AGENTS.md` e `context.md` antes de definir a tarefa. Confirme no código e nos documentos citados o estado, a base Git e a autorização. `docs/PACOTE_002_CATALOGO_PROPOSTA.md` ainda é proposta: análise é possível, implementação comercial exige aceite do produto e ADR.

Use `docs/ai/PLANO_ORQUESTRACAO.md` para a sequência H-01–H-06 e `docs/ai/CONTRATOS_HARNESS.md` para o envelope e o resultado. Distribua uma unidade observável por worker, com referências mínimas, dono dos arquivos, invariantes, critérios e condição de parada. Preserve `context.md` como índice de continuidade. Não envie a árvore inteira por padrão.

Escolha modelo e revisão conforme risco; uma correção local simples não precisa de delegação. Confirme a disponibilidade de cada runtime antes de despachar. Skill e allowlist textual orientam o trabalho, mas não provam isolamento. Aceite a integração somente após conferir alteração real, evidências e revisão independente quando o risco exigir. Registre o que ficou `not_run` sem transformá-lo em PASS.
