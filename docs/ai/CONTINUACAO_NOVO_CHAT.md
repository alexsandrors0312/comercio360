# Continuação — agentes Comércio 360 / H-04

Checkpoint de 29/09/2026. A solicitação desta sessão foi auditar as mitigações e preparar a retomada; **nenhum worker ou teste de aplicação foi reiniciado**. Este arquivo é a entrada operacional da próxima sessão. Cronologia da integração: HISTORICO_DSH.md; execuções: RELATORIO_H04.md; regras: CONTRATOS_HARNESS.md.

## Atualização após a retomada (30/09 UTC)

A sequência abaixo foi executada na sessão seguinte; conservar este checkpoint como histórico, não repeti-la. O patch parcial DSH foi conferido pelos hashes originais e concluído com um delta para fechar o menu também pelo link da marca, após achado de QA independente. O executor temporário foi corrigido, registrou stdout/stderr separados e liberou as portas. Playwright externo passou **6/6 em DSH e 6/6 em Codex**; o foco DSH passou **2/2**. TypeScript e `git diff --check` passaram no DSH. O [resultado 0.1 composto](H04_U1_DSH_RESULTADO_ORQUESTRADOR_2026-09-30.json) foi validado contra a revisão 2 do envelope; não é saída do worker interrompido. O patch permanece só no clone descartável. Detalhes e limites em [RELATORIO_H04.md](RELATORIO_H04.md), logs em [evidencias/h04-u1-2026-09-30/README.md](evidencias/h04-u1-2026-09-30/README.md).

**Decisão após a retomada:** U1-V5 completo substitui o gate funcional somente na avaliação sintética H-04; U1 é encerrado nesse escopo. U1-V1 continua FAIL histórico no Codex e `not_run` no DSH, sem receber PASS. O runner original exige reparo de infraestrutura separado. Próximo passo do harness: telemetria G antes de novos pares de custo. Não reexecutar D1/S1 nem publicar o Catálogo 002.

**Atualização G em 30/09:** a ponte de telemetria foi instalada, passou 15/15 testes de harness com CLI simulado e nove checks de protocolo MCP. O processo desta conversa ainda executa a ponte antiga; após recarga, validar uma chamada mínima real e o JSONL. Tokens por tarefa da rota Codex e custo comparável permanecem indisponíveis. Fonte atual: [TELEMETRIA_G.md](TELEMETRIA_G.md). As linhas de estado abaixo preservam o checkpoint original.

**Validação posterior de G:** após a recarga e correção do patch, a chamada MCP nativa `4db0e9d3` retornou tokens reais e duração com JSONL correspondente; a suíte passou 16/16. A rota Codex e o custo comparável seguem sem cobertura. Ver [TELEMETRIA_G.md](TELEMETRIA_G.md) para as tentativas anteriores `usage: null` e a evidência válida.

## Leitura mínima

1. `AGENTS.md`, `context.md` e este checkpoint. Conferir Git antes de alterar qualquer arquivo; preservar mudanças do usuário.
2. `CONTRATOS_HARNESS.md` §§2/7/8 e os adendos U1 em `AVALIACAO_H04.md`. Skills pertinentes apenas quando a tarefa exigir.
3. `H04_RESULTADOS_INDICE.md` se precisar dos resultados anteriores. Abrir JSON/log original só para conferir uma afirmação concreta. RepoMap é opcional para localizar código; não carregar todos os documentos ligados pelo índice.

## Auditoria da tríade

**Parecer:** direção adequada para continuar com contexto menor; economia real e enforcement ainda não demonstrados. Commit auditado: `3ccd2d06bafa7a69d0a5a80d1d1d1110e47d9754`; base anterior: `eeaa404`. A árvore principal estava limpa antes desta revisão. Os complementos desta sessão estão nos documentos do working tree; confira `git status` e preserve-os ao iniciar o novo chat.

- Os oito hashes do índice conferem com os JSONs. O commit não alterou esses resultados, código de aplicação, migrações ou lockfile. Em `package.json`, acrescentou somente o comando `repomap`.
- Poda e fonte única reduzem bytes de entrada, mas ainda há resumos históricos em documentos de evidência; isso não exige apagá-los nem relê-los por rotina.
- RepoMap usa heurísticas de linhas, sem Tree-sitter. Pode omitir símbolos, truncar ou representar incorretamente assinaturas; confirmar o arquivo antes de editar. Não é grafo de dependências, prova de cobertura ou substituto do envelope. Medido nesta auditoria: 10.668 bytes UTF-8. Os números de tokens e os “bytes” calculados com `content.length` pelo script são aproximações, não telemetria.
- O diagnóstico de ~170 mil tokens não tem contagem de leituras suficiente para sustentá-lo. A relação 12 × 6.800 resulta em 81.600 aproximados, também sem provar consumo efetivo ou efeito de cache. Não declarar percentual de economia de tokens com base apenas em tamanho de arquivo.
- Corrigidas regras que poderiam dispensar instruções obrigatórias, transformar falha de ambiente em `not_run`, fundir IDs de checks ou tratar resultado delta como envelope completo. O esquema 0.1 continua exigindo todos os critérios; não implementa herança de resultados. A completude semântica dos checks continua responsabilidade do orquestrador.
- Testes externos agora significam executor autorizado, uma execução canônica por candidato/ambiente e reexecução justificada por alteração ou evidência insuficiente. Logs identificam revisão, stdout/stderr e códigos separados do runner/wrapper. Revisor mantém independência para pedir teste direcionado.
- Nenhuma alteração foi feita nos perfis/skills, validador ou runtime nesta auditoria. A–F são regras e utilitários em implantação; a próxima entrega deve demonstrar aplicação real, sem criar uma nova rodada só para isso.

## Estado dos agentes e entregas no checkpoint original

| Etapa | Estado para retomar |
| --- | --- |
| H-01/H-02 | Seis perfis e seis skills existem; H-02 ainda parcial, eficácia/discovery a observar |
| H-03 | Integrado em `4a80096`; três achados corrigidos; telemetria indisponível |
| H-04 D1/S1 | Ambos os braços executados e revisados; não repetir; falhas internas e retomadas rejeitadas preservadas |
| U1 Codex | Patch e revisão estática concluídos; alternativa focada 2/2 passou; gate original U1-V1 continua FAIL |
| U1 DSH | Interrompido por solicitação do usuário ao atingir limite de uso; patch parcial presente; sem JSON final recebido, validação dinâmica ou revisão final |
| G | Telemetria pendente; não iniciar novos pares de custo sem sinal mensurável |
| Catálogo 002 | Proposta ainda depende de aceite e ADR; não implementar |

## U1: localização exata e integridade

Raiz temporária existente na auditoria:
`C:/Users/Alexs/AppData/Local/Temp/h04-u1-78223936cb97431ea3d9dc282179834e`

- Braços: subpastas `codex/` e `dsh/`. Clone DSH em HEAD `32416419132f4aa59b93a8ae95839e097af25064`.
- Envelope existente: `task-dsh.json`, `H04-U1-DSH-01@1`. Não foi atualizado automaticamente pelas mitigações do repositório principal.
- DSH tem exatamente dois arquivos modificados: `packages/ui/shell.tsx` e `tests/e2e/foundation.spec.ts`; diff de 52 inserções e uma remoção. Nenhum desses patches foi integrado à aplicação real.
- SHA-256 do shell parcial: `b103fc2850d85d5373e4cabc9d3f19f26479ccd8875c5c6b8ea22a2e40c59d5e`.
- SHA-256 do teste parcial: `05674f86082fab0ee1ff81163c7a06b72283dd4972e6a695e28fe03fe4bac7a2`.
- Existem no diretório pai `run-u1-external.mjs` e `playwright-u1-external.config.mjs`. Não são ferramentas homologadas: Playwright teve exit 0 no braço Codex, mas o wrapper terminou com exit 1 por cleanup. Corrigir e identificar processos próprios antes de reutilizar.
- O runner original travou no teardown do Next/Windows. A asserção antiga espera texto visível `404`; consulta HTTP da cópia intacta retornou 404 sem esse texto. Isso não equivale a suíte original aprovada. Deliberar explicitamente como tratar esse gate, sem editar o resultado histórico.
- O DSH recebeu informação operacional aprendida depois do braço Codex; registrar essa assimetria e não comparar tempos/custos U1 como experimento controlado.

O cancelamento da espera MCP anterior foi confirmado; o encerramento do processo filho não foi. A revisão automática recusou um `Stop-Process` porque o processo foi identificado apenas como DSH, sem vínculo demonstrado ao clone U1. Não repetir a ação contra PID antigo nem presumir que esteja ativo. Antes de novo despacho, verificar estado atual e atribuição; se não for possível excluir execução concorrente, resolver isso antes de escrever no clone. Nenhum processo foi encerrado nesta auditoria.

## Sequência da próxima sessão

1. Confirmar existência do clone, HEAD, status e hashes acima. Se a pasta temporária tiver desaparecido, registrar perda e reconstruir apenas com base/artefatos disponíveis; não alegar recuperação do patch sem evidência.
2. Inspecionar o diff parcial antes de chamar modelo. Se suficiente, concluir verificações pelo orquestrador; não pedir reimplementação. Se precisar delegar, usar skill DSH, `dsh_health` uma vez e MCP nativo no clone autorizado; sem ler credenciais ou substituir MCP por shell/HTTP.
3. Aplicar explicitamente os contratos atuais ao envelope antigo, com revisão identificada, mesmos critérios/IDs e gates dinâmicos atribuídos ao orquestrador. Preservar revisão 1. O modo `task` do validador exige árvore limpa: não usar reset para esconder o patch; tratar retomada do candidato existente ou criar nova base rastreável preservando o patch. Não inventar suporte a manifest/herança.
4. Corrigir somente o executor temporário necessário e definir o tratamento do gate U1-V1. Aplicar protocolo simétrico aos braços quando necessário, com logs e motivo da reexecução. Não relançar D1/S1, H1 ou suíte completa da aplicação por rotina.
5. Produzir resultado final 0.1 válido com autoria/execução real, sem atribuir ao DSH comandos feitos pelo orquestrador. Revisão independente recebe pacote leve e fontes necessárias, cumpre instruções obrigatórias e não repete testes automaticamente. Limite de duas correções sem avanço verificável; nova chamada MCP não garante memória do worker.
6. Consolidar aceite ou pendências de U1 em RELATORIO_H04 e atualizar índice/context/checkpoint. Encerrar comparação de custo como “sem sinal de custo” se continuar sem telemetria. Instrumentação G é tarefa separada; não prolongar benchmarks para inferir economia.

## Verificação desta auditoria

Conferidos commit/diff, oito hashes, contrato versus validador e estado/hash do clone U1. `node --check scripts/harness/repomap.mjs` e `git diff --check` passaram; links Markdown locais dos documentos alterados conferidos. Os testes harness 14/14 e seis skills OK relatados no commit anterior continuam evidência daquela sessão; não foram reexecutados aqui. Não houve testes de aplicação, DSH, banco remoto, instalação, alteração de dependência ou implementação comercial nesta revisão.

## Prompt para colar no novo chat

> Continue o Comércio 360 em `C:/Users/Alexs/Desktop/Comercio360`. Leia AGENTS.md, context.md e docs/ai/CONTINUACAO_NOVO_CHAT.md. Preserve as alterações locais. Retome apenas U1 da H-04 a partir do patch DSH interrompido, conferindo base, arquivos e processos antes de escrever. Aplique CONTRATOS_HARNESS §§2/7/8, contexto mínimo e testes externos rastreáveis. Não repita D1/S1 nem releia todos os JSONs; não implemente Catálogo 002. Resolva explicitamente o gate E2E original sem reclassificar falhas históricas. Informe o primeiro passo concreto e prossiga no escopo já autorizado.
