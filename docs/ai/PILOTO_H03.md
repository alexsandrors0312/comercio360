# Piloto H-03 — revisão independente do validador

Estado em 29/09/2026: **preparado, despacho tentado, worker sem resposta**. A primeira tentativa foi rejeitada pelo auto-review antes de alcançar o worker. O usuário depois autorizou expressamente o acesso às aplicações e ao repositório para esta etapa. A nova chamada `dsh_delegate` chegou à ponte, mas terminou em `DSH_RUN_FAILED (exit=1)`; chamadas mínimas repetiram a falha. Após o responsável configurar as chaves no DSH Web e no VS Code, `dsh_health` continuou OK, mas uma chamada mínima em conexão MCP nova ainda retornou `DSH_RUN_FAILED (exit=1; category=authentication)`. Nenhum relatório do worker foi produzido. O diagnóstico está em [INTEGRACAO_VSCODE.md](INTEGRACAO_VSCODE.md).

**Continuação após confirmação do responsável:** a chamada MCP mínima respondeu `READY`. A primeira revisão H-03 atingiu timeout de 300000 ms, sem relatório; uma segunda revisão delimitada retornou JSON 0.1 com três achados, todos reproduzidos e corrigidos. Consulte [RELATORIO_H03.md](RELATORIO_H03.md) e o [resultado do worker](H03_RESULTADO_DSH_2026-09-29.json). O parágrafo anterior preserva o estado histórico daquele ensaio, não o estado atual.

## Tarefa delimitada

Worker de revisão, somente leitura. Conferir se `scripts/harness/validate.mjs` realmente rejeita os casos prometidos em `docs/ai/CONTRATOS_HARNESS.md`, com foco em travessia de caminho, symlinks, allowlist, evidência ausente e diferença entre o diff Git e `changed_files`. Apontar até três falhas reproduzíveis ou declarar que nenhuma foi encontrada no escopo examinado. Não alterar código, documentação, configuração, Git ou dados.

Fontes mínimas para leitura: `AGENTS.md`, `context.md`, `docs/ai/CONTRATOS_HARNESS.md`, `scripts/harness/validate.mjs` e `tests/harness-contract.test.mjs`. Base Git: capturar SHA completo imediatamente antes do envio e exigir árvore limpa. O caminho MCP `cwd` dá ao worker acesso potencial ao repositório inteiro; a lista de fontes é uma restrição de tarefa, **não um bloqueio técnico de leitura**. Não incluir `.env.local`, credenciais ou logs privados no briefing.

Critérios: (A1) cada achado tem entrada mínima, resultado esperado/observado e arquivo/linha; (A2) execução ou não execução dos testes é declarada; (A3) relatório JSON segue `docs/ai/CONTRATOS_HARNESS.md`; (A4) nenhum arquivo foi modificado. O orquestrador valida o JSON, confere `git status`, reproduz achados e só então registra a revisão. Tempo, modelo efetivo e tokens são medidos apenas se a ferramenta os expuser.

A autorização de envio foi dada em 29/09 e não precisou ser pedida novamente para este piloto. O despacho concluído usou base Git limpa e não incluiu segredos nem escrita pelo worker. O aceite do piloto não equivale a autorização de publicação, produção ou Catálogo 002.
