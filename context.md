# Comércio 360 — contexto permanente de desenvolvimento

**Atualizado em 02/10/2026.** Leia este arquivo **no início de cada tarefa de desenvolvimento**. Atualize estado, evidências e pendências após mudanças relevantes. Este é um **índice**: confira as afirmações no código, migrações, decisões e relatórios; detalhes extensos ficam nos documentos de módulo.

## Estado atual e próximo passo

| Item | Estado conferido |
| --- | --- |
| Aplicação | **0.1.1**: fundação concluída; Catálogo 002 integrado localmente à árvore principal, ainda sem homologação hospedada |
| Gate H1 hospedado | **36 PASS / zero FAIL** no Supabase descartável; resultado sanitizado em `docs/H1_RESULTADOS.json` |
| Revisão arquitetural H1 | **Aprovada com condições** em 26/09/2026; parecer em `docs/REVISAO_ARQUITETURAL_H1.md` |
| Pacote 002 | **Aceito integralmente em 30/09/2026**; implementado e mesclado. Quatro migrações aplicadas em `comercio360-dev`, Auth/Storage/SQL hospedados testados; REST concorrente recebeu HTTP 504 e segue FAIL. Contrato: `docs/adr/ADR-0010-catalogo-produtos.md`; evidência: `docs/CATALOGO_002_HOSPEDADO.md` |
| Desenvolvimento por IA | H-03 integrado; H-04 sintético encerrado (D1/S1 e U1). U1-V1 original: FAIL Codex, not_run DSH; patch só nos clones. G: captura real DSH validada; custo comparável indisponível |
| Publicação e dados reais | Ainda não homologados; condições operacionais abertas |

**Próxima ação do harness:** definir telemetria por tarefa da rota Codex, subagentes e custo antes de novos pares ([TELEMETRIA_G.md](docs/ai/TELEMETRIA_G.md)). U1-V5 substitui U1-V1 só em H-04; reparar o runner original à parte. [RELATORIO_H04.md](docs/ai/RELATORIO_H04.md) guarda H-04. Para o Catálogo, investigar HTTP 504 no REST concorrente e completar endpoint Next/limpeza/HTTPS antes de aprovação hospedada integral.

**Evidência na árvore combinada (02/10):** `npm ci` e auditoria npm zero vulnerabilidades; lint, tipos e build PASS; Vitest 120/120, Playwright 17/17 e harness 16/16 com seis skills na integração local. Após a corretiva 004, Vitest **121/121** (dois workers), lint e tipos PASS. Revisão CAT-002-SEC-02 sem achados bloqueantes no candidato local. No hospedado: RLS/Storage/atestações e CAS SQL PASS; concorrência REST FAIL HTTP 504. Detalhes em `docs/ENTREGA_CATALOGO_002.md` e `docs/CATALOGO_002_HOSPEDADO.md`.

## Produto e decisões já tomadas

- Nome: **Comércio 360**. Nicho inicial: **moda e acessórios**. Piloto planejado para **uma loja**, sem abandonar a arquitetura multiempresa/multiloja. A loja participante ainda não foi identificada.
- Canais futuros do MVP: balcão e WhatsApp. Fornecedor, modelo e API do fiscal/maquininha ainda precisam ser levantados.
- Motoristas, veículos e contatos exclusivos de cada organização no primeiro ciclo: direção futura, não funcionalidade.
- Pacote 002 aceito: categorias, produtos, variantes de cor/tamanho, SKU, preço por loja em BRL, pesquisa e capa privada opcional. Fora do escopo: estoque, fornecedores, compras, PDV, pagamentos, fiscal, fretes, WhatsApp operacional e mídias sociais.
- Registro original: `docs/DECISOES_PILOTO.md`.

## Fundação implementada

Na árvore principal: Next.js 16.3.8, React 19, TypeScript e Supabase/PostgreSQL em monólito modular. `app/` concentra rotas/actions, `lib/` integra Supabase, `packages/` separa domínio/validação/UI/configuração; `supabase/` e `tests/` guardam migrações e provas. `mocks/` é só apresentação. Ver `docs/architecture/ARQUITETURA.md`.

Autenticação: `@supabase/ssr`, cookies e `getUser()` no servidor; `proxy.ts` renova a sessão; páginas e Server Actions revalidam acesso. A chave administrativa **não entra no runtime web**. O painel exibe indicadores fictícios identificados; `/demo` é prévia pública sem sessão e sem operação; as demais abas comerciais mostram “Em construção”; sem operação offline.

Identidade e autorização: `auth.users` é identidade autenticável; `profiles`, identidade global; `memberships`, vínculo ativo e papel por organização; `user_store_access`, acesso explícito às lojas; `organizations.id` é a raiz do tenant. RLS e chaves compostas isolam organizações. A seleção de loja e as RPCs do Catálogo são os mutadores expostos com auditoria; cadastro administrativo segue processo próprio. Corretivo 001.1: seletor omite organizações sem lojas ativas autorizadas; vínculo ativo sem loja não autoriza operar; sem qualquer loja, `/sem-acesso`. Cookie de contexto é preferência, nunca fonte de permissão; `requireAccess` usa `React.cache` só na renderização da mesma requisição, e páginas/actions/RLS continuam verificando autorização.

Migração incremental: bloqueia atualizações efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`, inclusive DML administrativo normal; não mover registros entre tenants por `UPDATE`. Auditoria é append-only (ator/origem/antes/depois) e impede `old_value`/`new_value` declarando outro tenant.

## Banco, seed e evidência

As duas migrações H1 `202609070001_foundation.sql` e `202609080001_tenant_key_guards.sql` foram confirmadas em Local e Remote no Supabase descartável. Em 02/10, o Catálogo aplicou `202609300001_catalog.sql`, `202609300002_catalog_storage.sql`, `202609300003_catalog_image_attestation.sql` e a corretiva `202610020001_catalog_service_role_normalization.sql` em `comercio360-dev`; seis versões ficaram alinhadas em Local/Remote. A corretiva dá a `service_role` somente acesso às funções puras necessárias ao DML administrativo, sem leitura da tabela HMAC. Não reaplicar, reescrever nem usar `migration repair`; novos módulos exigem migrações incrementais novas e revisão própria.

`supabase/seed.sql` usa duas organizações e três lojas fictícias; o seed preparou quatro contas `example.test` preservando senhas. `scripts/seed-users.mjs` exige `ALLOW_DEVELOPMENT_SEED=yes`, confirmação independente da URL e domínio exato `example.test`; `scripts/h1-manual.ps1` solicita chave e senha com entrada oculta e emite só resultados sanitizados. Não reexecutar seed por rotina nem inserir credenciais em código, `.env.example`, relatórios ou conversa.

`docs/H1_RESULTADOS.json` registra 36 PASS (login real, expiração/renovação, matriz de acesso, RLS, revogação, chaves estruturais, auditoria, navegador); a primeira tentativa, com 31 PASS e falha composta de expiração, está preservada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`. **Não alterar retroativamente nenhum JSON de evidência.** O ZIP histórico `comercio360-h1.zip` e sua revisão constam de `docs/REVISAO_ARQUITETURAL_H1.md`. O Catálogo acrescenta código, migrações e dependências, sem alterar os JSONs H1.

## Validação e limites de implantação

Depois da correção H1-DEP-01, Vitest e `@vitest/mocker` estão em **4.1.11**. A revisão de 25–26/09 reproduziu `npm ci`, lint, tipos, **90/90 testes**, build, **11/11 E2E** e `npm audit` com zero vulnerabilidades. Testes locais usam PGlite e Auth simulado; a execução hospedada H1 é evidência separada. Esses números são históricos da fundação, não da suíte atual do Catálogo.

Antes de publicar ou usar dados reais, permanecem condições do parecer: (1) validar login, seleção, persistência, renovação, logout e cookies Secure sob **HTTPS da própria aplicação**; (2) definir e ensaiar backup/restauração em ambiente novo, com responsável, retenção, RPO/RTO, Auth, dados e auditoria; (3) separar produção de desenvolvimento, configurar Auth/URLs/segredos por canal seguro e manter provisionamento rastreável; (4) identificar a loja real do piloto. **Atualização 02/10:** o painel confirmou login anônimo e cadastro público desativados, fechando essa condição específica do H1. As demais bloqueiam prontidão para implantação, não a especificação do Pacote 002. Matriz original em `docs/REVISAO_ARQUITETURAL_H1.md`.

## Harness de desenvolvimento por IA

- Manual de replicação: `GUIA_DESENVOLVIMENTO_AGENTES.md`. Plano, perfis e skills: `docs/ai/PLANO_ORQUESTRACAO.md`; contratos/validador em `docs/ai/CONTRATOS_HARNESS.md`; RepoMap em `docs/ai/REPOMAP.md`. Seis skills conferidas.
- H-03 integrado em `4a80096`. H-04 D1/S1 revisados e U1 encerrado no escopo sintético; U1-V1 original segue FAIL Codex / not_run DSH, runner original pendente. Fontes: `docs/ai/RELATORIO_H04.md`, `docs/ai/H04_RESULTADOS_INDICE.md` e `docs/ai/CONTINUACAO_NOVO_CHAT.md`.
- G capturou uma chamada MCP DSH real; suíte harness 16/16 em 02/10. Rota Codex e custo comparável sem sinal. Fontes: `docs/ai/TELEMETRIA_G.md`, `docs/ai/DIAGNOSTICO_TOKENS.md`; histórico MCP em `docs/ai/HISTORICO_DSH.md`. Preserve resultados históricos.

## Roteiro de cada nova tarefa

1. **Leia este `context.md` primeiro.** Confira a data e compare, conforme o tema, com `docs/REVISAO_ARQUITETURAL_H1.md`, `docs/PACOTE_002_CATALOGO_PROPOSTA.md`, `docs/ENTREGA_H1.md`, `docs/H1_RESULTADOS.json`, `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md`. O parecer de 26/09 é a fonte do estado atual da revisão; os JSONs guardam o estado original das execuções.
2. Confira o estado real da pasta, versões e alterações desde a última atualização. Leia `AGENTS.md` e, antes de editar código Next, os guias relevantes em `node_modules/next/dist/docs/`. Para localizar código, use `docs/ai/REPOMAP.md` (regenerando com `npm run repomap` se a árvore mudou). Histórico DSH só por demanda: `docs/ai/HISTORICO_DSH.md`.
3. Delimite o pacote aprovado, dados, permissões, isolamento por tenant, auditoria, migração incremental, interface e critérios de aceite. O Pacote 002 já tem aceite e ADR-0010; novos escopos exigem decisão própria.
4. Implemente e teste apenas o escopo aceito. Para DSH, aplicar CONTRATOS_HARNESS §§7–8: estáticos no worker, dinâmicos pelo executor autorizado, revisão proporcional e retomadas por delta. Reexecutar quando mudança ou evidência exigir, registrando motivo.
5. Atualize este `context.md` no fim de cada mudança significativa: data, pacote/versão, decisões aceitas, arquivos e migrações novos, testes realmente executados, evidências, pendências e próximo passo. Atualize também README, changelog, ADRs e relatório quando afetados. **Não marque PASS sem execução e não reescreva evidências anteriores.** Se este arquivo ultrapassar ~12 KB, mova as entradas mais antigas para o documento de módulo correspondente e deixe aqui o ponteiro; os guardas de segurança das seções finais permanecem fixos.

Comandos locais de referência: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm audit`; `npm run dev` oferece a prévia `/demo`. Os E2E usam as portas 3001 e 54329; no Windows, se o teardown travar, encerrar **somente** auxiliares identificados — nunca processos desconhecidos.

## Regras de segurança da continuidade

Não solicitar nem registrar senha de usuário, chave administrativa, segredo de banco ou JWT pelo chat. `.env.local`, `node_modules`, `.next*`, `.git`, `supabase/.temp` e relatórios de navegador não fazem parte de artefatos limpos. `.env.example` é somente modelo sem credenciais. O acesso administrativo necessário a seed/homologação ocorre no terminal local do operador com entrada oculta. Preservar auditoria e migrações já aplicadas; não usar reset/repair para contornar divergências.

**Estado atual:** H-01 concluída; H-02 parcial; H-03 integrado; H-04 sintético encerrado, runner original pendente; G validou captura DSH real sem custo comparável. Catálogo 002 integrado e testado parcialmente no Supabase real; REST concorrente FAIL HTTP 504, endpoint Next e operação de limpeza completa pendentes. Publicação e dados reais seguem bloqueados pelas condições H1.
