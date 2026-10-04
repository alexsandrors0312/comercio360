# Images binding: ensaio remoto isolado

**Data:** 04/10/2026 (America/Sao_Paulo). **Ambiente:** `wrangler@4.147.0 dev --remote`, binding `IMAGES` autenticado no Cloudflare; Worker de probe temporário em `127.0.0.1:8787`. A sessão foi encerrada após o ensaio. O Worker da aplicação e o Supabase Storage não participaram desta prova.

## Resultado observado

O runner `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON workers/image-probe/run-probe.mjs http://127.0.0.1:8787/probe` retornou código 0, **8/8 PASS**:

| Caso | Resultado |
| --- | --- |
| JPEG com EXIF e orientação 6 | 200; 32×48; EXIF ausente; quadrantes confirmam rotação visual |
| PNG com EXIF, XMP, ICC, tEXt, iTXt, zTXt | 200; 48×32; metadados privados ausentes |
| WebP com EXIF, XMP, ICC | 200; 48×32; metadados privados ausentes |
| APNG com dois quadros | 415, rejeitado antes da transformação |
| WebP com dois quadros | 415, rejeitado antes da transformação |
| PNG com 10.001 px em um eixo | 422 |
| JPEG truncado | 415 |
| Entrada com 5 MB + 1 byte | 413 |

O Worker de probe importou o mesmo `processCatalogImageCloudflare` destinado à rota. O código reencoda pelo binding, remove estruturalmente segmentos APP/COM de JPEG, dados auxiliares privados de PNG e chunks EXIF/XMP/ICC de WebP; valida formato, limites e decodificação da saída sanitizada. O binding preservou EXIF no JPEG em tentativa anterior com e sem o parâmetro não documentado `metadata: "none"`, justificando a sanitização explícita. Nenhuma imagem ou credencial foi salva no relatório.

**Gates locais após a mudança:** 16/16 testes direcionados, `npm run typecheck` e `npm run lint` concluíram; lint emitiu apenas o aviso histórico de H-04 em `playwright-u1-external.config.mjs`.

## Limites desta evidência

O ensaio isolado prova comportamento de oito fixtures sintéticas. Ainda são necessários revisão independente do parser e teste de upload/leitura/remoção com Auth, RLS, Storage privado e HTTPS do Worker da aplicação. Erro de cota `9422` é tratado como indisponibilidade (503), sem armazenar bytes de origem. A [documentação oficial do binding](https://developers.cloudflare.com/images/optimization/binding/) descreve `info`, `output` e o desenvolvimento remoto; a [tabela de erros oficial](https://developers.cloudflare.com/images/reference/troubleshooting/) descreve o limite gratuito `9422`.
