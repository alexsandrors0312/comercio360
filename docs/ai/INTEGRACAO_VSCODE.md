# Integração do harness com VS Code — 29/09/2026

## Conexões verificadas

- O projeto foi aberto em uma janela do VS Code (`Comercio360 - Visual Studio Code`). Estão instaladas as extensões `openai.chatgpt` 26.5917.62051, `google.geminicodeassist` 2.100.0 e o companion Gemini CLI 0.20.0.
- A configuração MCP ativa do Codex registra `dsh` como servidor stdio habilitado com `dsh_health` e `dsh_delegate`. A extensão Codex do VS Code compartilha as camadas de `config.toml` com o app e o CLI, segundo a [documentação oficial](https://learn.chatgpt.com/docs/developer-settings). Isso estabelece a rota **VS Code → Codex → MCP DSH**; não comprova que o provedor de modelo conclua uma tarefa.
- `.vscode/extensions.json` recomenda as extensões já instaladas, `.vscode/settings.json` abre a lateral Codex ao iniciar, e `.vscode/tasks.json` oferece `C360: validar harness` e `C360: lint`.
- `GEMINI.md` fornece ao [Gemini Code Assist no VS Code](https://docs.cloud.google.com/gemini/docs/codeassist/use-agentic-chat-pair-programmer) o ponto de entrada do contexto do projeto. Gemini é uma rota independente de revisão; o modelo efetivo e a autenticação devem ser confirmados no seletor e numa resposta real da extensão. Nenhuma chamada Gemini foi executada nesta verificação.

## DeepSeek: transporte disponível, modelo não validado

`dsh_health` respondeu OK para DSH 0.1.5-rc.3, perfil `headless` e workspace Comércio 360. Com a autorização explícita do responsável pelo projeto, o piloto H-03 foi enviado via `dsh_delegate`; a ponte retornou `DSH_RUN_FAILED (exit=1)` sem saída do worker. Uma segunda chamada mínima teve o mesmo resultado. Não houve relatório de revisão, alteração de arquivo ou evidência de modelo executado.

Há uma divergência de configuração: `~/.dsh/config.yml` cita NVIDIA NIM e `deepseek-ai/deepseek-r1:free`, mas a variável `NVIDIA_API_KEY` não está presente nos escopos de processo, usuário ou máquina. A [página atual do modelo na NVIDIA](https://build.nvidia.com/deepseek-ai/deepseek-r1) marca o endpoint gratuito de R1 como **deprecated**; adicionar uma chave, por si só, não valida essa rota. Já `~/.dsh/settings.yaml` seleciona `deepseek-official`/`deepseek-v4-pro` como padrão. O perfil oficial compõe `agent-default-model` e as configurações salvas podem substituí-lo; o arquivo `config.yml` isolado não prova seleção de R1. Existe um registro de credencial DeepSeek no cofre DSH, mas sua validade não foi lida nem testada. Portanto o modelo efetivo da tentativa permanece **indisponível**.

A ponte pessoal `~/.codex/mcp/dsh/dsh-mcp.mjs` recebeu um classificador de falhas por categorias fixas, sem encaminhar stderr bruto; `node --check` passou e há backup `dsh-mcp.mjs.bak-20260929-diagnostics`. SHA-256 atual `3E3B9A87AD4034D3FFC778A4B39D138ED6FB2C1EA548621D65C499EE1EDEA7A1`; backup `7129238375E4D537B32230A70D19549CEB550A7E18AC20830255EAFFB2C7DB73`. A conexão MCP já aberta ainda usa o processo anterior: o diagnóstico novo depende de recarga da conexão. Nenhuma chave foi copiada para o repositório ou para o briefing.

A instalação da extensão comunitária **DSH Sidebar** (`lixxx1.dsh-sidebar`) foi rejeitada pelo auto-review: instalar e habilitar código de terceiros com acesso persistente ao editor e repositório exigiu aprovação específica do pacote. Nenhuma instalação ocorreu e não foi usada outra via para contornar a rejeição. A rota pela extensão Codex existente continua disponível para inspeção e futuras chamadas MCP.

## Próximo ensaio

1. Resolver a seleção/autenticação de um provedor DSH por mecanismo seguro, sem enviar chaves pelo chat. A rota gratuita R1/NVIDIA registrada está descontinuada; escolher um endpoint vigente e conferir seu identificador antes de configurar a chave no ambiente seguro. Se usar DeepSeek oficial, registrar o modelo efetivo diferente de R1.
2. Recarregar a conexão MCP e chamar `dsh_health`, depois uma tarefa mínima via `dsh_delegate`. Registrar categoria da falha ou resposta, sem logs/raciocínio bruto.
3. Se a chamada mínima passar, repetir [H-03](PILOTO_H03.md), validar o relatório e conferir Git. Depois selecionar Gemini Pro no VS Code e executar revisão equivalente em contexto independente, registrando modelo real, tempo e evidências.

Nenhuma dessas etapas autoriza Catálogo 002, deploy, dados reais ou leitura de segredos por workers.
