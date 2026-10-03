# Catálogo 002 — corretivo REST e ensaio hospedado de 03/10/2026

**Ambiente:** `comercio360-dev`, referência pública `qiwblpmocldqbijbylwg`. A URL vinculada pelo CLI foi conferida antes de cada escrita. Este é um projeto de desenvolvimento com fixtures `example.test`, não uma homologação de produção. O [resultado de 02/10](CATALOGO_002_HOSPEDADO.md) e seus FAIL permanecem históricos.

## Falha e corretivo

Nas três disputas REST de 02/10, uma RPC concluiu e a outra recebeu HTTP 504. A [nota oficial do Supabase sobre `40001` customizado](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) explica que o PostgREST 14 trata esse SQLSTATE como falha temporária e pode repetir a transação indefinidamente. **Inferência apoiada nas fontes e na reprodução:** os sete `raise exception` de conflito de revisão/idempotência no Catálogo eram a causa do 504 observado; a resposta antiga não trouxe código SQL nem logs do gateway para confirmar sua cadeia interna exata.

A migração incremental `202610030001_catalog_conflict_http.sql` troca somente esses sete erros artificiais por `PT409` nas seis RPCs afetadas. A comparação automatizada dos corpos SQL confirmou igualdade com a migração original após normalizar apenas `CREATE OR REPLACE` e `40001`→`PT409`. Propriedade e grants existentes são preservados. Server Actions e rota de imagem reconhecem `PT409`; `40001` nativo deixa de ser tratado como conflito de negócio. O [PostgREST documenta `PT` para status HTTP customizado](https://postgrest.org/en/stable/references/errors.html#custom-errors).

O dry-run listou somente a migração 005 do Catálogo; a revisão estática independente não apontou bloqueio para aplicá-la. `db push --linked` e `migration list --linked` confirmaram sete versões Local/Remote alinhadas. A tentativa DSH usada para iniciar o corretivo terminou em **timeout de 600 s**, com uso/custo indisponível; tarefa e telemetria estão em [evidências do harness](ai/evidencias/catalogo-002-rest-2026-10-03/). O código parcial foi revisado e concluído pelo orquestrador. O retorno final do revisor de scripts falhou por limite de créditos, após mensagens estáticas sem bloqueios; não há parecer formal completo desse revisor.

## Gates executados

| Gate | Resultado | Evidência |
| --- | --- | --- |
| Concorrência REST com duas sessões reais | **PASS** | Uma RPC `catalog_update_product` retornou HTTP 200 e a outra `PT409`/HTTP 409 em **97 ms** na [tentativa final](CATALOGO_002_HOSPEDADO_2026-10-03T23-02-30-515Z.json). Revisão cresceu uma vez e o nome do vencedor permaneceu. Nova chamada com revisão antiga também retornou 409. |
| Auth, Storage e capa privada diretos | **PASS** | Reserva, upload, HMAC, URL assinada, substituição e revogação de vínculo permaneceram aprovados no mesmo ensaio. |
| Rota Next local com Supabase hospedado | **PASS** | Cookies SSR de usuário real; origem externa e arquivo falso negados; JPEG reencodado sem EXIF no Storage real; capa lida, conflito 409, revalidação de papel/vínculo, remoção e 404. Next recebeu somente URL/chave pública e chave HMAC temporária, sem credencial administrativa. |
| Worker administrativo no projeto real | **PASS direcionado** | Uma fixture `cleanup_pending` vencida foi removida; uma `deleting` já ausente foi finalizada; `claimed=2 deleted=2 failed=0`. Objeto ativo e registros recentes permaneceram. As datas antigas pertencem somente às fixtures criadas para o ensaio. |
| Limpeza após o ensaio | **PASS** | [Consulta pós-limpeza](CATALOGO_002_HOSPEDADO_POS_LIMPEZA_2026-10-03T23-02-57Z.json): zero usuários/produtos temporários, objetos no bucket, linhas de ledger e chaves HMAC. Auditoria append-only permanece. |
| Código combinado | **PASS** | Vitest **124/124**, lint saída 0 com aviso histórico H-04, tipos e build Next 16.3.8. E2E Chromium **17/17** passou antes do ajuste de origem; o próprio endpoint alterado foi ensaiado depois com Auth/Storage hospedados. |

As tentativas de 03/10 [1](CATALOGO_002_HOSPEDADO_2026-10-03T22-56-21-530Z.json), [2](CATALOGO_002_HOSPEDADO_2026-10-03T22-58-00-779Z.json) e [3](CATALOGO_002_HOSPEDADO_2026-10-03T22-59-26-787Z.json) preservam **FAIL** na checagem de origem da rota Next. O GET autenticado passou, mas o POST recebeu 403 quando o `Request.url` interno do Next usou host diferente do `Host` recebido. `isSameOrigin` passou a comparar o protocolo e o `Host` recebidos, com testes locais para host e esquema divergentes. Cada tentativa limpou as fixtures e tem sua própria [consulta 1](CATALOGO_002_HOSPEDADO_POS_LIMPEZA_2026-10-03T22-56-54Z.json), [2](CATALOGO_002_HOSPEDADO_POS_LIMPEZA_2026-10-03T22-58-22Z.json) e [3](CATALOGO_002_HOSPEDADO_POS_LIMPEZA_2026-10-03T22-59-47Z.json). Elas não foram convertidas retroativamente em PASS.

O relatório final tem **20 PASS / zero FAIL**. Ele guarda nomes fixos de testes, status, duração/códigos HTTP sanitizados e hashes dos arquivos executados. Não contém senha, token, HMAC, caminho de objeto, URL assinada nem resposta bruta do provedor. O CLI permanece autenticado por decisão expressa do responsável em 03/10; nenhum valor de token entrou no repositório.

## Pendências de implantação

- O Next foi iniciado em **HTTP local** com Auth, banco e Storage **hospedados**. Cookies Secure e login sob HTTPS da aplicação publicada seguem `not_run`.
- A chave HMAC temporária foi removida. Operação contínua de capas exige provisionamento seguro da mesma chave no banco e runtime publicado.
- O worker removeu fixtures vencidas e retomou uma ausência já marcada `deleting`. Injeção de erro real de Storage, observação de retries ao longo do tempo e agendamento continuam `not_run`.
- Backup/restauração, separação produção/desenvolvimento e loja piloto real permanecem condições H1. Não usar dados reais nem declarar prontidão de produção por este ensaio.

Para repetir no projeto descartável, conferir as sete migrações, bucket e ledger vazios, e executar `pwsh -NoProfile -File scripts/catalog-hosted.ps1 -ConfirmProjectUrl https://qiwblpmocldqbijbylwg.supabase.co -Extended` em terminal local sem transcrição. O roteiro remove conta, arquivos e HMAC temporários e grava contagens pós-limpeza; se falhar, inspecionar a evidência antes de tentar novamente.
