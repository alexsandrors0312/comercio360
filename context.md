# Comércio 360 — contexto permanente de desenvolvimento

**Atualizado em 01/10/2026.** Leia este arquivo **no início de cada tarefa de desenvolvimento**. Atualize estado, evidências e pendências após mudanças relevantes. Este é um **índice**: confira as afirmações no código, migrações, decisões e relatórios; detalhes extensos ficam nos documentos de módulo.

## Estado atual e próximo passo

| Item | Estado conferido |
| --- | --- |
| Aplicação | **0.1.1**: Pacote 001 e corretivo 001.1 concluídos. Fundação executável, sem módulos comerciais operacionais |
| Gate H1 hospedado | **36 PASS / zero FAIL** no Supabase descartável; resultado sanitizado em `docs/H1_RESULTADOS.json` |
| Revisão arquitetural H1 | **Aprovada com condições** em 26/09/2026; parecer em `docs/REVISAO_ARQUITETURAL_H1.md` |
| Pacote 002 | Proposta revisável de Catálogo em `docs/PACOTE_002_CATALOGO_PROPOSTA.md`; **implementação não aprovada** |
| Desenvolvimento por IA | H-03 integrado; H-04 sintético encerrado (D1/S1 e U1). U1-V1 original: FAIL Codex, not_run DSH; patch só nos clones. G: captura real DSH validada; custo comparável indisponível |
| Publicação e dados reais | Ainda não homologados; condições operacionais abertas |

**Próxima ação do harness:** definir telemetria por tarefa da rota Codex, subagentes e custo antes de novos pares ([TELEMETRIA_G.md](docs/ai/TELEMETRIA_G.md)). U1-V5 substitui U1-V1 só em H-04; reparar o runner original à parte. [RELATORIO_H04.md](docs/ai/RELATORIO_H04.md) guarda H-04. Catálogo 002 exige aceite e ADR.

## Produto e decisões já tomadas

- Nome: **Comércio 360**. Nicho inicial: **moda e acessórios**. Piloto planejado para **uma loja**, sem abandonar a arquitetura multiempresa/multiloja. A loja participante ainda não foi identificada.
- Canais futuros do MVP: balcão e WhatsApp. Fornecedor, modelo e API do fiscal/maquininha ainda precisam ser levantados.
- Motoristas, veículos e contatos exclusivos de cada organização no primeiro ciclo: direção futura, não funcionalidade.
- Proposta do Pacote 002: categorias, produtos, variantes de cor/tamanho, SKU, preço por loja em BRL, pesquisa e capa privada opcional — **proposta**, não decisão aceita. Fora do escopo proposto: estoque, fornecedores, compras, PDV, pagamentos, fiscal, fretes, WhatsApp operacional e mídias sociais.
- Registro original: `docs/DECISOES_PILOTO.md`.

## Fundação implementada

Projeto em `C:\Users\Alexs\Desktop\Comercio360`: Next.js **16.3.4**, React 19, TypeScript e Supabase/PostgreSQL em monólito modular. `app/` tem rotas e ações; `lib/` integra Supabase e obtém contexto autorizado; `packages/domain|validation|ui|config` separam regras puras, esquemas, interface e navegação; `supabase/` tem migrações e seed; `tests/` cobre regras, SQL, scripts, navegador e homologação; `mocks/` alimenta apresentação, não autorização. Detalhes de arquitetura em `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md`.

Autenticação: `@supabase/ssr`, cookies e `getUser()` no servidor; `proxy.ts` renova a sessão; páginas e Server Actions revalidam acesso. A chave administrativa **não entra no runtime web**. O painel exibe indicadores fictícios identificados; `/demo` é prévia pública sem sessão e sem operação; abas comerciais “Em construção”; sem operação offline.

Identidade e autorização: `auth.users` é identidade autenticável; `profiles`, identidade global; `memberships`, vínculo ativo e papel por organização; `user_store_access`, acesso explícito às lojas; `organizations.id` é a raiz do tenant. RLS e chaves compostas isolam organizações. O único mutador exposto é `set_active_store`, com auditoria; cadastro administrativo segue processo próprio. Corretivo 001.1: seletor omite organizações sem lojas ativas autorizadas; vínculo ativo sem loja não autoriza operar; sem qualquer loja, `/sem-acesso`. Cookie de contexto é preferência, nunca fonte de permissão; `requireAccess` usa `React.cache` só na renderização da mesma requisição, e páginas/actions/RLS continuam verificando autorização.

Migração incremental: bloqueia atualizações efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`, inclusive DML administrativo normal; não mover registros entre tenants por `UPDATE`. Auditoria é append-only (ator/origem/antes/depois) e impede `old_value`/`new_value` declarando outro tenant.

## Banco, seed e evidência

As **únicas migrações existentes** são `supabase/migrations/202609070001_foundation.sql` e `202609080001_tenant_key_guards.sql`, confirmadas em Local e Remote no Supabase descartável. Não reaplicar, reescrever nem usar `migration repair`; novos módulos exigem migrações incrementais novas e revisão própria. Evidência de alinhamento é da homologação H1.

`supabase/seed.sql` usa duas organizações e três lojas fictícias; o seed preparou quatro contas `example.test` preservando senhas. `scripts/seed-users.mjs` exige `ALLOW_DEVELOPMENT_SEED=yes`, confirmação independente da URL e domínio exato `example.test`; `scripts/h1-manual.ps1` solicita chave e senha com entrada oculta e emite só resultados sanitizados. Não reexecutar seed por rotina nem inserir credenciais em código, `.env.example`, relatórios ou conversa.

`docs/H1_RESULTADOS.json` registra 36 PASS (login real, expiração/renovação, matriz de acesso, RLS, revogação, chaves estruturais, auditoria, navegador); a primeira tentativa, com 31 PASS e falha composta de expiração, está preservada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`. **Não alterar retroativamente nenhum JSON de evidência.** O ZIP congelado `comercio360-h1.zip`, sua integridade de 78 arquivos e os acréscimos documentais desde a revisão constam de `docs/REVISAO_ARQUITETURAL_H1.md`; código, migrações, dependências e evidência H1 permaneceram iguais ao ZIP revisto.

## Validação e limites de implantação

Depois da correção H1-DEP-01, Vitest e `@vitest/mocker` estão em **4.1.11**. A revisão de 25–26/09 reproduziu `npm ci`, lint, tipos, **90/90 testes**, build, **11/11 E2E** e `npm audit` com zero vulnerabilidades. Testes locais usam PGlite e Auth simulado; a execução hospedada H1 é evidência separada. Os testes **não foram reexecutados ao escrever este arquivo**.

Antes de publicar ou usar dados reais, permanecem condições do parecer: (1) o operador **ainda não conferiu** se login anônimo está desativado no painel Supabase; (2) validar login, seleção, persistência, renovação, logout e cookies Secure sob **HTTPS da própria aplicação**; (3) definir e ensaiar backup/restauração em ambiente novo, com responsável, retenção, RPO/RTO, Auth, dados e auditoria; (4) separar produção de desenvolvimento, configurar Auth/URLs/segredos por canal seguro e manter provisionamento rastreável; (5) identificar a loja real do piloto. Essas condições bloqueiam prontidão para implantação, não a especificação do Pacote 002. Matriz completa em `docs/REVISAO_ARQUITETURAL_H1.md`.

## Harness de desenvolvimento por IA

- Manual de replicação (01/10): [GUIA_DESENVOLVIMENTO_AGENTES.md](GUIA_DESENVOLVIMENTO_AGENTES.md), leitura sob demanda. Consolida setup, contratos, A–G e evidências; links/JSONs conferidos, sem nova execução de agentes ou gates de aplicação. Próximo passo do harness permanece o da tabela inicial.
- Plano, topologia e roteamento por risco: `docs/ai/PLANO_ORQUESTRACAO.md`. Seis perfis em `.codex/agents/`, seis skills em `.agents/skills/`; discovery em sessão nova ainda sem observação de economia/qualidade.
- Contratos: `docs/ai/CONTRATOS_HARNESS.md`; validador `scripts/harness/validate.mjs` (14/14 históricos) e `check-skills.mjs` (seis skills). Validador oficial skill-creator pendente por ausência de PyYAML.
- RepoMap: índice estrutural do projeto em `docs/ai/REPOMAP.md`, gerado por `npm run repomap`; regenerar após mudanças estruturais. Leia-o para localizar símbolos em vez de varrer a árvore.
- H-03: piloto de revisão DSH concluído (três achados reproduzidos e corrigidos), integrado em `4a80096`; ver `docs/ai/RELATORIO_H03.md`.
- H-04: protocolo em `docs/ai/AVALIACAO_H04.md`; execução em `docs/ai/RELATORIO_H04.md` (D1/S1 revisados; U1 aceito no gate externo para H-04; runner original pendente); índice dos JSONs em `docs/ai/H04_RESULTADOS_INDICE.md` — ler o índice, não os JSONs inteiros.
- Histórico da integração DSH (ponte MCP, credenciais, READY, timeouts, EPERM, retrabalho): **fonte única** em `docs/ai/HISTORICO_DSH.md`, lido sob demanda, não a cada tarefa.
- Diagnóstico de tokens: `docs/ai/DIAGNOSTICO_TOKENS.md`. A–F aplicadas; G validou captura real DSH em 30/09, com 16/16 testes de harness. Custo comparável ainda indisponível. Fonte: `docs/ai/TELEMETRIA_G.md`.
- Auditoria de `3ccd2d0` e checkpoint: `docs/ai/CONTINUACAO_NOVO_CHAT.md`. Os 8 hashes históricos conferem; regras A–F ajustadas. Na retomada U1 houve tsc, diff e Playwright externo no clone; nenhum gate da aplicação principal foi reexecutado.

## Roteiro de cada nova tarefa

1. **Leia este `context.md` primeiro.** Confira a data e compare, conforme o tema, com `docs/REVISAO_ARQUITETURAL_H1.md`, `docs/PACOTE_002_CATALOGO_PROPOSTA.md`, `docs/ENTREGA_H1.md`, `docs/H1_RESULTADOS.json`, `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md`. O parecer de 26/09 é a fonte do estado atual da revisão; os JSONs guardam o estado original das execuções.
2. Confira o estado real da pasta, versões e alterações desde a última atualização. Leia `AGENTS.md` e, antes de editar código Next, os guias relevantes em `node_modules/next/dist/docs/`. Para localizar código, use `docs/ai/REPOMAP.md` (regenerando com `npm run repomap` se a árvore mudou). Histórico DSH só por demanda: `docs/ai/HISTORICO_DSH.md`.
3. Delimite o pacote aprovado, dados, permissões, isolamento por tenant, auditoria, migração incremental, interface e critérios de aceite. Para o Pacote 002, obtenha o aceite e registre ADR antes de codificar.
4. Implemente e teste apenas o escopo aceito. Para DSH, aplicar CONTRATOS_HARNESS §§7–8: estáticos no worker, dinâmicos pelo executor autorizado, revisão proporcional e retomadas por delta. Reexecutar quando mudança ou evidência exigir, registrando motivo.
5. Atualize este `context.md` no fim de cada mudança significativa: data, pacote/versão, decisões aceitas, arquivos e migrações novos, testes realmente executados, evidências, pendências e próximo passo. Atualize também README, changelog, ADRs e relatório quando afetados. **Não marque PASS sem execução e não reescreva evidências anteriores.** Se este arquivo ultrapassar ~12 KB, mova as entradas mais antigas para o documento de módulo correspondente e deixe aqui o ponteiro; os guardas de segurança das seções finais permanecem fixos.

Comandos locais de referência: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm audit`; `npm run dev` oferece a prévia `/demo`. Os E2E usam as portas 3001 e 54329; no Windows, se o teardown travar, encerrar **somente** auxiliares identificados — nunca processos desconhecidos.

## Regras de segurança da continuidade

Não solicitar nem registrar senha de usuário, chave administrativa, segredo de banco ou JWT pelo chat. `.env.local`, `node_modules`, `.next*`, `.git`, `supabase/.temp` e relatórios de navegador não fazem parte de artefatos limpos. `.env.example` é somente modelo sem credenciais. O acesso administrativo necessário a seed/homologação ocorre no terminal local do operador com entrada oculta. Preservar auditoria e migrações já aplicadas; não usar reset/repair para contornar divergências.

**Estado do harness:** H-01 concluída; H-02 parcial; H-03 integrado; H-04 sintético encerrado, runner original pendente. G instalada; sem sinal de custo. Checkpoint no arquivo de continuação acima.
