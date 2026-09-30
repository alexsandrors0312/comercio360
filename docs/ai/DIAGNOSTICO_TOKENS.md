# Diagnóstico — consumo de tokens no harness (H-04)

Data: 29/09/2026. Escopo: identificar onde o fluxo atual gasta tokens em excesso e propor mitigação. Base: `context.md`, `AGENTS.md`, `PLANO_ORQUESTRACAO.md`, `RELATORIO_H04.md`, `AVALIACAO_H04.md`, `CONTRATOS_HARNESS.md`, JSONs de resultado e o estado real da pasta. Estimativas de tokens são ordem de grandeza (~4 bytes/token para texto pt-BR), não telemetria.

## Sorvedouros encontrados (por ordem de impacto)

### 1. `context.md` virou diário corrido, e é relido inteiro a cada tarefa
- Tamanho: **26.297 bytes (~6.500 tokens)**; `AGENTS.md`: 1.063 bytes (~270 tokens). Par obrigatório ≈ **6.800 tokens no início de toda tarefa**, antes de qualquer trabalho.
- A seção "Desenvolvimento por IA" acumula ~20 parágrafos datados (linhas 63–99), cada um renarrando a saga DSH inteira + o fato novo. É crescimento **append-only sem poda**, exatamente o que o próprio plano proíbe: "context.md permanece um índice de estado atual. Detalhes extensos ficam em documento de módulo" (PLANO §7) — regra não cumprida.
- `AGENTS.md` + `context.md` + as seis skills exigem a leitura "no início de cada tarefa, inclusive de workers". Em H-04 (3 casos × 2 braços × worker+revisor) são ≥ 12 leituras obrigatórias só dessa entrada, mais as do orquestrador a cada passo → ordem de **~170.000 tokens** gastos apenas re-lendo o mesmo índice crescente.

### 2. A mesma narrativa DSH é recontada em 5+ documentos
A saga (ponte MCP, credenciais, READY, timeouts, EPERM, retrabalho) aparece duplicada em: `context.md` (linhas 63–99), `PLANO_ORQUESTRACAO.md` (§2, §12, §16), `RELATORIO_H04.md` ("Transporte DSH"), `INTEGRACAO_VSCODE.md` (9,3 KB) e `DIAGNOSTICO_DSH_MCP.md` (7,9 KB). Mesmo fato, várias redações, todas candidatas a releitura.

### 3. Envelopes/resultados JSON verbosos, relidos 3–4× por caso
- 8 JSONs somam **54.646 bytes (~14.000 tokens)**. Cada resultado repete `criteria` + `checks` completos (procedure, cwd, timestamp, exit_code, assertions, evidence_refs, reason) que em grande parte **duplicam** `artifacts`/`changed_files`.
- O mesmo arquivo é lido pelo worker (escreve), orquestrador (valida), revisor cego (relê) e renarrado no `RELATORIO_H04.md`. O resultado S1-DSH (7,8 KB) foi lido ≥ 4×.
- `evidence_refs` repete os mesmos dois caminhos em quase todos os blocos (ver `H04_S1_DSH_RESULTADO`).

### 4. Retrabalho S1 = reenvio integral do contexto × 5
O braço DSH S1 consumiu: timeout (600 s) → retomada só-leitura → JSON rejeitado (IDs remapeados) → revisão 1 rejeitada (dependência de ordem) → revisão 2 (segunda dependência de ordem) → final. Como a delegação DSH é **sem reaproveitamento de sessão** (cada chamada é um agente novo), cada retomada re-enviou briefing + releu `AGENTS.md`/`context.md`/envelope/base. O custo-base é multiplicado por 5 num único caso. Codex passou na 1ª revisão; DSH precisou de várias — o retrabalho é o maior multiplicador isolado.

### 5. Vitest bloqueado no sandbox DSH → execução tripla
`spawn EPERM` (D1) e `ReferenceError: require is not defined` (S1) impedem o worker DSH de rodar Vitest. Consequência: o teste roda (a) dentro do worker = FAIL; (b) fora, pelo orquestrador = PASS; (c) de novo pelo revisor cego = PASS. A mesma verificação é executada 3×, e o check continua registrado FAIL no JSON para "re-execução". É desperdício estrutural, não acidental.

### 6. Revisão independente re-lê tudo e re-executa checks já feitos
Cada revisor cego re-lê a entrada obrigatória (`AGENTS.md`/`context.md`), o envelope, o diff completo e **repete** tsc/diff/vitest que o worker já rodou. Para caso puro (D1), é revisão sem proporcionalidade ao risco. O plano já diz para medir "também os tokens das leituras, além do prompt" (§7) — a prática não aplica.

### 7. H-04 compara custo sem medir custo
Todos os campos `metrics` estão `null` / `source: unavailable`; os documentos repetem "modelo efetivo, tokens e custo não disponíveis". O objetivo declarado da H-04 é comparar custo/qualidade, mas nenhuma rodada produziu sinal de custo utilizável — ou seja, o retrabalho e a duplicação acima estão sendo pagos **sem retorno mensurável** para a decisão que motivou o gasto.

## Mitigações (priorizadas por ROI)

**A. Podar `context.md` de volta a índice (maior ganho imediato).**
Mover os ~20 parágrafos datados da seção "Desenvolvimento por IA" para `docs/ai/HISTORICO_DSH.md` (ou para os relatórios já existentes) e deixar em `context.md` só: tabela de estado, "próxima ação" e ponteiros. Fixar teto de tamanho (~6–8 KB): ao estourar, mover a entrada mais antiga e substituir por link. Aplica a regra que o próprio plano estabelece (§7).

**B. Fonte única da saga DSH.**
Consolidar o histórico de integração DSH em um único documento; os demais passam a apontar para ele com status de uma linha. Elimina 4 das 5 redações concorrentes.

**C. Enxugar envelope/resultado.**
Remover `evidence_refs` redundantes (manter 1 mapeamento critério→artefato), colapsar `checks` repetidos e não reenviar bloco de check idêntico a cada retomada. Alvo: cortar os 8 JSONs pela metade.

**D. Não pedir Vitest dentro do sandbox DSH.**
Reformular a tarefa DSH: worker entrega código + checagens estáticas (tsc, diff, node --check); a execução de Vitest passa a ser **uma única** responsabilidade do orquestrador, fora do sandbox, e o revisor só confere o log, não re-executa. Remove a execução tripla e o FAIL permanente dentro do worker.

**E. Revisão proporcional ao risco, com "pacote de revisão".**
Entregar ao revisor só: critérios + diff + saída dos comandos já rodados (não a narrativa). Revisor não re-lê `context.md` (recebe resumo de estado de 3 linhas quando não afeta continuidade). Caso puro (D1) = um revisor; só alto risco (RLS/transação) justifica re-execução integral.

**F. Retrabalho envia só o delta.**
Em vez de reenviar o briefing completo, enviar: achado do revisor (arquivo/linha/condição) + trecho afetado. Não re-ler `AGENTS.md`/`context.md` na retomada da mesma tarefa (não mudaram). Aplicar o limite do plano §6: duas tentativas sem avanço → diagnosticar e replanejar, não repetir.

**G. Telemetria antes de novas rodadas comparativas.**
Antes de executar U1-DSH ou repetir pares, instrumentar a ponte/configuração para capturar ao menos tokens de entrada/saída e duração. Sem isso, mais rodadas gastam sem gerar o sinal que a H-04 promete. Se não houver telemetria, registrar "sem sinal de custo" como conclusão da H-04 em vez de mais execuções.

## Próximo passo sugerido

1. Aplicar **A** e **B** (mudança só documental, baixo risco, retorno imediato). — **Feito em 29/09.**
2. Aplicar **D** antes de concluir o braço U1-DSH. — **Feito em 29/09** (CONTRATOS §7; adendo em AVALIACAO_H04).
3. Aplicar **C/E/F** na próxima tarefa de worker. — **Feito em 29/09** (índice H04_RESULTADOS_INDICE.md; CONTRATOS §2-forma enxuta e §8).
4. Decidir **G** com o responsável antes de mais pares comparativos. — **Pendente.**

## Estado das mitigações (29/09/2026)

- **A.** `context.md` podado de 26.297 B para ~13 KB (seção "Desenvolvimento por IA" movida); teto de ~12 KB declarado no roteiro. O par obrigatório `AGENTS.md` + `context.md` caiu de ~6,8 k para ~3,5 k tokens.
- **B.** `docs/ai/HISTORICO_DSH.md` é a fonte única da saga; `PLANO_ORQUESTRACAO.md` (§2, §12, §16), `RELATORIO_H04.md` (Transporte DSH), `INTEGRACAO_VSCODE.md` (9,3 KB → ~3,1 KB) e `DIAGNOSTICO_DSH_MCP.md` passaram a apontar para ela com status de uma linha.
- **RepoMap.** `scripts/harness/repomap.mjs` (Node puro, sem dependências — o lockfile protegido não foi tocado) gera `docs/ai/REPOMAP.md` via `npm run repomap`: ~10,5 KB (~2,6 k tokens) com assinaturas de código, migrações SQL e nomes de teste. Acima da estimativa de 1–2 k por incluir SQL/testes; substitui a varredura da árvore.
- **C.** `docs/ai/H04_RESULTADOS_INDICE.md` resume os 8 JSONs (estados, checks, critérios, SHAs) — leitura de ~3 KB no lugar de ~54,6 KB; os JSONs permanecem intocados como evidência. Forma enxuta obrigatória para envelopes novos em CONTRATOS §2.
- **D/E/F.** CONTRATOS §7–§8: testes dinâmicos fora do sandbox com execução única pelo orquestrador; revisor confere log; pacote de revisão leve; retomada por delta; limite de duas tentativas sem avanço. Adendo aplicável a U1-DSH em AVALIACAO_H04.
- **G.** Aguarda decisão do responsável sobre instrumentar a ponte antes de novas rodadas comparativas.
