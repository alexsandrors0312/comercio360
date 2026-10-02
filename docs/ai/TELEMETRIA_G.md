# Telemetria G — ponte DSH do Comércio 360

Estado em 30/09/2026: **captura real do DSH validada** após recarga MCP e correção do patch de perfil. Uma chamada mínima retornou uso numérico do provedor, duração monotônica e linha JSONL correspondente. A rota Codex, subagentes e cobrança seguem sem cobertura equivalente; não iniciar novos pares para inferir custo.

## Fonte e fluxo

O perfil DSH `headless` 0.1.5-rc.3 persiste eventos de sessão com uso informado pelo provedor, mas imprime apenas resposta final em stdout e raciocínio em stderr. O [overlay local](../../scripts/harness/dsh-telemetry-headless.mjs), derivado do módulo MIT dessa versão com [aviso de licença](../../scripts/harness/DSH_HEADLESS_LICENSE.txt), seleciona os eventos de `turn/start` até `turn/end` e usa a função oficial `deriveTurnTokenUsage` para agregar tentativas do turno raiz. O [patch local](../../scripts/harness/dsh-telemetry.patch.yml) desativa o runner original e insere o overlay por URL absoluta deste workspace; o loader só permite alterar a configuração de um nó já existente. Ele não altera o pacote instalado nem o perfil Web. O overlay escreve **apenas campos numéricos e rotas de modelo** no descritor privado 3. Uso incompleto, contraditório ou ausente vira `null`.

A [ponte versionada](../../scripts/harness/dsh-mcp-telemetry.mjs) verifica os arquivos de telemetria no primeiro workspace autorizado, independentemente do diretório em que o MCP iniciou. O patch atual aponta para o caminho absoluto deste workspace; movê-lo exige ajustar essa URL. A ponte cria um `run_id`, mede a duração do processo com relógio monotônico, limita o canal de telemetria a 4096 caracteres e valida `run_id`, esquema e contadores. A primeira parte da resposta MCP continua sendo o texto final do DSH; a segunda contém `C360_TELEMETRY_V1` com JSON sanitizado, também disponível em `structuredContent.telemetry`. Um JSONL local em `C:/Users/Alexs/.codex/mcp/dsh/telemetry.jsonl` guarda a mesma medição por chamada. Esse registro inclui hash SHA-256 do briefing, caminho do workspace, horários, duração, status, código de saída, uso e fonte; não guarda briefing, resposta, stderr, raciocínio ou credenciais. Falha na gravação aparece como `persisted: false` na resposta, sem transformar a tarefa em sucesso.

| Campo | Significado |
| --- | --- |
| `input_tokens` | `totalTokens - outputTokens` exatos do provedor, incluindo parcelas de cache quando informadas |
| `uncached_input_tokens` | Entrada sem cache informada pelo provedor |
| `cache_read_tokens`, `cache_write_tokens` | Parcelas opcionais; `null` se não disponíveis para todas as tentativas |
| `output_tokens` | Saída informada pelo provedor; `reasoning_tokens` é subconjunto opcional, não soma adicional |
| `elapsed_seconds` | Tempo de parede da chamada ao CLI, do spawn ao fechamento, medido pela ponte; inclui inicialização e flush |
| `usage_source` | `dsh-session-provider-usage` quando a agregação exata existe; caso contrário `unavailable` com `usage: null` |
| `cost` | Sempre `null`; nenhuma tarifa ou cobrança foi inferida |

O escopo medido é `root_turn`. Subagentes em sessões próprias podem consumir tokens fora dele; portanto uma tarefa com delegação aninhada não recebe custo total comprovado por esta versão. `routes` identifica provedor/modelo somente quando todos os eventos trazem atribuição suficiente. A seleção configurada em `settings.yaml` não é tratada como execução observada. O Codex ainda não expõe nesta integração contagem por tarefa equivalente; somar DSH sem a outra rota e a orquestração **não produz comparação de custo**.

## Instalação e evidência

- Ponte instalada em `C:/Users/Alexs/.codex/mcp/dsh/dsh-mcp.mjs`, SHA-256 `57ad9cf469951b61987cb6f47f4e412cb6bbb11aa38c7fde998356cda779058f`; backup da versão ativa anterior (`452d7a1e…`) em `C:/Users/Alexs/.codex/backups/dsh-telemetry-20260930/`. A proveniência local foi atualizada e o hash conferido.
- `--dump-config` confirmou `headless-runner` com `disabled: true` e `c360-telemetry-runner` apontando para o módulo local; `--help` saiu com código 0, mas não é prova de execução do overlay. A verificação MCP da ponte instalada passou inicialização, lista/schema de ferramentas, saúde, rejeições de entrada e ping, sem tarefa de modelo.
- `npm run test:harness`: **16/16** e seis skills com estrutura válida. O teste com CLI simulado cobre uso válido, ausência/contradição como `null`, duração, persistência, erro e não vazamento do raciocínio. Outro teste cobre a seleção exata do turno sem os eventos preparatórios.
- `npm run repomap` regenerou o índice estrutural após os arquivos novos. Nenhum teste da aplicação, banco remoto ou novo par H-04 foi executado por G.

Após a recarga, `dsh_health.telemetry.enabled` retornou `true`. As três primeiras chamadas mínimas (`86ef87ad`, `6610e7eb`, `7ba8070c`) responderam `READY` e duração/JSONL, mas `usage: null`: o primeiro patch só alterava configuração e deixava ativo o runner original. Uma tentativa com substituição por expressão (`f2065bf4`) falhou no boot, com `DSH_RUN_FAILED (exit=1; category=unknown)` e sem sessão nova. Essas linhas permanecem no JSONL como evidência de falha, sem receber PASS retroativo.

Com o patch corrigido, a chamada MCP nativa `4db0e9d3-85a3-405a-8bbd-c97a16f93e5e` retornou `READY`, `status: completed`, **6,512142 s**, `input_tokens: 8298`, `uncached_input_tokens: 874`, `cache_read_tokens: 7424`, `output_tokens: 65`, `reasoning_tokens: 62`, `total_tokens: 8363`, rota `deepseek-official/deepseek-v4-pro` e `cost: null`. A última linha de `C:/Users/Alexs/.codex/mcp/dsh/telemetry.jsonl` foi conferida com o mesmo `run_id`, status, duração e contagens. O arquivo temporário de diagnóstico continha somente tipos de evento e presença de uso; foi removido depois da conferência. Nenhum teste da aplicação ou novo par H-04 foi executado.

## Gate para futuros pares

Cada braço deve registrar revisão/base, `run_id`, duração, tokens de entrada/saída, fonte, cobertura de subagentes e custo observado quando existir. Reexecuções exigem motivo. Até haver telemetria por tarefa nas duas rotas, cobertura da orquestração/revisão e uma tarifa observada aplicável, o resultado financeiro permanece **“sem sinal de custo”**. A ponte mede o DSH; não converte porcentagem de limite de uso, bytes de texto ou estimativas de quatro bytes por token em cobrança.
