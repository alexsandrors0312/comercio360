# H-04 — protocolo de avaliação comparativa

Estado em 29/09/2026: **protocolo preparado; casos ainda não executados**. O Antigravity respondeu a um teste mínimo com `Gemini 3.1 Pro Low` selecionado, e o MCP DSH respondeu `READY`. Esses testes não medem qualidade de engenharia. O piloto H-03 produziu um parecer que ainda está em integração; iniciar os casos somente após fixar a base corrigida.

## Unidade de comparação

Comparar uma execução Codex direta com uma execução delegada para **cada** caso abaixo. Preparar uma base sanitizada apenas com arquivos versionados, sem `.env`, cofre, dados reais nem histórico Git desnecessário. Aplicar o mesmo defeito sintético a um molde descartável e criar duas cópias Git independentes com o mesmo commit inicial e o mesmo contrato 0.1. Um escritor por cópia. Registrar o SHA do projeto de origem, o SHA do molde e hashes dos insumos relevantes. Alternar a ordem dos braços entre casos para reduzir viés de sequência. Começar com um par por caso (seis execuções); repetir somente um caso com divergência material ou falha intermitente. Uma amostra por caso não demonstra estabilidade estatística.

O `dsh_health` atual permite `cwd` apenas na raiz real do Comércio 360. **Antes de delegar em uma cópia**, cadastrar seus caminhos absolutos exatos na allowlist da ponte, iniciar uma conexão MCP que exponha a configuração atualizada e conferir `dsh_health`. Não usar a raiz real como `cwd` para contornar o limite. Conferir também as ferramentas/arquivos acessíveis ao runtime; a allowlist de `cwd` e o texto do prompt não são isolamento de leitura ou escrita. Se o isolamento necessário não estiver disponível, registrar o caso como bloqueado sem enviar a cópia.

## Casos

| ID | Defeito apenas no molde descartável | Aceite observável | Verificação mínima |
| --- | --- | --- | --- |
| D1 — domínio | Regressão sintética na associação loja/organização de `selectContext` em `packages/domain/tenancy.ts` | Par loja/organização cruzado e ID inexistente retornam `null`; par válido mantém a loja correta; ausência de lojas retorna `null` | `tests/tenancy.test.ts`, teste novo que distingue o defeito e revisão independente |
| S1 — SQL/tenant | Migração sintética adicional no molde enfraquece a exigência de vínculo ativo em `private.can_access_store` | Vínculo revogado vê zero lojas e `set_active_store` recusa com SQLSTATE `42501`; acesso entre tenants e loja inativa continuam negados | PGlite com teste de avaliação que carrega explicitamente a migração sintética e a correção incremental; revisão de segurança |
| U1 — interface | Regressão sintética no estado do menu em `packages/ui/shell.tsx` | Em 360 px, `aria-expanded` acompanha abertura/fechamento, Escape e navegação fecham o menu, links funcionam e não há overflow; rota protegida continua exigindo acesso | Playwright e revisão de acessibilidade; ler o guia Next local antes de editar código UI |

Em S1, preservar as duas migrações históricas no projeto real e exigir correção incremental na cópia. `tests/database.test.ts` carrega apenas as migrações atuais, então a suíte sem um teste que aplique a migração sintética **não prova** a correção. O caso pode ser fácil de detectar porque a suíte já cobre revogação; registrar essa limitação ao interpretar o resultado.

## Registro e decisão

Usar envelopes com critérios e orçamento idênticos em cada par. O revisor recebe contrato, diff e evidências sem a conclusão do autor. Guardar por execução: base e SHA final, patch, arquivos/hashes, JSON de resultado, comandos/ambiente/código de saída/asserções, critérios, pedidos de contexto, falhas, retrabalho, tempo total e tempo de espera. Registrar runtime, modelo e esforço **efetivos** somente quando expostos. Tokens e custo indisponíveis permanecem `null` com `source=unavailable`; não converter estimativas em cobrança observada.

Qualidade e invariantes de tenant/autorização/escopo são gates. Uma violação bloqueia promoção da rota mesmo se o tempo observado for menor. Comparar depois aceitação na primeira revisão, retrabalho, defeitos remanescentes, chamadas e tempo. Custo por tarefa aceita só é calculável se incluir orquestração, worker, revisão e retrabalho com telemetria suficiente. A decisão de roteamento após três pares é provisória e registra incerteza.
