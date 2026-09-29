# Disponibilidade do MCP DeepSeek Harness

Data: 28/09/2026, America/Sao_Paulo. Escopo: configuração local do Codex/DSH. **Servidor instalado e protocolo verificado; recarga do cliente e execução real ainda pendentes.**

## Causas verificadas

1. `C:/Users/Alexs/.codex/config.toml` não continha `[mcp_servers.dsh]`. O cadastro em `model_providers.dsh-harness` descrevia um provedor de modelo e não registrava ferramentas MCP.
2. `dsh.config.toml` separado usava `[profile.dsh]`, `[profile.dsh.mcp_servers.dsh]` e `[profile.dsh.skills]`. Ele não era carregado pelo cliente como cadastro MCP ativo. A configuração suportada usa a seção `mcp_servers` no config ativo; perfis Codex não tornam qualquer arquivo de nome semelhante um include automático.
3. O comando proposto, `npx -y @jeremy9682/dsh-mcp-server`, referenciava um pacote que retornou **E404** no registro público npm. Não foi instalado ou executado.
4. A ponte publicada em `jeremy9682/dsh-cursor-codex/server/dsh-mcp.mjs` usa `task`, `cwd` e `timeout_ms`. A skill local orientava enviar `context`, `sandbox` e `max_iterations`, que não fazem parte desse contrato.
5. A ponte upstream usava descoberta por `dsh`/`npx` e uma composição de argumentos inadequada para o launcher com argumentos prefixados. A instalação Windows disponível foi confirmada em `AppData/Roaming/npm/node_modules/@deepseek-ai/dsh`, versão **0.1.5-rc.3**. A integração local passou a usar Node e CLI por caminhos absolutos, sem shell e sem download automático no startup.

O DSH Web já estava rodando. Seu processo não foi encerrado ou reiniciado. `dsh-plugin-codex-bridge` 0.1.1 existe no perfil `default`; sua função é trazer contexto do Codex para o DSH, não publicar um servidor MCP de delegação.

## Configuração efetiva do DSH

A documentação da instalação define perfis por `profiles/<nome>/package.json` e `cordis.patch.yml`, com overrides adicionais documentados. O `config.yml` encontrado na raiz de `.dsh` não é a configuração de perfil usada por esse launcher. Não presumir que seus campos `max_iterations`, fallback NVIDIA e `sandbox` estejam ativos.

`settings.yaml` registra `deepseek-official / deepseek-v4-pro / high`. Essa seleção foi preservada; não houve chamada ao provedor para confirmar disponibilidade, autenticação ou custo. O modelo do orquestrador Codex permaneceu Sol alto.

O perfil `headless` foi inicializado pelo comando oficial `--profile headless --help`, sem tarefa de modelo. Seu manifesto usa `@deepseek-ai/dsh-base` e `@deepseek-ai/dsh-headless`, com patch local vazio. O arquivo de credenciais não foi lido nem copiado.

## Alterações aplicadas

| Arquivo externo ao projeto | Alteração |
| --- | --- |
| `C:/Users/Alexs/.codex/config.toml` | Acrescentado `[mcp_servers.dsh]`, stdio via Node absoluto, cwd Comércio 360, startup 30 s, chamada 660 s e duas ferramentas habilitadas |
| `C:/Users/Alexs/.codex/dsh.config.toml` | Substituída configuração inválida por referência da entrada ativa, com aviso de que não é importada automaticamente |
| `C:/Users/Alexs/.codex/mcp/dsh/dsh-mcp.mjs` | Ponte MCP local com correção Windows, allowlist de workspace, limites de entrada/saída e tratamento de notificações |
| `C:/Users/Alexs/.codex/mcp/dsh/upstream-dsh-mcp.mjs` e `LICENSE` | Fonte original fixada e licença MIT preservadas |
| `C:/Users/Alexs/.codex/mcp/dsh/provenance.json` | Origem, revisão, hashes, alterações locais e localização dos backups |
| `C:/Users/Alexs/.codex/mcp/dsh/verify-mcp.mjs` | Verificação reproduzível de protocolo, descoberta, saúde e rejeições antes de execução |
| `C:/Users/Alexs/.codex/skills/codex-delegate-to-dsh/SKILL.md` | Contrato corrigido para `task`, `cwd`, `timeout_ms`; saúde prévia e limites reais documentados |

Backups dos três arquivos existentes: `C:/Users/Alexs/.codex/backups/dsh-repair-20260928-214208/`. Comparação confirmou que o conteúdo anterior de `config.toml` foi preservado, acrescentando apenas a seção DSH. Provedores antigos e configurações dos demais plugins não foram alterados.

Origem da ponte: [repositório do autor](https://github.com/jeremy9682/dsh-cursor-codex), revisão `81def5abbc01bd5b461710ed11a595bb4355f5f7`. É uma integração comunitária, com ajustes locais; não é um servidor MCP oficial do DeepSeek.

| Artefato | SHA-256 |
| --- | --- |
| Fonte upstream | `09937986EB3806E2FA1842AA3720ED18594FFE37F6D3D4DEE778A1BAE047AA10` |
| Ponte instalada | `7129238375E4D537B32230A70D19549CEB550A7E18AC20830255EAFFB2C7DB73` |

## Contrato disponível após recarga

`dsh_health({})` informa versão, perfil e workspaces permitidos. `dsh_delegate` aceita:

```json
{
  "task": "Objetivo finito, contexto necessário, arquivos permitidos, invariantes, critérios e verificações",
  "cwd": "C:/Users/Alexs/Desktop/Comercio360",
  "timeout_ms": 600000
}
```

`task` e `cwd` são obrigatórios. Briefing até 20.000 caracteres; timeout entre 1.000 e 600.000 ms; uma execução por vez. O workspace permitido é somente Comércio 360. Outros projetos precisam de configuração própria conferida, nunca de troca implícita de cwd.

A allowlist limita a raiz de lançamento, não constitui por si só um sandbox de ferramentas. A proteção de arquivos/shell pertence ao perfil DSH e precisa ser avaliada antes de alegar isolamento operacional. A ponte não impõe 25 iterações e não aceita `sandbox` ou `max_iterations`. Não herda automaticamente as permissões do processo Codex.

O stderr de headless pode conter raciocínio do provedor; a ponte drena esse canal sem encaminhá-lo. Falhas retornam códigos sanitizados. A resposta final ainda exige revisão do orquestrador antes de ser usada como evidência. Nenhuma tarefa real foi enviada durante este diagnóstico.

## Evidência desta execução

| Verificação | Resultado |
| --- | --- |
| `node --check` da ponte | Concluiu com código 0 |
| `codex mcp get dsh --json` após instalação | Servidor habilitado, stdio, caminhos e duas ferramentas reconhecidos |
| Inicialização MCP | PASS |
| `tools/list` | PASS: `dsh_delegate`, `dsh_health` |
| Schema de entrada | PASS: task/cwd obrigatórios e argumentos extras rejeitados |
| `dsh_health` | PASS: DSH 0.1.5-rc.3 e perfil headless presente |
| Parâmetros antigos/inesperados | Rejeitados antes de executar tarefa |
| cwd relativo e workspace externo | Rejeitados antes de executar tarefa |
| Timeout acima do limite | Rejeitado antes de executar tarefa |
| Ping | PASS |
| Tarefas reais executadas no modelo | **Zero** |
| Ferramenta carregada nesta conversa | **Ainda ausente no catálogo corrente; requer recarga** |

As nove verificações MCP foram executadas no arquivo preparado e repetidas no caminho instalado. Não comprovam autenticação do modelo, execução de código por worker, segurança completa do perfil ou qualidade de uma entrega. Testes da aplicação Comércio 360 e homologação Supabase não foram reexecutados.

## Próxima ação

Recarregar o aplicativo Codex para reconstruir as conexões e o catálogo MCP. Após reabrir esta tarefa, conferir `dsh_health` pela ferramenta nativa e então executar um teste curto explicitamente delimitado pela própria ferramenta `dsh_delegate`. Não substituir essa chamada por execução headless via shell quando o objetivo for delegar.

O Git do Comércio 360 foi confirmado: pasta `.git` inicializada, arquivos no index e branch `master` ainda sem primeiro commit. Não foi criado commit nem alterado o index nesta correção. Antes de trabalhos paralelos com worktrees, estabelecer o baseline versionado.

Fontes de configuração: [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp) e documentação local dos pacotes `@deepseek-ai/dsh`, `dsh-headless` e `dsh-base`. O protocolo instalado, e não um nome de pacote presumido, é a fonte para os argumentos da ferramenta.
