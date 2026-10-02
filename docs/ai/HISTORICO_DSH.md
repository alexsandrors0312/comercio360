# Histórico da integração DeepSeek Harness (DSH) — fonte única

Data: 29/09/2026. Criado pela Mitigação B do [diagnóstico de tokens](DIAGNOSTICO_TOKENS.md). Este arquivo é a **fonte única da cronologia de integração DSH** no Comércio 360. Documentos que renarravam a saga passaram a apontar para cá com status de uma linha: `context.md` (seção Harness), `PLANO_ORQUESTRACAO.md` (§12), `RELATORIO_H04.md` (Transporte DSH), `INTEGRACAO_VSCODE.md` e `DIAGNOSTICO_DSH_MCP.md` (que preserva os fatos duráveis de protocolo).

Regra de manutenção: acrescentar entradas no fim com data e evidência; **não renarrar a saga inteira a cada fato novo**. Se este arquivo passar de ~10 KB, comprimir as entradas mais antigas em linhas-resumo, preservando apenas fatos duráveis e apontadores de evidência.

## Estado resumido

| Item | Estado conferido |
| --- | --- |
| Ponte MCP local | Instalada em `C:/Users/Alexs/.codex/mcp/dsh`; `dsh_health` OK (0.1.5-rc.3, headless); contrato `task`/`cwd`/`timeout_ms` |
| H-03 | Concluído: três achados reproduzidos e corrigidos; integrado em `4a80096`; um timeout preservado como falha |
| H-04 | D1/S1 e U1 sintéticos encerrados; runner E2E original segue pendente. [RELATORIO_H04.md](RELATORIO_H04.md) |
| Testes no sandbox DSH | Bloqueados (`spawn EPERM` em D1; `ReferenceError: require is not defined` em S1) → contrato passou a testes externos (D/E) |
| Telemetria | G capturou uso real do turno raiz DSH após recarga e correção do patch; custo comparável indisponível. [TELEMETRIA_G.md](TELEMETRIA_G.md) |

## Fatos duráveis do transporte (contrato efetivo)

- Ponte comunitária local (origem [jeremy9682/dsh-cursor-codex](https://github.com/jeremy9682/dsh-cursor-codex), revisão `81def5abbc01bd5b461710ed11a595bb4355f5f7`, licença MIT), com correções Windows e allowlist locais; hashes e proveniência em `DIAGNOSTICO_DSH_MCP.md`.
- Contrato: `task` e `cwd` obrigatórios; `timeout_ms` entre 1000 e 600000; briefing ≤ 20.000 caracteres; uma execução por vez; workspace permitido somente Comércio 360. Não aceita `context`, `sandbox` nem `max_iterations`; não impõe 25 iterações.
- `dsh_health({})` informa versão, perfil e workspaces permitidos.
- O stderr do headless pode conter raciocínio do provedor; a ponte drena o canal sem encaminhá-lo e devolve códigos terminais de lista fechada. A ponte G adiciona canal privado para tokens informados pelo provedor, sem cálculo de custo; veja [TELEMETRIA_G.md](TELEMETRIA_G.md).
- A allowlist limita a raiz de lançamento, **não é sandbox**; isolamento de ferramentas pertence ao perfil DSH.
- Credenciais: a Sidebar usa o SecretStorage do VS Code; o MCP headless usa o cofre `~/.dsh/.credentials.yaml` ou ambiente (precedência ambiente > cofre > `.env`). Credenciais, senhas e segredos não são delegados ao DSH nem registrados em relatório ou conversa.
- Configuração de perfil efetiva: `~/.dsh/settings.yaml` (deepseek-official/deepseek-v4-pro/high). `~/.dsh/config.yml` cita R1 via NVIDIA NIM sem `NVIDIA_API_KEY`; não é a configuração usada pelo launcher.
- Rotas disponíveis: VS Code → Codex → MCP DSH (`dsh_health`/`dsh_delegate`); Sidebar DSH (chave própria no SecretStorage); DSH Web local em `127.0.0.1:3080`; Antigravity/Gemini como rota independente de revisão.

## Cronologia

### 28/09/2026 — plano, perfis e ponte

- Elaborado o [plano de orquestração](PLANO_ORQUESTRACAO.md): orquestrador Codex (Sol alto, Astra para arquitetura), seis perfis de worker, roteamento por risco, contexto por tarefa e revisão independente. Na inspeção original, a pasta estava sem Git e `dsh_delegate` ausente.
- Definidos os [contratos do harness](CONTRATOS_HARNESS.md) 0.1 (tarefa, resultado, revisão, retomada) e o validador local `scripts/harness/validate.mjs` (seis testes iniciais); `scripts/harness/check-skills.mjs` confere as seis skills. O validador oficial da skill-creator não rodou (Python sem PyYAML).
- [Diagnóstico da ponte](DIAGNOSTICO_DSH_MCP.md): o config ativo não registrava `[mcp_servers.dsh]`; o pacote npm citado retornou E404; ponte comunitária instalada localmente com correção Windows e allowlist; skill pessoal corrigida para `task`, `cwd`, `timeout_ms`.

### 29/09/2026 — baseline, credenciais e falhas iniciais

- Git inicializado; primeiro commit local `5977cdb` (baseline; identidade de automação apenas nessa execução; sem remoto).
- Criados seis perfis em `.codex/agents/` e seis skills em `.agents/skills/`; discovery em sessão nova ainda sem observação.
- Codex reconheceu o MCP DSH: inicialização, `tools/list` (`dsh_delegate`, `dsh_health`), saúde OK e rejeições de entradas inválidas verificadas.
- A primeira `dsh_delegate` (criar perfis) foi **rejeitada pelo auto-review** por falta de autorização explícita de exportação; o responsável concedeu depois. As autorizações de envio ao DSH e da extensão Sidebar continuam válidas; não solicitar novamente.
- Piloto H-03 e uma chamada mínima retornaram `DSH_RUN_FAILED (exit=1)` sem relatório do worker; depois da instalação da Sidebar, outra chamada mínima falhou do mesmo modo (três tentativas sem worker no total).
- Sidebar `lixxx1.dsh-sidebar@0.0.5` aprovada e instalada; `code --list-extensions --show-versions` confirmou; a lateral abriu no VS Code exibindo DeepSeek-V4-Pro/High.
- Gemini Code Assist Individual exibiu “client no longer supported”; a rota ficou indisponível.
- A ponte passou a classificar somente códigos terminais em lista fechada, sem expor stderr/raciocínio; `node --check` passou.
- Chamada mínima em conexão MCP nova: `DSH_RUN_FAILED (exit=1; category=authentication)` em ~9 s. DNS e TCP 443 para `api.deepseek.com` funcionaram **fora** do sandbox, sem provar a rede do MCP. DSH Web aberto localmente em `127.0.0.1:3080`; o controle da janela Chrome foi interrompido pela ferramenta por não confirmar a URL — nenhuma credencial lida ou inserida.
- O responsável informou ter configurado as chaves no DSH Web e na Sidebar; o cofre `~/.dsh/.credentials.yaml` teve modificação atualizada; ainda assim, chamadas mínimas continuaram falhando com `authentication` (~9,6 s). Essa categoria agrupa AUTH/INVALID_CREDENTIAL/HTTP 401/403, sem identificar o HTTP exato; a credencial nunca foi lida. `dsh_health` permaneceu OK.
- Extensão oficial Antigravity 1.5.0 encontrada; `Gemini 3.1 Pro Low` selecionado. Após cinco reinícios malsucedidos do agente, a janela do VS Code foi reaberta e um prompt mínimo sem ferramentas respondeu `READY` (Thought for 8 s). Sem metadados de modelo/tokens/custo.
- O validador H-02 passou a consultar alterações reais do Git em todos os modos; suíte harness **11/11**.

### 29/09/2026 — READY e piloto H-03

- Após o responsável confirmar resposta `OK` no DSH Web, a rota MCP headless respondeu `READY` a uma tarefa mínima.
- Piloto H-03 na base limpa `1a30bbda6d0a81bc372df3bc1ea9056548b3d5df`: a primeira tentativa expirou em 300000 ms sem saída parcial utilizável (permanece registrada como falha); a segunda retornou JSON 0.1 com três achados. Validado na base original; preservado em `docs/ai/H03_RESULTADO_DSH_2026-09-29.json`; achados reproduzidos independentemente e corrigidos. Relatório: [RELATORIO_H03.md](RELATORIO_H03.md).
- Correções H-03 no validador: `HEAD` reverificado contra a base também na API, diffs de índice e worktree unidos, referências de achado existentes/seguras exigidas; suíte harness **14/14**. H-03 integrado em `4a80096`.

### 29/09/2026 — H-04: pares D1 e S1

- [Protocolo H-04](AVALIACAO_H04.md): três defeitos sintéticos em cópias descartáveis, pares Codex × DSH, revisão independente e métricas observáveis. Moldes auditados byte a byte contra `4a80096`; seis envelopes validados; a preparação anterior (conversão de finais de linha no Windows) foi descartada para comparação formal.
- D1 Codex: primeira tentativa interrompida por limite de créditos; retomada concluiu com resultado 0.1 válido, 7/7 testes direcionados, tsc e diff com código 0; revisão independente sem achados bloqueantes. Tempo total desconhecido.
- D1 DSH: após recarga do MCP, `dsh_health` listou os três clones; resultado 0.1 válido; **Vitest falhou dentro do sandbox (`spawn EPERM`)** antes das asserções, registrado FAIL sem insistir; orquestrador e revisor executaram o teste fora do sandbox: **7/7**. Par D1 aprovado nos invariantes e revisões, sem comparação confiável de rapidez/custo.
- S1 DSH: primeira chamada expirou em 600000 ms deixando dois arquivos autorizados; retomada somente leitura produziu JSON rejeitado (IDs S1-V1/V2 remapeados); a revisão cega apontou dependências de ordem no PGlite; o DSH separou RED/GREEN e isolou cada cenário pós-correção em banco próprio. Resultado final 0.1 válido, mantendo FAIL nos checks Vitest do sandbox (`ReferenceError: require is not defined`). Fora do sandbox: orquestrador obteve **7/7** S1, **1/1** cross-tenant isolado, **7/7** embaralhados, **13/13** históricos e tsc sem erros; revisor repetiu outra ordem embaralhada **7/7**, sem achados bloqueantes.
- S1 Codex: **1/1** teste PGlite focado, **13/13** históricos, TypeScript e escopo conferidos; passou na primeira revisão. A diferença de retrabalho é observação de um par, sem telemetria comparável.
- Nenhum banco hospedado foi alterado.

### 29/09/2026 — U1 e diagnóstico de tokens

- U1 Codex: correção do menu móvel apenas nos dois arquivos permitidos; resultado 0.1 válido; revisão estática sem achados bloqueantes. Playwright teve 4/2 e travou no teardown do servidor Next; harness externo temporário obteve **2/2** testes focados com código 0 (wrapper exigiu encerramento manual). A falha antiga do texto `404` foi reproduzida na cópia intacta (HTTP 404 sem texto visível); não se atribui ao patch U1. **U1 ainda não passou o gate E2E original (U1-V1).**
- Conferência documental: hashes de `docs/H1_RESULTADOS.json`, das duas migrações e de `package-lock.json` coincidem com os registrados na revisão H1.
- [Diagnóstico de tokens](DIAGNOSTICO_TOKENS.md): `context.md` com 26.297 B, saga duplicada em 5+ documentos, 8 JSONs com 54.646 B, retrabalho S1 ×5 e Vitest executado 3×; mitigações A–G priorizadas por ROI.
- Tríade aprovada e aplicada nesta data: poda do `context.md` (A), este arquivo como fonte única (B), RepoMap sem dependências (`scripts/harness/repomap.mjs` → `docs/ai/REPOMAP.md`), índice leve dos JSONs H-04 + orientação de envelope enxuto (C) e contratos de testes externos/revisão proporcional/retomada por delta (D/E/F). A decisão G (telemetria antes de novas rodadas comparativas) aguarda o responsável.

### 30/09/2026 — fechamento sintético H-04 e telemetria G

- U1 foi retomado em clones descartáveis. O gate externo substituto U1-V5 teve 6/6 em ambos os braços; QA DSH não encontrou bloqueio. O gate U1-V1 original permanece FAIL no braço Codex e `not_run` no DSH; o patch ficou nos clones. Evidências e limites em [RELATORIO_H04.md](RELATORIO_H04.md) e [CONTINUACAO_NOVO_CHAT.md](CONTINUACAO_NOVO_CHAT.md).
- G: ponte MCP `0.1.0-c360.2`, overlay headless local e JSONL de métricas numéricas instalados. `npm run test:harness` passou 15/15; verificação de protocolo MCP passou nove checks; `--help` saiu com código 0, mas não comprovava carregamento do overlay. A conexão MCP já aberta ainda executava a versão antiga; uma amostra real do provedor aguardava recarga. Fonte de implementação, hashes e limites: [TELEMETRIA_G.md](TELEMETRIA_G.md). Nenhum novo par de custo foi iniciado.
- Após a recarga, três chamadas mínimas responderam `READY` com `usage: null`: o patch inicial alterava só a configuração e não substituía o runner. Uma tentativa de substituição por expressão falhou antes de criar sessão. O patch passou a desativar o runner original e inserir o overlay por URL local; `--dump-config` confirmou ambos os nós. A chamada real `4db0e9d3` retornou `READY`, 8.298 tokens de entrada, 65 de saída e 6,51 s; o JSONL coincidiu. Testes de harness **16/16**. Os registros anteriores permanecem como falhas; custo e cobertura da rota Codex continuam indisponíveis. Evidência: [TELEMETRIA_G.md](TELEMETRIA_G.md).
