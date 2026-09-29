# Piloto H-03 — revisão independente do validador

Estado em 29/09/2026: **preparado, não executado**. A primeira tentativa de delegação DSH foi rejeitada pelo auto-review antes de alcançar o worker. O motivo foi ausência de autorização explícita para enviar documentos privados do repositório ao serviço/modelo externo.

## Tarefa delimitada

Worker de revisão, somente leitura. Conferir se `scripts/harness/validate.mjs` realmente rejeita os casos prometidos em `docs/ai/CONTRATOS_HARNESS.md`, com foco em travessia de caminho, symlinks, allowlist, evidência ausente e diferença entre o diff Git e `changed_files`. Apontar até três falhas reproduzíveis ou declarar que nenhuma foi encontrada no escopo examinado. Não alterar código, documentação, configuração, Git ou dados.

Fontes mínimas para leitura: `AGENTS.md`, `context.md`, `docs/ai/CONTRATOS_HARNESS.md`, `scripts/harness/validate.mjs` e `tests/harness-contract.test.mjs`. Base Git: capturar SHA completo imediatamente antes do envio e exigir árvore limpa. O caminho MCP `cwd` dá ao worker acesso potencial ao repositório inteiro; a lista de fontes é uma restrição de tarefa, **não um bloqueio técnico de leitura**. Não incluir `.env.local`, credenciais ou logs privados no briefing.

Critérios: (A1) cada achado tem entrada mínima, resultado esperado/observado e arquivo/linha; (A2) execução ou não execução dos testes é declarada; (A3) relatório JSON segue `docs/ai/CONTRATOS_HARNESS.md`; (A4) nenhum arquivo foi modificado. O orquestrador valida o JSON, confere `git status`, reproduz achados e só então registra a revisão. Tempo, modelo efetivo e tokens são medidos apenas se a ferramenta os expuser.

Autorização pendente: permitir explicitamente o envio desse briefing e a leitura dessas fontes pelo serviço/modelo externo DSH. Se aprovado, conferir novamente `dsh_health` e o estado da base antes de despachar. Uma eventual aprovação não autoriza envio de segredos, escrita pelo worker, publicação ou acesso a produção.
