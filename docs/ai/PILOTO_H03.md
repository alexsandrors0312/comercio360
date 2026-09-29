# Piloto H-03 — revisão independente do validador

Estado em 29/09/2026: **preparado, despacho tentado, worker sem resposta**. A primeira tentativa foi rejeitada pelo auto-review antes de alcançar o worker. O usuário depois autorizou expressamente o acesso às aplicações e ao repositório para esta etapa. A nova chamada `dsh_delegate` chegou à ponte, mas terminou em `DSH_RUN_FAILED (exit=1)`; uma chamada mínima repetiu a falha. Nenhum relatório do worker foi produzido. O diagnóstico está em [INTEGRACAO_VSCODE.md](INTEGRACAO_VSCODE.md).

## Tarefa delimitada

Worker de revisão, somente leitura. Conferir se `scripts/harness/validate.mjs` realmente rejeita os casos prometidos em `docs/ai/CONTRATOS_HARNESS.md`, com foco em travessia de caminho, symlinks, allowlist, evidência ausente e diferença entre o diff Git e `changed_files`. Apontar até três falhas reproduzíveis ou declarar que nenhuma foi encontrada no escopo examinado. Não alterar código, documentação, configuração, Git ou dados.

Fontes mínimas para leitura: `AGENTS.md`, `context.md`, `docs/ai/CONTRATOS_HARNESS.md`, `scripts/harness/validate.mjs` e `tests/harness-contract.test.mjs`. Base Git: capturar SHA completo imediatamente antes do envio e exigir árvore limpa. O caminho MCP `cwd` dá ao worker acesso potencial ao repositório inteiro; a lista de fontes é uma restrição de tarefa, **não um bloqueio técnico de leitura**. Não incluir `.env.local`, credenciais ou logs privados no briefing.

Critérios: (A1) cada achado tem entrada mínima, resultado esperado/observado e arquivo/linha; (A2) execução ou não execução dos testes é declarada; (A3) relatório JSON segue `docs/ai/CONTRATOS_HARNESS.md`; (A4) nenhum arquivo foi modificado. O orquestrador valida o JSON, confere `git status`, reproduz achados e só então registra a revisão. Tempo, modelo efetivo e tokens são medidos apenas se a ferramenta os expuser.

A autorização de envio foi dada em 29/09 e não precisa ser pedida novamente para este piloto. Antes de novo despacho, resolver a falha do provedor, conferir `dsh_health` e registrar base Git atual limpa. A autorização não equivale a envio de segredos, escrita pelo worker, publicação ou acesso a produção.
