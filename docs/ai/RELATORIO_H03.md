# H-03 — piloto de revisão independente do validador

Data: 29/09/2026. Base examinada: `1a30bbda6d0a81bc372df3bc1ea9056548b3d5df`, com árvore Git limpa no despacho. A autorização de envio ao DSH já constava do projeto. `dsh_health` confirmou DSH 0.1.5-rc.3, perfil `headless` e workspace permitido; uma tarefa mínima retornou `READY` pela rota MCP.

## Execuções e evidência

A primeira revisão H-03 atingiu `DSH_TIMEOUT` em 300000 ms; a ponte reteve a saída parcial. A árvore permaneceu limpa, a ponte encerrou o processo filho no timeout e não se tratou essa tentativa como entrega. A segunda revisão, mais curta e sem testes pelo worker, retornou JSON final com três achados. O tempo total da segunda chamada, modelo efetivo, tokens e custo não foram expostos pelo MCP e permanecem indisponíveis. A seleção local de `deepseek-v4-pro` não substitui telemetria de execução.

O resultado estruturado está em [H03_RESULTADO_DSH_2026-09-29.json](H03_RESULTADO_DSH_2026-09-29.json), SHA-256 `D45AECD56835DCF23A2B89101504143F30C2034AE0D5183EB7B03F723D22B556`. O comando `node scripts/harness/validate.mjs result` aceitou o JSON contra a base original ainda limpa. Depois das alterações locais, a validação estrutural pela API corrigida passou com `actualChanges: []` e `checkGit: false`; isso **não** revalida a base histórica contra o novo `HEAD`. Git confirmou ausência de alterações produzidas pelo worker. O worker declarou testes `not_run`, como solicitado na segunda chamada.

## Achados reproduzidos independentemente

| ID | Reprodução e alcance | Correção |
| --- | --- | --- |
| H03-1 | Após `validateTask`, avançar `HEAD` por um commit e chamar `validateResult` com a tarefa antiga. A API aceitava; a CLI já rejeitava porque revalidava a tarefa. | `validateResult` confere o `HEAD` contra `baseline.ref` por padrão. |
| H03-2 | Alterar arquivo tracked, fazer `git add` e restaurar só o worktree ao conteúdo de `HEAD`. `git diff --name-only HEAD` ficava vazio apesar do índice diferente; CLI e API aceitavam tarefa/resultado somente leitura. | Unir diferenças do worktree, índice e arquivos untracked sem duplicar caminhos. |
| H03-3 | Informar `findings[].evidence_refs` inexistente ou com `../`, mantendo evidências de critérios e checks válidas. API e CLI aceitavam. | Exigir evidência em cada achado e validar existência/caminho seguro. |

Os três casos foram reproduzidos em repositórios temporários, fora da árvore principal, antes da correção. Depois, `npm run test:harness` passou com **14/14 testes** e seis skills verificadas; `node --check` nos dois arquivos alterados, ESLint direcionado e `git diff --check` passaram. Os testes novos cobrem as condições de disparo e a distinção API/CLI, não apenas a forma do código. Código Next.js, migrações, dependências e evidências H1 não mudaram.

## Limites e próximo passo

O validador ainda não é sandbox ou dispatcher. Comparação de Git pressupõe worktree isolada e não vê arquivos ignorados; operação exata de cada arquivo, conteúdo sensível do relatório e semântica de aceite do produto ainda exigem revisão. H-03 verificou a rota de worker, o contrato JSON e a detecção/correção de achados neste recorte. A avaliação comparativa H-04 segue [protocolo próprio](AVALIACAO_H04.md) e **não foi executada**.
