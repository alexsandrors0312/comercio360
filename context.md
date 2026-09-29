# Comércio 360 — contexto permanente de desenvolvimento

**Atualizado em 28/09/2026.** Leia este arquivo **no início de cada nova tarefa de desenvolvimento** do Comércio 360, antes de editar código, banco ou documentação. Ao concluir uma mudança relevante, atualize as seções afetadas com data, evidências e pendências reais. Este arquivo orienta a continuidade; código, migrações, decisões assinadas e relatórios de execução continuam sendo as fontes para conferir cada afirmação.

## Estado atual e próximo passo

| Item | Estado conferido |
| --- | --- |
| Aplicação | **0.1.1**: Pacote 001 e corretivo 001.1 concluídos. Fundação executável, sem módulos comerciais operacionais |
| Gate H1 hospedado | **36 PASS / zero FAIL** no Supabase descartável; resultado sanitizado preservado em `docs/H1_RESULTADOS.json` |
| Revisão arquitetural H1 | **Aprovada com condições para continuidade do desenvolvimento** em 26/09/2026; parecer em `docs/REVISAO_ARQUITETURAL_H1.md` |
| Pacote 002 | Há **proposta revisável de Catálogo de Produtos** em `docs/PACOTE_002_CATALOGO_PROPOSTA.md`. Sua **implementação ainda não foi aprovada** |
| Desenvolvimento por IA | Plano de orquestração e contratos propostos em `docs/ai/PLANO_ORQUESTRACAO.md` e `docs/ai/CONTRATOS_HARNESS.md`; skills, perfis e validação automatizada ainda não implantados |
| Publicação e dados reais | Ainda não homologados; condições operacionais abertas |

**Próxima ação:** estruturar o ambiente de desenvolvimento por IA conforme o plano solicitado em 28/09, começando por versionamento/baseline, skills e contratos verificáveis, seguidos de um piloto controlado. O plano está documentado; não há harness específico implantado ou avaliado. Para iniciar desenvolvimento comercial, revisar com o responsável pelo produto a proposta do Pacote 002 — campos, regras, papéis, preços por loja, imagem privada e critérios de aceite — e registrar o aceite e um ADR específico. A aprovação arquitetural do H1 liberou **a definição do escopo**, não o início automático da codificação do catálogo. Até esse aceite, é válido esclarecer decisões e revisar o desenho; não apresentar módulos comerciais como concluídos.

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

A pedido do responsável pelo produto, foi elaborado `docs/ai/PLANO_ORQUESTRACAO.md`, com mapa dos módulos futuros, um orquestrador Codex Sol alto ou Astra e seis funções de worker: Infra/Dados, Domínio/Validação, Aplicação/Backend, Frontend/Acessibilidade, QA/Evidências e Revisão de Segurança/Arquitetura. O plano especifica seis skills iniciais, roteamento por risco, contexto por tarefa, revisão independente e implantação gradual. São propostas operacionais, ainda sem configuração instalada ou avaliação de economia/qualidade.

`docs/ai/CONTRATOS_HARNESS.md` define envelopes de tarefa, resultado, revisão e retomada. Os exemplos são sintéticos. Validador, dispatcher e métricas ainda precisam de implementação; não afirmar que os contratos já têm enforcement automático. A regra atual de ler `AGENTS.md` e `context.md` no início continua aplicável; os demais documentos são selecionados conforme a tarefa.

Ao elaborar o plano, a pasta estava sem Git e a ferramenta `dsh_delegate` estava ausente. Na continuidade de 28/09, o Git foi confirmado inicializado, com arquivos no index e sem primeiro commit. Baseline versionado e worktrees ainda estão pendentes; até lá, um único escritor por workspace.

A correção de disponibilidade MCP está em `docs/ai/DIAGNOSTICO_DSH_MCP.md`: o config ativo não registrava DSH e o pacote npm citado no arquivo separado retornou E404. Foi instalada uma ponte comunitária local com ajustes Windows em `C:/Users/Alexs/.codex/mcp/dsh`, registrada em `config.toml`, e corrigida a skill pessoal. O contrato real é `task`, `cwd`, `timeout_ms`; não enviar `context`, `sandbox` ou `max_iterations`. Não há limite de 25 iterações imposto pela ponte. A configuração permite lançar tarefas somente no Comércio 360.

Codex reconheceu o servidor habilitado; inicialização MCP, descoberta de duas ferramentas, saúde do DSH 0.1.5-rc.3 e rejeições de entradas inválidas foram verificadas localmente. O perfil headless foi inicializado com `--help`. Nenhuma tarefa foi enviada ao modelo e nenhuma credencial foi lida. **A ferramenta ainda não está carregada no catálogo desta conversa: recarregar Codex e conferir `dsh_health` antes de delegar.** Isolamento do worker, chamada real e avaliação de qualidade/custo continuam pendentes. Backups e hashes da integração constam no diagnóstico.

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

**Estado para a próxima tarefa:** fundação 0.1.1 aprovada com condições; plano de desenvolvimento por IA documentado, com implantação e avaliação pendentes; proposta de Catálogo 002 aguardando aceite próprio; publicação e dados reais ainda bloqueados pelas condições operacionais acima.
