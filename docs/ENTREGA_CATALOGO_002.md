# Entrega local — Pacote 002 Catálogo

Data: 01/10/2026. Branch `codex/catalogo-002`, worktree isolado criado a partir de `3ccd2d0`. O responsável aceitou integralmente `PACOTE_002_CATALOGO_PROPOSTA.md` em 30/09/2026. Esta entrega é código e verificação **local**; não houve migração, seed, provisionamento de segredo, limpeza ou publicação em Supabase hospedado.

## Escopo entregue

- Categorias e produtos comuns à organização, variantes com SKU e código de barras opcional, preço decimal em BRL por loja, busca/paginação/filtros e desativação sem exclusão física.
- `/app/produtos` com consulta para papéis autorizados, edição para proprietário/gerente, estados de erro/conflito, detalhes, formulários e capa privada opcional. A área pública `/demo` permanece fictícia.
- `packages/domain/catalog.ts` e `packages/validation/catalog.ts`: normalização, preço, schemas e limites.
- `202609300001_catalog.sql`: tabelas, FKs compostas, constraints, RLS, RPCs transacionais, idempotência, revisão concorrente e auditoria. `202609300002_catalog_storage.sql`: bucket privado e políticas de objeto. `202609300003_catalog_image_attestation.sql`: atestação HMAC do upload, sem segredo embutido.
- `lib/catalog/server.ts`, `app/actions/catalog.ts` e rota `/api/catalog/images/[productId]`: sessão atual, escopo de organização/loja, validação e upload de imagem decodificada/reencodada. `scripts/catalog-image-cleanup.mjs` é manutenção administrativa separada.

## Evidência executada nesta branch

| Gate | Resultado local |
| --- | --- |
| `npm run lint` | PASS, saída 0 |
| `npm run typecheck` | PASS, saída 0 |
| `npm test` | PASS, 13 arquivos / **120 testes** |
| `npm run build` | PASS, Next 16.3.8; rotas dinâmicas de Catálogo geradas |
| `npm run test:e2e` | PASS, **17/17** em Chromium, incluindo 6 cenários de Catálogo e regressões da fundação |
| `npm run repomap` | PASS, índice estrutural atualizado |
| `npm run test:harness` | PASS, 14/14 e seis skills do projeto |
| `npm audit` | PASS, zero vulnerabilidades após atualizar Next/eslint-config-next para 16.3.8 e corrigir `brace-expansion` no lockfile |
| Revisão independente `CAT-002-SEC-02` | `no_blocking_findings` estático após correções; sem P0–P2 detectado |

Os testes SQL executam as migrações em PGlite com papéis/RLS e cenários de tenant, loja, CAS, auditoria, idempotência, atestação e limpeza. O E2E usa Next e um servidor HTTP de contrato com PGlite; não comprova o Auth/Storage hospedado. A revisão independente identificou três pontos corrigidos antes deste fechamento: limite real de multipart, vínculo de capa em produto inativo e limpeza de órfãos. A aresta P3 de chave idempotente no formulário também foi corrigida: retry idêntico preserva a chave; mudança de payload gera outra.

Uma auditoria após os primeiros gates encontrou o [aviso crítico de `next/og`](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) para Next 16.3.4. Esta aplicação não usa `ImageResponse`, mas a dependência foi atualizada para 16.3.8. `npm audit fix` corrigiu em seguida um alerta alto de `brace-expansion` nas dependências de desenvolvimento; a auditoria completa terminou com zero vulnerabilidades. Os gates de código foram repetidos após essa atualização.

## Limites e operação seguinte

| Etapa | Estado |
| --- | --- |
| Aplicar as três migrações em projeto Supabase descartável identificado | `not_run` |
| Provisionar a mesma chave aleatória de 32 bytes em `private.catalog_image_attestation_key.secret` e `CATALOG_IMAGE_ATTESTATION_KEY` (base64), por canal seguro | `not_run` |
| Exercitar upload, substituição, URL assinada, revogação e políticas no Storage real | `not_run` |
| Executar/agendar limpeza administrativa e observar falhas/retries no ambiente hospedado | `not_run` |
| Concorrência simultânea de múltiplas sessões contra PostgreSQL hospedado | `not_run` |
| Publicação e uso de dados reais | `not_run`; seguem as condições H1 |

A migração 003 deixa a tabela de chave vazia; o POST de capa devolve 503 até provisionamento. O segredo nunca deve entrar em Git, `.env.example`, parâmetro público ou conversa. A manutenção exige `ALLOW_CATALOG_IMAGE_CLEANUP=yes`, URL do projeto, `CONFIRM_SUPABASE_PROJECT_URL` conferida separadamente e `SUPABASE_SECRET_KEY` temporária fora do runtime web; a rotina só reivindica objetos elegíveis após duas horas. É necessário identificar o projeto descartável e planejar sua homologação antes de afirmar prontidão de capa. Os **36 PASS** hospedados em `H1_RESULTADOS.json` pertencem apenas à fundação H1 e não foram ampliados por esta entrega.

## Integração na árvore principal — 02/10/2026

O checkpoint H-04/G foi preservado em commit próprio antes da mescla do Catálogo. Os conflitos em `context.md` e `docs/ai/REPOMAP.md` foram resolvidos mantendo as evidências históricas e regenerando o índice estrutural (72 arquivos, 422 símbolos). Um teste de telemetria usava a variável `module`, rejeitada pela regra de lint do Next 16.3.8; ela foi renomeada sem mudar a lógica do teste.

Gates executados **na árvore principal combinada**: `npm ci` (zero vulnerabilidades), lint (saída 0; um aviso em arquivo histórico de evidência), tipos, `npm test` **120/120**, `npm run test:harness` **16/16** com seis skills, build Next 16.3.8 e E2E Chromium **17/17**. A homologação Supabase/Storage real segue `not_run`: não há URL/ID de projeto descartável nem sessão autenticada disponível neste ambiente até o operador entrar no painel. Nenhum segredo foi registrado no repositório.

## Homologação hospedada parcial — 02/10/2026

O operador abriu `comercio360-dev` no painel; a referência pública conferida é `qiwblpmocldqbijbylwg`, a mesma do H1. As três migrações do Catálogo foram aplicadas via CLI após dry-run e alinhamento H1 Local/Remote. O teste HTTP revelou falta de permissão de `service_role` para as funções puras de normalização usadas em DML administrativo. A nova migração incremental `202610020001_catalog_service_role_normalization.sql` e teste PGlite corrigiram o caso; o histórico remoto agora contém seis versões alinhadas. A tabela HMAC privada continua sem `SELECT` para `service_role`.

Auth/Storage/RPC hospedados passaram com conta e chave temporárias: upload reservado, negação antes de atestar, HMAC, capa ativa, URL assinada, substituição e revogação de vínculo. O SQL hospedado passou nos testes de papel/tenant, preço, busca, auditoria, política de objeto e disputa CAS em duas conexões. O worker de limpeza executou com fila comprovadamente vazia (`claimed=0 deleted=0 failed=0`). Após o ensaio: zero contas/produtos/objetos de teste e zero chaves HMAC persistidas. O painel confirmou cadastro público e login anônimo desativados.

**Gate ainda aberto:** na disputa simultânea via REST, um RPC terminou e o outro recebeu HTTP 504 sem SQLSTATE; as tentativas foram preservadas como **FAIL**. O CAS direto no PostgreSQL devolveu a revisão vencedora e `40001` para a perdedora. O endpoint Next de capa, a remoção/retry real de objetos envelhecidos, o agendamento e HTTPS da aplicação seguem `not_run`. Evidências, limites e reprodução estão em [CATALOGO_002_HOSPEDADO.md](CATALOGO_002_HOSPEDADO.md). O Catálogo não recebe aprovação integral de homologação ou produção por este resultado.

## Corretivo REST e ensaio ampliado — 03/10/2026

A falha HTTP 504 foi ligada aos `40001` artificiais de conflito nas RPCs, que o PostgREST 14 pode repetir. A migração incremental `202610030001_catalog_conflict_http.sql` troca esses sete erros por `PT409`, preservando corpo, CAS, locks, escopo, auditoria e grants das seis RPCs. Com duas sessões reais, REST retornou HTTP **200/409 em 97 ms** e conservou somente a atualização vencedora. As tentativas de 02/10 continuam FAIL histórico.

A rota Next local usou cookies SSR e Auth/Storage hospedados; após corrigir a comparação de origem ao `Host` recebido, passaram upload reencodado sem EXIF, capa privada, revogação, conflito e remoção. O worker removeu uma fixture vencida, retomou outra já ausente e preservou ativo/recente. O último ensaio produziu **20 PASS / zero FAIL** e contagens finais zero para fixtures e HMAC. Vitest **124/124**, lint, tipos e build passaram; E2E **17/17** terminou antes do ajuste de origem, que foi coberto no ensaio HTTP posterior. O [relatório de 03/10](CATALOGO_002_HOSPEDADO_2026-10-03.md) preserva três tentativas FAIL do endpoint e os limites restantes: HTTPS publicado, chave operacional, agendamento/retry sob falha real, backup/restauração e separação de produção.
