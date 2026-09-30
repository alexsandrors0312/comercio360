# Integração do harness com VS Code — 29/09/2026

Este arquivo registra os **fatos duráveis de integração com o VS Code**. A cronologia da saga DSH (ponte MCP, credenciais, READY, timeouts, falhas e retomadas) tem fonte única em [HISTORICO_DSH.md](HISTORICO_DSH.md) e não é renarrada aqui.

## Conexões verificadas

- O projeto foi aberto em uma janela do VS Code (`Comercio360 - Visual Studio Code`). Extensões instaladas: `openai.chatgpt` 26.5917.62051, `google.geminicodeassist` 2.100.0 (rota individual indisponível: “client no longer supported”), companion Gemini CLI 0.20.0, `google.antigravity` 1.5.0 (Gemini 3.1 Pro Low selecionado; um teste mínimo sem ferramentas respondeu `READY` após fechar/reabrir a janela — sem telemetria de modelo/tokens/custo) e `lixxx1.dsh-sidebar` 0.0.5 (lateral secundária DeepSeek Harness; chave no **VS Code SecretStorage**, separada do cofre do MCP headless).
- A configuração MCP ativa do Codex registra `dsh` como servidor stdio habilitado com `dsh_health` e `dsh_delegate`. A extensão Codex do VS Code compartilha as camadas de `config.toml` com o app e o CLI, segundo a [documentação oficial](https://learn.chatgpt.com/docs/developer-settings). Isso estabelece a rota **VS Code → Codex → MCP DSH**; não comprova que o provedor conclua uma tarefa.
- `.vscode/extensions.json` recomenda as extensões instaladas, `.vscode/settings.json` abre a lateral Codex ao iniciar, e `.vscode/tasks.json` oferece `C360: validar harness` e `C360: lint`.
- `GEMINI.md` fornece ao [Gemini Code Assist no VS Code](https://docs.cloud.google.com/gemini/docs/codeassist/use-agentic-chat-pair-programmer) o ponto de entrada do contexto do projeto. Gemini/Antigravity é rota independente de revisão; modelo efetivo e autenticação devem ser confirmados no seletor e numa resposta real.
- DSH Web local em `127.0.0.1:3080` (Settings → Models para chave write-only no cofre DSH); o navegador integrado do Codex recusou o loopback com `ERR_BLOCKED_BY_CLIENT`, o que não diagnostica o serviço.

## DeepSeek: estado e apontadores

- Estado atual e cronologia completa (falhas `DSH_RUN_FAILED`, autenticação, `READY`, H-03, H-04): [HISTORICO_DSH.md](HISTORICO_DSH.md).
- Protocolo e fatos da ponte: [DIAGNOSTICO_DSH_MCP.md](DIAGNOSTICO_DSH_MCP.md).
- Contrato de execução e regras de testes externos/revisão: [CONTRATOS_HARNESS.md](CONTRATOS_HARNESS.md).
- Em 29/09: `dsh_health` OK (0.1.5-rc.3, headless); rota MCP respondeu `READY`; H-03 concluído; H-04 em andamento (D1 e S1 revisados; U1 pendente). Modelo efetivo, tokens e custo continuam indisponíveis.

## Próximo ensaio

1. Concluir U1 no protocolo H-04 ([AVALIACAO_H04.md](AVALIACAO_H04.md)) com os contratos D/E/F: checagens estáticas no worker, testes dinâmicos executados uma única vez pelo orquestrador fora do sandbox e revisão por pacote leve.
2. Decidir com o responsável a telemetria (G) antes de novas rodadas comparativas; sem sinal de custo, registrar essa conclusão em vez de repetir execuções.
3. Nenhuma dessas etapas autoriza Catálogo 002, deploy, dados reais ou leitura de segredos por workers.
