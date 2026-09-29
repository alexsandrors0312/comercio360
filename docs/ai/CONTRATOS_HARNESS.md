# Contratos propostos para o harness

Data: 28/09/2026; implementação inicial em 29/09/2026. Contrato versão 0.1. Complemento do [plano de orquestração](PLANO_ORQUESTRACAO.md). Há um validador local parcial em `scripts/harness/validate.mjs`; ele não é dispatcher nem sandbox. Os exemplos são sintéticos e não representam execução nem autorização do Catálogo.

## 1. Envelope de tarefa

O orquestrador cria um envelope por unidade de trabalho. Usar identificadores estáveis e uma revisão de contrato. Caminhos são relativos ao workspace identificado; nunca resolver fora dele por concatenação sem validação. Referências de leitura são um recorte inicial que pode ser ampliado com justificativa. Escrita exige atribuição explícita.

| Campo obrigatório | Conteúdo |
| --- | --- |
| `schema_version`, `task_id`, `contract_revision` | Versões e identidade da tarefa |
| `objective`, `mode` | Resultado observável; `analysis`, `implementation` ou `review` |
| `authorization` | Fonte real da autorização e seu alcance; não inventar aceite |
| `workspace`, `baseline` | Caminho e commit; sem Git, manifesto SHA-256 dos insumos; mudanças locais incluídas na identidade da base |
| `role`, `runtime`, `model`, `reasoning` | Perfil e configuração solicitados; confirmar configuração efetiva no retorno |
| `depends_on` | Entregas requeridas, revisões e estado; pendência material impede trabalho dependente |
| `read_refs`, `write_allowlist`, `protected_paths` | Fontes, escopo de escrita e arquivos históricos protegidos |
| `invariants`, `acceptance` | Regras aplicáveis e critérios com IDs verificáveis |
| `checks` | Comandos ou inspeções esperados, ambiente, resultado exigido e quem executa |
| `constraints`, `stop_conditions` | Limites, orçamento operacional e motivos para devolver controle |

Exemplo de tarefa **apenas de análise** que pode existir antes do aceite comercial:

```json
{
  "schema_version": "0.1",
  "task_id": "EXEMPLO-CAT-ANALISE-01",
  "contract_revision": 1,
  "objective": "Identificar decisões ainda abertas sobre preço por loja na proposta do catálogo.",
  "mode": "analysis",
  "authorization": {"source": "Pedido de análise arquitetural", "scope": "Somente análise"},
  "workspace": "C:/Users/Alexs/Desktop/Comercio360",
  "baseline": {"kind": "manifest", "ref": null, "status": "capture_before_dispatch"},
  "role": "domain-validation",
  "runtime": "codex-native",
  "model": "gpt-6-sol",
  "reasoning": "medium",
  "depends_on": [],
  "read_refs": [
    "AGENTS.md",
    "context.md",
    "docs/PACOTE_002_CATALOGO_PROPOSTA.md"
  ],
  "write_allowlist": [],
  "protected_paths": ["supabase/migrations", "docs/H1_RESULTADOS.json"],
  "invariants": ["Ausência de preço não significa zero", "Preço exige escopo explícito de loja"],
  "acceptance": [{"id": "A1", "criterion": "Cada lacuna aponta trecho-fonte e impacto observável"}],
  "checks": [{"id": "V1", "kind": "inspection", "target": "A1", "environment": "local", "owner": "worker"}],
  "constraints": {"network": "not_needed", "nested_delegation": false, "summary_words_target": 500},
  "stop_conditions": ["Fonte contraditória sem decisão posterior", "Necessidade de editar código"]
}
```

Esse exemplo não pode ser despachado enquanto `baseline.ref` for nulo. O manifesto deve existir e incluir hashes das fontes lidas. Um contrato de implementação também exige que a autorização cubra o pacote e que dependências bloqueantes estejam aceitas.

Na implementação inicial do validador, somente `baseline.kind = "git"` com `ref` igual ao SHA completo de `HEAD` é aceito. O modo `task` exige árvore Git limpa. `manifest` permanece especificado, mas ainda não é suportado. A allowlist aceita arquivo exato ou prefixo de diretório terminado em `/`. Perfis não recebem permissão efetiva por constarem no JSON: o runtime precisa aplicar seu próprio isolamento.

Contratos de interfaces devem especificar operação, entrada, saída, erro, autorização, escopo de tenant/loja, atomicidade, idempotência, versão de concorrência e efeito auditável quando aplicável. Se um campo não se aplica, registrar o motivo. Não usar um DTO TypeScript como substituto de toda a semântica.

## 2. Resultado do worker

Retornar JSON válido, sem texto solto quando houver consumidor automatizado. Em operação manual, o mesmo conteúdo pode acompanhar um resumo curto. Os campos abaixo são obrigatórios; listas vazias são permitidas quando verdadeiras. Não incluir raciocínio interno, segredos nem logs brutos.

```json
{
  "schema_version": "0.1",
  "task_id": "EXEMPLO-CAT-ANALISE-01",
  "contract_revision": 1,
  "status": "needs_context",
  "baseline_ref": null,
  "actual_execution": {"runtime": null, "model": null, "reasoning": null},
  "summary": "Exemplo não executado: falta registrar a base antes de despachar.",
  "artifacts": [],
  "changed_files": [],
  "criteria": [{"id": "A1", "status": "not_run", "evidence_refs": []}],
  "checks": [],
  "findings": [],
  "assumptions": [],
  "context_requests": [{"item": "Manifesto da base", "reason": "Rastrear a versão analisada"}],
  "risks": [],
  "metrics": {"elapsed_seconds": null, "input_tokens": null, "output_tokens": null, "cost": null, "source": "unavailable"},
  "next_action": "Capturar a base e emitir a tarefa real."
}
```

Estados do worker: `ready_for_review`, `needs_context`, `blocked`, `failed`. Eles não concedem aceite final. Critérios/verificações usam `pass`, `fail`, `not_run` ou `not_applicable`; os dois últimos exigem motivo. Se um critério obrigatório não foi verificado, ele continua pendente mesmo quando a parte implementada está pronta para revisão.

Cada verificação executada deve registrar ID, comando ou procedimento, diretório, data/hora, ambiente, status, código de saída quando houver, resumo de asserções e referência de evidência sanitizada. A evidência identifica a revisão dos artefatos testados. Código zero é necessário para comandos de teste, mas não substitui verificar que os cenários esperados rodaram.

Cada artefato informa caminho, tipo e hash. Cada arquivo alterado informa operação (`added`, `modified` ou `deleted`) e finalidade. Em uma revisão sem escrita, `changed_files` deve estar vazio. Métricas indisponíveis são `null`, nunca zero inventado.

## 3. Regras do validador

O validador inicial usa Zod com campos obrigatórios, enumerações, tipos e rejeição de campos desconhecidos na versão 0.1. Versão não suportada exige migração explícita. Para executar: `node scripts/harness/validate.mjs task caminho/tarefa.json` antes do despacho e `node scripts/harness/validate.mjs result caminho/tarefa.json caminho/resultado.json` após a entrega. No modo de implementação, a segunda chamada compara caminhos alterados no Git com a allowlist e o relatório; ela pressupõe worktree isolada para aquela tarefa. O parse não basta; também é necessário validar:

1. IDs/revisões correspondem à tarefa; base e hashes existem e continuam compatíveis.
2. Caminhos resolvidos ficam no workspace permitido; rejeitar travessia, links que escapem do escopo e escrita fora da atribuição. Comparar alterações reais, não apenas a lista fornecida pelo worker.
3. Todas as condições de aceite têm resposta e referências; `pass` sem evidência é inválido.
4. Verificação não executada não recebe timestamp/código falsos; uso desconhecido permanece `null`.
5. Documentação, migrações históricas e evidência H1 protegidas permanecem íntegras fora de uma autorização específica.
6. Resultado de implementação não é aceito como análise e resultado de análise não autoriza mutação posterior.
7. Base alterada desde a revisão invalida somente as conclusões afetadas, com registro de revalidação necessária.
8. Relatório ou artefato com dado sensível é interrompido antes de encaminhamento; sanitização não pode ser presumida pelo nome do arquivo.

Os testes negativos em `tests/harness-contract.test.mjs` cobrem versão/forma, travessia, caminho protegido, PASS sem evidência, base divergente e alteração fora da atribuição. A implementação confere SHA de artefatos declarados e existência dos caminhos usados como evidência. **Ainda são conferências manuais**: conteúdo sensível em relatório, semântica do aceite de produto, estado real de dependências, revisão afetada por rebase e operação exata (`added`/`modified`/`deleted`) frente ao Git. A checagem de caminhos protege o controlador; não substitui um sandbox real e não impede escrita indevida antes da inspeção.

## 4. Contrato da revisão independente

Entrada: tarefa aceita para execução, base, alteração candidata, contratos consumidos e critérios. O revisor lê o código/SQL relevante completo e escolhe verificações proporcionais ao risco. Recebe evidências do autor para conferir, sem adotar sua conclusão como resultado esperado.

Saída: `review_id`, `task_id`, base candidata identificada, escopo efetivamente examinado, verificações executadas/não executadas, achados e conclusão (`no_blocking_findings`, `changes_required` ou `inconclusive`). Cada achado contém gravidade, arquivo/linha quando aplicável, condição de disparo, impacto, evidência e correção esperada no comportamento. Não exigir uma implementação específica quando várias atendem ao contrato.

Revisão sem achados bloqueantes permite seguir à integração, mas não comprova gates que não foram executados. Autor e revisor devem ser contextos distintos; podem usar o mesmo modelo. Diferença de modelo é uma opção de avaliação, não prova de independência ou qualidade.

## 5. Registro de integração e retomada

Somente o orquestrador mantém o registro consolidado: objetivo autorizado, contrato atual, base, tarefas/dependências, arquivos e respectivos donos, decisões aceitas, hipóteses abertas, artefatos, revisões, comandos/resultados, condições operacionais e próxima ação.

Estados do registro: `planned`, `running`, `awaiting_dependency`, `awaiting_review`, `integrated`, `accepted`, `blocked` ou `canceled`. `accepted` exige critérios do escopo atendidos e validação da integração; não equivale a autorização de produção. Subtarefas canceladas ou falhas permanecem no histórico. A autorização do usuário já registrada não deve ser solicitada novamente a cada worker.

Checkpoint após mudança de contrato, integração ou interrupção: salvar apenas o estado necessário à retomada e referências aos detalhes. Não copiar o histórico integral da conversa. Falhas anteriores ficam preservadas como falhas; correções geram novas evidências.

## 6. Transporte DeepSeek

Atualização de 28/09 após o [diagnóstico real da ponte](DIAGNOSTICO_DSH_MCP.md): serializar objetivo, contexto, base, fontes, invariantes, aceite e saída esperada em `task`; passar a raiz autorizada em `cwd` e, opcionalmente, `timeout_ms` entre 1000 e 600000. A ponte instalada não aceita `context`, `sandbox` ou `max_iterations`; esses argumentos da skill anterior estavam incorretos e foram removidos. O envelope lógico das seções anteriores continua válido, mas não é enviado como argumentos extras ao MCP.

Se o retorno não puder ser interpretado no contrato, rejeitar o status de conclusão e pedir correção limitada da estrutura ou registrar bloqueio. Não declarar validação de saída estruturada nativa do DSH: a ponte retorna texto final e o controlador ainda precisa validá-lo. Modelo/telemetria não expostos são registrados como indisponíveis. O `dsh_health` respondeu OK no cliente recarregado em 29/09. A primeira tarefa real foi barrada pela revisão automática por falta de autorização explícita para enviar documentos privados do repositório ao serviço/modelo externo; não houve execução do worker nem validação de entrega DSH.
