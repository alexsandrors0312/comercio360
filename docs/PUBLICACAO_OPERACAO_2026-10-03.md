# Publicação e operação — gate iniciado em 03/10/2026 (atualizado em 04/10)

Este registro acompanha HTTPS, chave HMAC e limpeza agendada do Catálogo 002. **A homologação Cloudflare foi publicada; dados reais não estão autorizados.** O [ensaio hospedado de 03/10](CATALOGO_002_HOSPEDADO_2026-10-03.md) usou Next em HTTP local; a [prova HTTPS de 04/10](CLOUDFLARE_HTTPS_2026-10-04.md) usou o Worker publicado e Supabase dev com fixtures temporárias.

## Destinos e evidências pendentes

| Critério | Estado em 03/10 | Evidência exigida para fechar |
| --- | --- | --- |
| Plataforma e URL HTTPS do Next | Build `#9a188a00` publicou `9695ffd`; `/login` HTTPS 200. HTTP de página, asset e POST retornou 308 para HTTPS, preservando path/query. | Repetir no domínio próprio quando definido |
| Repositório ligado ao build | GitHub `alexsandrors0312/comercio360`, branch `main`, hash `9695ffdea27707ea97c823b253fd33ef9a4b6020`, comandos OpenNext versionados; build `#9a188a00` PASS. O clone `#bf9bcc96` permanece FAIL histórico. | Acompanhar builds futuros e hash publicado |
| Runtime Cloudflare | Probe inicial **FAIL** por EXIF retido; adaptador corrigido JPEG/PNG/WebP passou **8/8** remoto. **143/143** testes, lint, tipos, build Next local e build OpenNext Linux PASS. Upload JPEG/Storage/HMAC e leitura privada passaram no Worker publicado. | Testar variantes maiores/perfis ICC não sRGB e cota 9422 quando houver demanda; Pages estático não cobre a aplicação |
| Sessão no domínio publicado | Login, seleção de loja, persistência após recarga, cookies Auth/contexto `Secure`, logout e bloqueio após logout **PASS** com conta fictícia em HTTPS. | Renovação natural após expiração ainda `not_run` no Cloudflare |
| Chave HMAC operacional | Chave 32 bytes no banco dev e secret apenas no Worker web; desafio consistente. Upload JPEG autenticado, atestado e lido do Storage privado sob HTTPS **PASS**; fixture removida. | Monitorar rotação e separar chave futura de produção |
| Worker agendado | Worker separado `comercio360-catalog-cleanup-dev` publicado em 04/10, versão `989ad952-c9d0-46a4-bb75-aab3a4a29590`, agenda `*/15 * * * *` e secret administrativo listado só nele. Teto 16 por limite Workers Free; revisão independente sem bloqueio estático; 5/5 testes e dry-run passaram. Observability mostrou **8 Success, 0 Errors** na última hora às 18h11 BRT; eventos às 17h15, 17h30, 17h45 e 18h00 BRT; último com `outcome=ok`, CPU 1 ms, wall 977 ms. Primeira execução tinha `claimed=0 deleted=0 failed=0` no log do tail. | Falha transitória e retry remoto ainda `not_run`; observar contagens de backlog após upload HTTPS |
| Produção isolada | `not_run`; o único projeto identificado nos ensaios é `comercio360-dev` | Projeto de produção distinto, sete migrações alinhadas, Auth/URLs/restrições e segredos conferidos por ambiente |
| Backup e restauração | `not_run` | Responsável, retenção, RPO/RTO aceitos; backup do banco e dos objetos privados; restauração testada em projeto novo, verificando Auth, dados, auditoria, isolamento e leitura de capa |
| Piloto com dados reais | `not_run` | Loja participante identificada e aceite operacional do fluxo; sem reutilizar seed fictício |

## Separação de credenciais

O runtime web recebe apenas URL e chave **públicas** do Supabase e `CATALOG_IMAGE_ATTESTATION_KEY` por canal de segredo. A chave `SUPABASE_SECRET_KEY` fica somente no executor administrativo do worker; nunca no processo Next. A tabela `private.catalog_image_attestation_key` não é exposta ao cliente. Cada ambiente exige seus próprios valores. O token CLI autorizado pelo responsável permanece fora do repositório e da publicação.

O operador deve registrar quem executou, projeto de destino, motivo, versão e resultado de cada provisionamento administrativo, sem copiar segredo, JWT ou resposta bruta para a evidência. Configurar `DEMO_ENABLED=false` para uma instância destinada ao piloto, após aprovação da finalidade pública da demonstração.

## Recuperação antes de dados reais

A [documentação de backups do Supabase](https://supabase.com/docs/guides/platform/backups) informa que backups de banco **não incluem os bytes do Storage** e recomenda exportação periódica fora da plataforma no plano gratuito. O [restore para novo projeto](https://supabase.com/docs/guides/platform/clone-project) copia banco e Auth, mas requer reconfigurar Storage, Auth/API e outras opções; esse fluxo é restrito a planos pagos. Portanto, uma cópia SQL ou um botão de restore, isoladamente, não fecha o gate deste produto com capas privadas.

O ensaio de recuperação deverá usar um projeto descartável novo, sem dados reais: produzir backup do banco e cópia dos objetos, restaurar, reconfigurar Auth e segredo HMAC, e conferir migrações, login, RLS entre tenants, auditoria append-only, produto/preço e capa. Registrar tempos observados; só depois definir RPO/RTO e retenção aceitos pelo responsável. O banco de desenvolvimento não deve ser apagado ou restaurado sobre si mesmo para simular esse ensaio.

## Sequência de publicação

1. Confirmar o projeto Cloudflare, repositório Git e se a primeira instância é homologação ou produção; preparar projeto Supabase correspondente.
2. Revisar o diff integrado, executar lint, tipos, testes, build e testes direcionados, preservando resultados FAIL históricos.
3. Provisionar variáveis públicas, HMAC e executor do worker em canais separados; conferir projeto e URL antes de escrita.
4. Publicar o Next em HTTPS e executar a matriz de sessão e capa no domínio real com conta fictícia.
5. Ativar e observar o agendamento do worker; provocar uma falha recuperável controlada e verificar retry sem perda de objeto ativo.
6. Fechar recuperação, separação de produção e loja piloto antes de liberar dados reais. Registrar o parecer final com evidências e limitações.
