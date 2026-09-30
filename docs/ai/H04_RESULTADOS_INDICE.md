# Índice leve dos resultados H-03/H-04 (JSONs)

Data: 29/09/2026. Mitigação C do [diagnóstico de tokens](DIAGNOSTICO_TOKENS.md). **Leia este índice em vez dos 8 JSONs completos** (54.646 B ≈ 14 k tokens). Abra um JSON somente quando precisar do texto exato de um check, critério ou `reason`. Os JSONs são evidência congelada — **não alterá-los retroativamente**; os SHAs abaixo identificam cada arquivo.

## H-04 — pares e estados

| Arquivo | Braço | Status | Checks | Critérios |
| --- | --- | --- | --- | --- |
| [H04_D1_CODEX_RESULTADO_2026-09-29.json](H04_D1_CODEX_RESULTADO_2026-09-29.json) | Codex D1 | `ready_for_review` | V1–V3 pass | A1–A5 pass |
| [H04_D1_DSH_RESULTADO_2026-09-29.json](H04_D1_DSH_RESULTADO_2026-09-29.json) | DSH D1 | `ready_for_review` | V1 **fail** (Vitest no sandbox, `spawn EPERM`); V2–V3 pass | A1–A5 pass |
| [H04_S1_CODEX_RESULTADO_2026-09-29.json](H04_S1_CODEX_RESULTADO_2026-09-29.json) | Codex S1 | `ready_for_review` | V1–V4 pass; V5 not_run | A1–A6 pass |
| [H04_S1_DSH_RESULTADO_2026-09-29.json](H04_S1_DSH_RESULTADO_2026-09-29.json) | DSH S1 final | `ready_for_review` | V1–V2 **fail** (Vitest no sandbox, `require is not defined`); V3–V4 pass; V5 not_run | A1–A3, A6 pass; A4–A5 not_run |
| [H04_S1_DSH_REVISAO1_2026-09-29.json](H04_S1_DSH_REVISAO1_2026-09-29.json) | DSH S1 revisão 1 (não aceita) | `ready_for_review` | V1–V2 fail; V3–V4 pass; V5 not_run | A1–A6 pass |
| [H04_S1_DSH_RETOMADA_REJEITADA_2026-09-29.json](H04_S1_DSH_RETOMADA_REJEITADA_2026-09-29.json) | DSH S1 retomada (rejeitada: IDs V1/V2 remapeados) | `ready_for_review` | V1–V2 pass (inspeção/Git, não os comandos do envelope); V3–V5 not_run | A1–A6 pass |
| [H04_U1_CODEX_RESULTADO_2026-09-29.json](H04_U1_CODEX_RESULTADO_2026-09-29.json) | Codex U1 | `ready_for_review` | V1 **fail** (gate E2E original pendente); V2–V3 pass; V4 not_run | A1–A6 pass |

## Resumo por caso (leitura mínima)

- **D1:** ambos os braços corrigem `selectContext` e passam revisão independente; DSH registrou FAIL honesto no check Vitest do sandbox e o teste passou 7/7 fora dele. Par sem comparação de rapidez/custo (Codex interrompido por créditos; telemetria indisponível).
- **S1:** DSH teve timeout de 600 s, retomada rejeitada e duas rodadas de revisão (dependências de ordem no PGlite) até o final aceito; Codex passou na primeira revisão. Migração corretiva restaura vínculo ativo em `private.can_access_store`; nenhum banco hospedado alterado.
- **U1:** Codex entregou correção do menu com revisão estática sem achados bloqueantes; Playwright travou no teardown e o harness externo passou 2/2 focados; a falha do texto `404` é pré-existente. **U1-V1 (suíte E2E completa) permanece pendente**; U1 DSH em andamento.
- **H-03 (piloto):** [H03_RESULTADO_DSH_2026-09-29.json](H03_RESULTADO_DSH_2026-09-29.json) — três achados no validador, reproduzidos e corrigidos; integrado em `4a80096`. Ver [RELATORIO_H03.md](RELATORIO_H03.md).

## Âncoras de integridade (SHA-256)

| Arquivo | SHA-256 |
| --- | --- |
| H03_RESULTADO_DSH_2026-09-29.json | `D45AECD56835DCF23A2B89101504143F30C2034AE0D5183EB7B03F723D22B556` |
| H04_D1_CODEX_RESULTADO_2026-09-29.json | `B5271F4E7B5BB5A08C40557913E629FC2FC897DD0299EB5D3E43E2CB4721948B` |
| H04_D1_DSH_RESULTADO_2026-09-29.json | `6EC3E5AB501DBCAA5407543E7E04F8484D73701BB5177535C3CF587CFCCFD03B` |
| H04_S1_CODEX_RESULTADO_2026-09-29.json | `94F6A7927B723A7F56E02ABF2755EF4E016B5EEE540D8544FD6DDAACA036D687` |
| H04_S1_DSH_RESULTADO_2026-09-29.json | `9C9EBB9D478098B64C440873B3D551165B4F174B973DA68E5EC730A5F3F3429F` |
| H04_S1_DSH_RETOMADA_REJEITADA_2026-09-29.json | `6807BE7F428DD68FCFF9C1E5BBBA87340F44CAB9A3A0A2B8BBAAFB0436A773A9` |
| H04_S1_DSH_REVISAO1_2026-09-29.json | `705089444F82B2E61E8BE872F8750493F11F43882EA435CCAAEE208BFF839135` |
| H04_U1_CODEX_RESULTADO_2026-09-29.json | `2D817CB68666D2B5E654DDEF98F573F41D0902C3A3B0B3972E80025A82F515DE` |

Execução e contexto completos: [RELATORIO_H04.md](RELATORIO_H04.md); protocolo: [AVALIACAO_H04.md](AVALIACAO_H04.md).
