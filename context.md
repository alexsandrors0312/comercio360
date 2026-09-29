# Comércio 360 — contexto permanente de desenvolvimento

**Atualizado em 29/09/2026.** Leia este arquivo **no início de cada nova tarefa de desenvolvimento** do Comércio 360, antes de editar código, banco ou documentação. Ao concluir uma mudança relevante, atualize as seções afetadas com data, evidências e pendências reais. Este arquivo orienta a continuidade; código, migrações, decisões assinadas e relatórios de execução continuam sendo as fontes para conferir cada afirmação.

## Estado atual e próximo passo

| Item | Estado conferido |
| --- | --- |
| Aplicação | **0.1.1**: Pacote 001 e corretivo 001.1 concluídos. Fundação executável, sem módulos comerciais operacionais |
| Gate H1 hospedado | **36 PASS / zero FAIL** no Supabase descartável; resultado sanitizado preservado em `docs/H1_RESULTADOS.json` |
| Revisão arquitetural H1 | **Aprovada com condições para continuidade do desenvolvimento** em 26/09/2026; parecer em `docs/REVISAO_ARQUITETURAL_H1.md` |
| Pacote 002 | Há **proposta revisável de Catálogo de Produtos** em `docs/PACOTE_002_CATALOGO_PROPOSTA.md`. Sua **implementação ainda não foi aprovada** |
| Desenvolvimento por IA | Baseline Git `5977cdb`; seis skills/perfis e validador inicial. VS Code abriu o projeto com Codex, Gemini Code Assist e DSH Sidebar 0.0.5 instalada após aprovação específica; transporte MCP DSH ativo, mas execução do modelo falhou (`exit=1`). Piloto e avaliação comparativa pendentes |
| Publicação e dados reais | Ainda não homologados; condições operacionais abertas |

**Próxima ação:** resolver a falha de provedor DSH descrita em [INTEGRACAO_VSCODE.md](docs/ai/INTEGRACAO_VSCODE.md), recarregar a conexão MCP e executar o [piloto H-03](docs/ai/PILOTO_H03.md). A autorização de envio foi dada em 29/09; não solicitá-la novamente. Confirmar também o modelo efetivo Gemini no VS Code antes de avaliação H-04. Para iniciar desenvolvimento comercial, revisar com o responsável pelo produto a proposta do Pacote 002 — campos, regras, papéis, preços por loja, imagem privada e critérios de aceite — e registrar o aceite e um ADR específico. A aprovação arquitetural do H1 liberou **a definição do escopo**, não o início automático da codificação do catálogo. Até esse aceite, é válido esclarecer decisões e revisar o desenho; não apresentar módulos comerciais como concluídos.

## Produto e decisões já tomadas

- Nome: **Comércio 360**. Nicho inicial: **moda e acessórios**. Piloto planejado para **uma loja**, sem abandonar a arquitetura multiempresa/multiloja. A loja participante ainda não foi identificada.
- Canais futuros do MVP: balcão e WhatsApp. O fornecedor, modelo e API do sistema fiscal/maquininha do comerciante ainda precisam ser levantados.
- Motoristas, veículos e contatos serão exclusivos de cada organização no primeiro ciclo. Isso é direção futura, não funcionalidade implementada.
- A proposta do Pacote 002 inclui categorias, produtos, variantes de cor/tamanho, SKU, preço por loja em BRL, pesquisa e uma capa privada opcional. É uma **proposta**, não decisão de implementação já aceita. Estoque, fornecedores, compras, PDV, pagamentos, fiscal, fretes, WhatsApp operacional e mídias sociais ficam fora do escopo proposto.

Consulte `docs/DECISOES_PILOTO.md` para o registro original dessas decisões.

## Fundação implementada

O projeto em `C:\Users\Alexs\Desktop\Comercio360` usa Next.js **16.3.4**, React 19, TypeScript e Supabase/PostgreSQL em um monólito modular. `app/` contém rotas e ações; `lib/` integra o Supabase e obtém o contexto autorizado; `packages/domain/` contém regras puras; `packages/validation/`, `packages/ui/` e `packages/config/` separam esquemas, interface e navegação; `supabase/` contém migrações e seed; `tests/` cobre regras, SQL, scripts, navegador e homologação hospedada. `mocks/` alimenta a apresentação, não a autorização real.

A autenticação usa `@supabase/ssr`, cookies e `getUser()` no servidor. `proxy.ts` renova a sessão, e páginas e Server Actions revalidam acesso. A chave administrativa **não entra no runtime web**. O painel autenticado exibe indicadores fictícios identificados como tal; `/demo` é uma prévia pública sem sessão e sem acesso operacional. As abas comerciais permanecem “Em construção”. Não há operação offline.

`auth.users` guarda a identidade autenticável; `profiles` é identidade global; `memberships` define vínculo ativo e papel por organização; `user_store_access` dá acesso explícito às lojas. Nem gerente nem proprietário recebem loja por bypass. `organizations.id` é a raiz do tenant. RLS e chaves compostas isolam organizações e impedem referências estruturais cruzadas. O único mutador exposto na fundação é a seleção autorizada de loja via `set_active_store`, com auditoria. O cadastro de identidades/vínculos/acessos continua no processo administrativo.

O corretivo 001.1 omite do seletor organizações sem lojas ativas autorizadas. Vínculo ativo sem loja não autoriza operar; sem qualquer loja, o usuário vai para `/sem-acesso`. Cookie de contexto é preferência, nunca fonte de permissão. `requireAccess` usa `React.cache` somente durante a renderização da mesma requisição; páginas, actions e RLS continuam verificando autorização.

A migração incremental bloqueia atualizações efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`, inclusive DML administrativo normal. Não mover registros entre tenants por `UPDATE`. Auditoria é append-only, mantém ator/origem/antes/depois e impede `old_value` ou `new_value` declarando outro tenant. Uma troca legítima de organização não transporta o snapshot anterior para o evento da nova empresa.

## Banco, seed e evidência

As **únicas migrações existentes** são `supabase/migrations/202609070001_foundation.sql` e `supabase/migrations/202609080001_tenant_key_guards.sql`. O operador confirmou ambas em Local e Remote no projeto Supabase descartável e o dry-run informou banco atualizado. Não reaplicar, reescrever nem usar `migration repair` para avançar. Novos módulos exigirão **novas migrações incrementais** e revisão própria. A evidência de alinhamento é histórica, da homologação H1; não presume que o estado remoto de hoje tenha sido consultado.

O `supabase/seed.sql` usa duas organizações e três lojas fictícias. O seed administrativo preparou quatro contas `example.test`, preservando senhas existentes. `scripts/seed-users.mjs` exige `ALLOW_DEVELOPMENT_SEED=yes`, confirmação **independente** da URL do projeto e endereços no domínio exato `example.test`; falha antes de escrita se os guards não passarem. `scripts/h1-manual.ps1` solicita chave e senha com entrada oculta no terminal e emite somente resultados sanitizados. Não executar seed novamente por rotina nem inserir credenciais em código, `.env.example`, relatórios ou conversa.

`docs/H1_RESULTADOS.json` registra 36 PASS de login real, expiração e renovação, matriz de acesso, RLS, revogação, chaves estruturais, auditoria e navegador. A primeira tentativa, com 31 PASS e uma falha composta de expiração, segue preservada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`. A correção do teste passou a esperar a tolerância documentada de 30 segundos do PostgREST mais cinco segundos de margem; os JWT antigos receberam HTTP 401 / `jwt_expired`, e a sessão renovada voltou à área autorizada. Não alterar retroativamente nenhum JSON de evidência.

O ZIP congelado `comercio360-h1.zip` teve SHA-256 `F1BEE053725F261551331E3CE0FBCB27835593C28B58E720F50C074FBA3024E0`. A revisão de 26/09 comparou seus **78 arquivos** com a pasta antes das atualizações documentais e aprovou a integridade. A pasta atual acrescentou `docs/REVISAO_ARQUITETURAL_H1.md` e `docs/PACOTE_002_CATALOGO_PROPOSTA.md`; README, changelog, arquitetura e ADR-0009 foram atualizados para apontar o parecer. Código funcional, migrações, dependências e evidência H1 permaneceram iguais ao ZIP revisto.

## Validação e limites de implantação

Depois da correção técnica H1-DEP-01, Vitest e `@vitest/mocker` estão em **4.1.11**. A revisão arquitetural de 25–26/09 reproduziu `npm ci`, lint, tipos, **90/90 testes**, build, **11/11 E2E** e `npm audit --json` com **zero vulnerabilidades reportadas**. Os testes locais usam PGlite e Auth simulado; a execução hospedada H1 é evidência separada. Os testes **não foram reexecutados ao escrever este arquivo**.

Antes de publicar ou usar dados reais, permanecem condições do parecer arquitetural:

- O operador respondeu em 26/09 que **ainda não conferiu** se login anônimo está desativado no painel Supabase. Cadastro público desativado e login por e-mail habilitado foram verificados; não inferir o estado do login anônimo.
- H1 usou Next em HTTP local e Supabase em HTTPS. Validar login, seleção, persistência, renovação, logout e atributos Secure dos cookies sob **HTTPS da própria aplicação**.
- Definir e ensaiar backup/restauração em ambiente novo, com responsável, retenção, RPO/RTO, Auth, dados e auditoria.
- Separar produção de desenvolvimento, configurar Auth/URLs/segredos por canal seguro e manter provisionamento administrativo rastreável.
- Identificar a loja real do piloto; não tratar as lojas fictícias do seed como escolha de produto.

Essas condições não impedem especificar o Pacote 002, mas bloqueiam a conclusão de prontidão para implantação ou dados reais. Leia a matriz completa em `docs/REVISAO_ARQUITETURAL_H1.md`.

## Planejamento do desenvolvimento por IA — 28/09/2026

A pedido do responsável pelo produto, foi elaborado `docs/ai/PLANO_ORQUESTRACAO.md`, com mapa dos módulos futuros, um orquestrador Codex Sol alto ou Astra e seis funções de worker: Infra/Dados, Domínio/Validação, Aplicação/Backend, Frontend/Acessibilidade, QA/Evidências e Revisão de Segurança/Arquitetura. O plano especifica roteamento por risco, contexto por tarefa, revisão independente e implantação gradual. Em 29/09 foram criados seis perfis em `.codex/agents/` e seis skills em `.agents/skills/`. Ainda não há observação de discovery em nova sessão nem avaliação de economia/qualidade.

`docs/ai/CONTRATOS_HARNESS.md` define envelopes de tarefa, resultado, revisão e retomada. Os exemplos são sintéticos. `scripts/harness/validate.mjs` valida a forma e parte da semântica dos envelopes/resultados Git 0.1; seis testes negativos/positivos passaram, mas dispatcher, revisão semântica, métricas e isolamento efetivo ainda não existem. `scripts/harness/check-skills.mjs` verificou a estrutura das seis skills. O validador oficial da skill-creator não rodou: o Python disponível não tinha `PyYAML`; a checagem local não equivale a discovery/execução. A regra atual de ler `AGENTS.md` e `context.md` no início continua aplicável; os demais documentos são selecionados conforme a tarefa.

Ao elaborar o plano, a pasta estava sem Git e a ferramenta `dsh_delegate` estava ausente. Na continuidade de 28/09, o Git foi inicializado. O primeiro commit local `5977cdb` registrou o baseline em 29/09 com identidade de automação apenas nessa execução; não há remoto. Usar um único escritor por tarefa até ensaiar worktrees e integração.

A correção de disponibilidade MCP está em `docs/ai/DIAGNOSTICO_DSH_MCP.md`: o config ativo não registrava DSH e o pacote npm citado no arquivo separado retornou E404. Foi instalada uma ponte comunitária local com ajustes Windows em `C:/Users/Alexs/.codex/mcp/dsh`, registrada em `config.toml`, e corrigida a skill pessoal. O contrato real é `task`, `cwd`, `timeout_ms`; não enviar `context`, `sandbox` ou `max_iterations`. Não há limite de 25 iterações imposto pela ponte. A configuração permite lançar tarefas somente no Comércio 360.

Codex reconheceu o servidor habilitado; inicialização MCP, descoberta de duas ferramentas, saúde do DSH 0.1.5-rc.3 e rejeições de entradas inválidas foram verificadas localmente. Em 29/09, `dsh_health` respondeu OK com perfil headless e workspace permitido. A primeira chamada de `dsh_delegate`, para criar os perfis, foi **rejeitada pelo auto-review antes da execução** por falta de autorização explícita de exportação. O usuário depois concedeu essa autorização. O despacho do piloto H-03 e uma chamada mínima chegaram à ponte, mas ambos retornaram `DSH_RUN_FAILED (exit=1)`, sem resposta do worker. `~/.dsh/config.yml` cita R1 via NVIDIA NIM sem `NVIDIA_API_KEY` presente; `~/.dsh/settings.yaml` aponta para DeepSeek oficial V4 Pro. Não foi comprovado qual modelo seria efetivamente chamado. Nenhuma credencial foi lida. Isolamento do worker e avaliação de qualidade/custo continuam pendentes. A integração com VS Code e o diagnóstico atual estão em `docs/ai/INTEGRACAO_VSCODE.md`.

Após aprovação específica do responsável, `lixxx1.dsh-sidebar@0.0.5` foi instalada e confirmada por `code --list-extensions --show-versions`; `code --status` confirmou a janela do projeto e o host de extensões ativo. O responsável delegou a escolha do provedor para o piloto: seguir com o padrão `deepseek-official`/`deepseek-v4-pro` de `~/.dsh/settings.yaml`. Uma segunda chamada mínima após a instalação também retornou `DSH_RUN_FAILED (exit=1)`; somando o piloto, houve três tentativas sem relatório de worker. A ativação do chat da extensão, sua autenticação e o modelo efetivo ainda não foram verificados. A autorização de envio ao DSH e a aprovação dessa extensão continuam válidas; não solicitar novamente.

Nesta continuação, `npm run test:harness` passou com 6/6 testes, `npm run lint` passou, os três JSONs de `.vscode/` foram analisados sem erro e `git diff --check` não apontou erro. Não houve alteração de código funcional Next.js, migrações ou evidências H1; os gates de aplicação não foram reexecutados.

Conferência documental: código de acesso, domínio, actions e rota genérica examinados; os hashes de `docs/H1_RESULTADOS.json`, das duas migrações e de `package-lock.json` coincidem com os registrados na revisão H1. Não houve alteração funcional, instalação de dependências, acesso remoto ou reexecução de testes de aplicação. Os resultados históricos permanecem preservados. O plano não aprova a implementação do Catálogo nem encerra as condições operacionais H1.

## Roteiro de cada nova tarefa

1. **Leia este `context.md` primeiro.** Confira a data e compare com `docs/REVISAO_ARQUITETURAL_H1.md`, `docs/PACOTE_002_CATALOGO_PROPOSTA.md`, `docs/ENTREGA_H1.md`, `docs/H1_RESULTADOS.json`, `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md`, conforme o tema. Documentos históricos podem dizer que H1 está pendente; o parecer de 26/09 é a fonte para o estado atual da **revisão**, enquanto os JSONs guardam o estado original das **execuções**.
2. Confira o estado real da pasta, versões e alterações desde a última atualização. Não presuma que um relatório antigo represente a árvore atual. Leia `AGENTS.md` e, antes de editar código Next, os guias relevantes em `node_modules/next/dist/docs/` exigidos por esse arquivo.
3. Delimite o pacote aprovado, seus dados, permissões, isolamento por tenant, auditoria, migração incremental, interface e critérios de aceite. Para o Pacote 002, obtenha o aceite da proposta e registre ADR antes de codificar.
4. Implemente somente o escopo aceito. Teste domínio/SQL, autorização direta e navegador conforme a mudança. Para mudanças no banco hospedado, confira histórico e use um ambiente descartável identificado, com execução administrativa pelo operador quando precisar de chave secreta.
5. Atualize este `context.md` no fim de cada mudança significativa: data, pacote/versão, decisões aceitas, arquivos e migrações novos, testes realmente executados, evidências, pendências e próximo passo. Atualize também README, changelog, ADRs e relatório de entrega quando afetados. **Não marque PASS sem execução e não reescreva evidências anteriores.**

Para a fundação atual, os comandos locais de referência são `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm audit`. `npm run dev` oferece a prévia `/demo`. Os E2E usam as portas 3001 e 54329; em Windows anterior, as asserções passaram, mas o teardown exigiu encerrar **somente** auxiliares identificados. Não encerrar processos desconhecidos.

## Regras de segurança da continuidade

Não solicitar nem registrar senha de usuário, chave administrativa, segredo de banco ou JWT pelo chat. `.env.local`, `node_modules`, `.next*`, `.git`, `supabase/.temp` e relatórios de navegador não fazem parte de artefatos limpos. `.env.example` é somente modelo sem credenciais. O acesso administrativo necessário a seed/homologação ocorre no terminal local do operador com entrada oculta. Preservar auditoria e migrações já aplicadas; não usar reset/repair para contornar divergências.

**Estado para a próxima tarefa:** fundação 0.1.1 aprovada com condições; H-01 concluída, H-02 implementada parcialmente com seis skills/perfis, VS Code, DSH Sidebar instalada e validador inicial; H-03 autorizado, mas bloqueado por falha de execução do provedor DSH, ainda sem relatório de worker; Gemini Pro no VS Code não teve modelo efetivo verificado; Catálogo 002 aguarda aceite próprio; publicação e dados reais permanecem bloqueados pelas condições operacionais acima.
