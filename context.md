# Comércio 360 — contexto permanente de desenvolvimento

**Atualizado em 01/10/2026 na branch codex/catalogo-002 (base 3ccd2d0).** Leia no início de cada tarefa; confira fontes, evidências e pendências nos documentos vinculados. Não converta resultados históricos em PASS por redação.

## Estado atual e próximo passo

| Item | Estado conferido |
| --- | --- |
| Aplicação | **0.1.1**: fundação concluída; Catálogo 002 implementado localmente nesta branch, ainda sem homologação hospedada |
| Gate H1 hospedado | **36 PASS / zero FAIL** no Supabase descartável; resultado sanitizado em `docs/H1_RESULTADOS.json` |
| Revisão arquitetural H1 | **Aprovada com condições** em 26/09/2026; parecer em `docs/REVISAO_ARQUITETURAL_H1.md` |
| Pacote 002 | **Aceito integralmente em 30/09/2026**; implementação local e testes em `codex/catalogo-002`; contrato em `docs/adr/ADR-0010-catalogo-produtos.md`; evidência em `docs/ENTREGA_CATALOGO_002.md` |
| Desenvolvimento por IA | Seis skills/perfis e validador Git 0.1. H-03 integrado em `4a80096`. H-04 U1 encerrado no escopo sintético da árvore principal; telemetria G confirmou uma chamada MCP real. Essas alterações posteriores à base não estão neste worktree; ver o checkpoint da árvore principal |
| Publicação e dados reais | Ainda não homologados; condições operacionais abertas |

**Próxima ação desta branch:** revisar o relatório de entrega e planejar homologação hospedada do Catálogo em projeto descartável identificado, com chave de atestação provisionada por canal seguro; nenhuma operação hospedada do Catálogo foi executada. Este worktree parte de 3ccd2d0 e não incorpora as alterações não commitadas de H-04/G na árvore principal; conferir aquela árvore antes da integração final.

**Evidência local Catálogo em 01/10/2026:** `npm run lint`, `npm run typecheck` e `npm run build` PASS; `npm test` 120/120, `npm run test:e2e` 17/17; `npm run repomap` e `npm run test:harness` (14/14) executados; `npm audit` zero vulnerabilidades após correções do lockfile. Revisão independente CAT-002-SEC-02: sem achados bloqueantes após correções. Detalhes, limites e itens `not_run` em `docs/ENTREGA_CATALOGO_002.md`. Os 36 PASS hospedados H1 não abrangem o Catálogo.

## Produto e decisões já tomadas

- Nome: **Comércio 360**. Nicho inicial: **moda e acessórios**. Piloto planejado para **uma loja**, sem abandonar a arquitetura multiempresa/multiloja. A loja participante ainda não foi identificada.
- Canais futuros do MVP: balcão e WhatsApp. Fornecedor, modelo e API do fiscal/maquininha ainda precisam ser levantados.
- Motoristas, veículos e contatos exclusivos de cada organização no primeiro ciclo: direção futura, não funcionalidade.
- Pacote 002 aceito: categorias, produtos, variantes de cor/tamanho, SKU, preço por loja em BRL, pesquisa e capa privada opcional. Fora do escopo: estoque, fornecedores, compras, PDV, pagamentos, fiscal, fretes, WhatsApp operacional e mídias sociais.
- Registro original: `docs/DECISOES_PILOTO.md`.

## Fundação implementada

Neste worktree: Next.js 16.3.8, React 19, TypeScript e Supabase/PostgreSQL em monólito modular. `app/` concentra rotas/actions, `lib/` integra Supabase, `packages/` separa domínio/validação/UI/configuração; `supabase/` e `tests/` guardam migrações e provas. `mocks/` é só apresentação. Ver `docs/architecture/ARQUITETURA.md`.

Autenticação: `@supabase/ssr`, cookies e `getUser()` no servidor; `proxy.ts` renova a sessão; páginas e Server Actions revalidam acesso. A chave administrativa **não entra no runtime web**. O painel exibe indicadores fictícios identificados; `/demo` é prévia pública sem sessão e sem operação; as demais abas comerciais mostram “Em construção”; sem operação offline.

Identidade e autorização: `auth.users` é identidade autenticável; `profiles`, identidade global; `memberships`, vínculo ativo e papel por organização; `user_store_access`, acesso explícito às lojas; `organizations.id` é a raiz do tenant. RLS e chaves compostas isolam organizações. A seleção de loja e as RPCs do Catálogo são os mutadores expostos com auditoria; cadastro administrativo segue processo próprio. Corretivo 001.1: seletor omite organizações sem lojas ativas autorizadas; vínculo ativo sem loja não autoriza operar; sem qualquer loja, `/sem-acesso`. Cookie de contexto é preferência, nunca fonte de permissão; `requireAccess` usa `React.cache` só na renderização da mesma requisição, e páginas/actions/RLS continuam verificando autorização.

Migração incremental: bloqueia atualizações efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`, inclusive DML administrativo normal; não mover registros entre tenants por `UPDATE`. Auditoria é append-only (ator/origem/antes/depois) e impede `old_value`/`new_value` declarando outro tenant.

## Banco, seed e evidência

As duas migrações H1 `202609070001_foundation.sql` e `202609080001_tenant_key_guards.sql` foram confirmadas em Local e Remote no Supabase descartável. Esta branch acrescenta somente as migrações locais de Catálogo `202609300001_catalog.sql`, `202609300002_catalog_storage.sql` e `202609300003_catalog_image_attestation.sql`; nenhuma foi aplicada em ambiente hospedado. Não reaplicar, reescrever nem usar `migration repair`; novos módulos exigem migrações incrementais novas e revisão própria. Evidência de alinhamento é da homologação H1.

`supabase/seed.sql` usa duas organizações e três lojas fictícias; o seed preparou quatro contas `example.test` preservando senhas. `scripts/seed-users.mjs` exige `ALLOW_DEVELOPMENT_SEED=yes`, confirmação independente da URL e domínio exato `example.test`; `scripts/h1-manual.ps1` solicita chave e senha com entrada oculta e emite só resultados sanitizados. Não reexecutar seed por rotina nem inserir credenciais em código, `.env.example`, relatórios ou conversa.

`docs/H1_RESULTADOS.json` registra 36 PASS (login real, expiração/renovação, matriz de acesso, RLS, revogação, chaves estruturais, auditoria, navegador); a primeira tentativa, com 31 PASS e falha composta de expiração, está preservada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`. **Não alterar retroativamente nenhum JSON de evidência.** O ZIP histórico `comercio360-h1.zip` e sua revisão constam de `docs/REVISAO_ARQUITETURAL_H1.md`. A branch Catálogo acrescenta código, migrações e dependências, sem alterar os JSONs H1.

## Validação e limites de implantação

Depois da correção H1-DEP-01, Vitest e `@vitest/mocker` estão em **4.1.11**. A revisão de 25–26/09 reproduziu `npm ci`, lint, tipos, **90/90 testes**, build, **11/11 E2E** e `npm audit` com zero vulnerabilidades. Testes locais usam PGlite e Auth simulado; a execução hospedada H1 é evidência separada. Esses números são históricos da fundação, não da suíte atual do Catálogo.

Antes de publicar ou usar dados reais, permanecem condições do parecer: (1) o operador **ainda não conferiu** se login anônimo está desativado no painel Supabase; (2) validar login, seleção, persistência, renovação, logout e cookies Secure sob **HTTPS da própria aplicação**; (3) definir e ensaiar backup/restauração em ambiente novo, com responsável, retenção, RPO/RTO, Auth, dados e auditoria; (4) separar produção de desenvolvimento, configurar Auth/URLs/segredos por canal seguro e manter provisionamento rastreável; (5) identificar a loja real do piloto. Essas condições bloqueiam prontidão para implantação, não a especificação do Pacote 002. Matriz completa em `docs/REVISAO_ARQUITETURAL_H1.md`.

## Harness de desenvolvimento por IA

- Plano e roteamento em `docs/ai/PLANO_ORQUESTRACAO.md`; seis perfis em `.codex/agents/` e seis skills em `.agents/skills/`. Contratos e validador em `docs/ai/CONTRATOS_HARNESS.md` e `scripts/harness/validate.mjs` (último gate histórico 14/14). RepoMap em `docs/ai/REPOMAP.md`; regenerar se necessário.
- H-03 integrado em `4a80096` (`docs/ai/RELATORIO_H03.md`). Na árvore principal, U1 foi encerrado somente no escopo sintético e G validou uma chamada MCP real; a rota Codex e custo comparável seguem sem sinal. Ver `docs/ai/CONTINUACAO_NOVO_CHAT.md` e `docs/ai/TELEMETRIA_G.md` da árvore principal. Esses avanços não estão nesta branch. Esta branch parte de `3ccd2d0` e não incorpora mudanças não commitadas da árvore principal.
- Histórico MCP/DSH em `docs/ai/HISTORICO_DSH.md`; diagnóstico de tokens e medidas A–G em `docs/ai/DIAGNOSTICO_TOKENS.md`. Não converter resultados históricos em PASS por redação.

## Roteiro de cada nova tarefa

1. **Leia este `context.md` primeiro.** Confira a data e compare, conforme o tema, com `docs/REVISAO_ARQUITETURAL_H1.md`, `docs/PACOTE_002_CATALOGO_PROPOSTA.md`, `docs/ENTREGA_H1.md`, `docs/H1_RESULTADOS.json`, `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md`. O parecer de 26/09 é a fonte do estado atual da revisão; os JSONs guardam o estado original das execuções.
2. Confira o estado real da pasta, versões e alterações desde a última atualização. Leia `AGENTS.md` e, antes de editar código Next, os guias relevantes em `node_modules/next/dist/docs/`. Para localizar código, use `docs/ai/REPOMAP.md` (regenerando com `npm run repomap` se a árvore mudou). Histórico DSH só por demanda: `docs/ai/HISTORICO_DSH.md`.
3. Delimite o pacote aprovado, dados, permissões, isolamento por tenant, auditoria, migração incremental, interface e critérios de aceite. O aceite do Pacote 002 e ADR-0010 já estão registrados; novas alterações de escopo exigem decisão própria.
4. Implemente somente o escopo aceito e teste domínio/SQL, autorização direta e navegador conforme a mudança. Em worker DSH, apenas checagens estáticas (tsc, diff, `node --check`); testes dinâmicos rodam **uma vez, pelo orquestrador, fora do sandbox**; o revisor confere o log, não reexecuta. Retomadas enviam só o delta do achado.
5. Atualize este `context.md` no fim de cada mudança significativa: data, pacote/versão, decisões aceitas, arquivos e migrações novos, testes realmente executados, evidências, pendências e próximo passo. Atualize também README, changelog, ADRs e relatório quando afetados. **Não marque PASS sem execução e não reescreva evidências anteriores.** Se este arquivo ultrapassar ~12 KB, mova as entradas mais antigas para o documento de módulo correspondente e deixe aqui o ponteiro; os guardas de segurança das seções finais permanecem fixos.

Comandos locais de referência: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm audit`; `npm run dev` oferece a prévia `/demo`. Os E2E usam as portas 3001 e 54329; no Windows, se o teardown travar, encerrar **somente** auxiliares identificados — nunca processos desconhecidos.

## Regras de segurança da continuidade

Não solicitar nem registrar senha de usuário, chave administrativa, segredo de banco ou JWT pelo chat. `.env.local`, `node_modules`, `.next*`, `.git`, `supabase/.temp` e relatórios de navegador não fazem parte de artefatos limpos. `.env.example` é somente modelo sem credenciais. O acesso administrativo necessário a seed/homologação ocorre no terminal local do operador com entrada oculta. Preservar auditoria e migrações já aplicadas; não usar reset/repair para contornar divergências.

**Estado para a próxima tarefa:** fundação 0.1.1 aprovada com condições; H-01 concluída; H-02 parcial (seis skills/perfis, validador ampliado, discovery a observar); H-03 concluído sem métricas de modelo/custo; H-04 U1 sintético encerrado e G com uma chamada MCP real na árvore principal, sem telemetria Codex/custo comparável; esta branch não incorpora esse delta; Catálogo 002 aceito e implementado localmente; homologação hospedada do Catálogo pendente; publicação e dados reais bloqueados pelas condições operacionais acima.
