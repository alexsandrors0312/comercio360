# Catálogo 002 — verificação no Supabase hospedado

**Data:** 02/10/2026. **Projeto de desenvolvimento:** `comercio360-dev`, ref público `qiwblpmocldqbijbylwg`, organização `Lado D`. O painel, `supabase/.temp/project-ref` e o CLI apontaram para o mesmo projeto. Não usar estes resultados como aprovação de produção.

## Migrações e correção encontrada

O histórico remoto continha apenas `202609070001_foundation` e `202609080001_tenant_key_guards`. `supabase db push --linked --dry-run` listou somente as três migrações locais do Catálogo; `db push --linked` as aplicou e `migration list --linked` confirmou Local/Remote alinhados. Bucket `catalog-private`: privado, limite 5 MB, MIME JPEG/PNG/WebP e duas políticas, conferidos no painel e no banco.

O primeiro teste HTTP expôs uma falha que o PGlite anterior não cobria: `service_role` não podia executar funções de normalização em `private` durante DML administrativo. A inserção de produto retornou `42501 permission denied for schema private`. A migração incremental `202610020001_catalog_service_role_normalization.sql` concede `USAGE` no esquema e `EXECUTE` apenas às quatro funções puras usadas por triggers/constraints. Um teste PGlite com `SET ROLE service_role` e a repetição hospedada de `INSERT ... ROLLBACK` passaram. `service_role` continuou sem `SELECT` em `private.catalog_image_attestation_key`. O dry-run posterior listou somente a migração corretiva; ela foi aplicada e as **seis versões** ficaram registradas remotamente. Nenhum histórico foi reparado ou reescrito.

Após a correção: `npm test -- --maxWorkers=2` passou **121/121**, lint saiu 0 com um aviso no arquivo histórico H-04 e `npm run typecheck` passou. Uma execução do Vitest em paralelo com lint/tipos ficou sem memória após 108 testes; a repetição isolada com dois workers encerrou sem erro. Build e E2E da árvore combinada pertencem ao checkpoint local anterior, pois nenhum código Next mudou neste corretivo.

## Resultados executados

| Verificação | Resultado | Evidência e limite |
| --- | --- | --- |
| RLS por papel e tenant no PostgreSQL remoto | **PASS** | Gerente Aurora: ler/escrever A, negar B; caixa: ler A, negar escrita/B; sem vínculo: negar A. Consultas `SET LOCAL ROLE authenticated` com JWT claim fictícia e `ROLLBACK`. |
| RPCs de Catálogo, preço, busca e auditoria | **PASS** | `tests/hosted/catalog-rollback.sql`: criação, BRL `79,90`, visibilidade, busca e auditoria; cinco indicadores `true`; `ROLLBACK` confirmado sem resíduos. |
| Política real de `storage.objects` | **PASS** | Mesmo SQL: caminho reservado aceito, caminho não reservado rejeitado, objeto reservado invisível. Sete indicadores `true`; metadados revertidos. |
| Storage HTTP e capa privada | **PASS** | Conta fictícia temporária: upload reservado, negação de leitura/URL antes da atestação, HMAC, vínculo, leitura por URL assinada, rota pública negada, substituição, revogação de vínculo em sessão aberta e revogação de nova URL após retirar capa. [Tentativa 04](CATALOGO_002_HOSPEDADO_TENTATIVA_04.json) e [tentativa 07](CATALOGO_002_HOSPEDADO_TENTATIVA_07.json). |
| Concorrência CAS diretamente no PostgreSQL remoto | **PASS** | Duas chamadas SQL independentes disputaram revisão 1 do mesmo produto: uma retornou revisão 2 e a outra SQLSTATE `40001`; produto temporário removido. |
| Concorrência simultânea pelo REST/PostgREST | **FAIL / diagnóstico aberto** | Uma chamada `catalog_update_product` concluiu; a outra recebeu HTTP **504** após cerca de dois minutos, sem código SQL. Ocorreu nas [tentativas 05](CATALOGO_002_HOSPEDADO_TENTATIVA_05.json), [06](CATALOGO_002_HOSPEDADO_TENTATIVA_06.json) e [07](CATALOGO_002_HOSPEDADO_TENTATIVA_07.json). Uma atualização autenticada isolada passou. O teste não demonstrou resposta de conflito pelo caminho REST; investigar logs/pool antes de declarar este gate aprovado. |
| Worker de limpeza no projeto real | **PASS limitado** | Preflight leu zero linhas no ledger e zero elegíveis; `scripts/catalog-image-cleanup.mjs` concluiu `claimed=0 deleted=0 failed=0`. Exclusão/retry de objeto antigo e agendamento continuam `not_run`. |
| Auth do projeto | **PASS de configuração** | Painel: cadastro público desativado, login anônimo desativado e e-mail habilitado. Essa leitura fecha a condição específica de login anônimo do H1; não substitui teste HTTPS da aplicação. |
| Limpeza das fixtures e segredos de teste | **PASS** | [Consulta final sanitizada](CATALOGO_002_HOSPEDADO_POS_LIMPEZA.json): zero contas `catalog.hosted.*@example.test`, produtos de teste, objetos no bucket, linhas no ledger de imagens e linhas na tabela de chave HMAC. Auditoria append-only permanece. |

O HTTP 504 é uma observação do gateway, sem causa raiz estabelecida. A [documentação oficial de erros REST](https://supabase.com/docs/guides/api/rest/postgrest-error-codes) descreve 504 também em esperas por conexão do pool, mas não há código `PGRST003` nesta resposta; atribuir esta falha ao pool seria inferência não comprovada. O CAS do banco passou por conexão direta de gerenciamento, prova distinta da rota REST.

As [tentativas 01](CATALOGO_002_HOSPEDADO_TENTATIVA_01.json) e [02](CATALOGO_002_HOSPEDADO_TENTATIVA_02.json) preservam a falha administrativa original; a [tentativa 03](CATALOGO_002_HOSPEDADO_TENTATIVA_03.json) registra o primeiro fluxo HTTP aprovado. Todos os JSONs contêm só nomes fixos e PASS/FAIL, sem senha, token, chave, caminho de objeto ou resposta bruta. A conta de teste, a senha gerada e a chave HMAC existiram apenas durante cada execução; a chave administrativa ficou no processo de homologação, fora do runtime Next e do repositório.

## Limites restantes

- O endpoint Next `/api/catalog/images/[productId]` não foi executado contra o projeto hospedado; o teste de imagem usou Auth, Storage e RPCs reais diretamente. Decodificação/reencodificação e multipart seguem evidência local.
- A chave HMAC foi removida após o teste. Capas no runtime publicado dependem de provisionamento permanente por canal seguro, em banco e ambiente Next.
- Limpeza de objetos vencidos, retries e agendamento do worker ainda exigem ensaio operacional. O teste com fila vazia comprova conexão e guardas, não remoção.
- HTTPS da aplicação, cookies Secure, backup/restauração e separação produção/desenvolvimento permanecem condições H1 antes de dados reais.
- Investigar o HTTP 504 no REST durante disputa concorrente. Não classificar o Catálogo como completamente homologado até reproduzir um conflito REST observável ou documentar o limite de plataforma com logs.

Para repetir: usar o [roteiro SQL reversível](../tests/hosted/catalog-rollback.sql) pelo CLI vinculado e `pwsh -NoProfile -File scripts/catalog-hosted.ps1 -ConfirmProjectUrl https://qiwblpmocldqbijbylwg.supabase.co` em terminal local sem transcrição. O segundo roteiro cria/remove usuário e HMAC temporários e grava evidência sanitizada com nome datado. Conferir previamente o destino e o ledger; não executar em produção. A implantação de migrações segue o [fluxo oficial de histórico do Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

Após revisão independente do roteiro, a limpeza foi ajustada para concluir as remoções no Storage antes de apagar produto, ledger e usuário. Se a remoção falhar, o roteiro preserva essas referências para repetição segura, tenta revogar o vínculo, informa quando essa revogação não foi confirmada e grava **FAIL**. Nesse caso, conferir e limpar as fixtures manualmente antes de nova execução; a confirmação de zero resíduos acima pertence às tentativas já executadas. Essa correção de proteção foi verificada estaticamente e ainda não passou por nova execução hospedada.
