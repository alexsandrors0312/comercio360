# Publicação e operação — gate iniciado em 03/10/2026

Este registro acompanha a preparação de HTTPS, chave HMAC e limpeza agendada do Catálogo 002. **Não declara publicação nem autoriza dados reais.** O [ensaio hospedado de 03/10](CATALOGO_002_HOSPEDADO_2026-10-03.md) usou Next em HTTP local e Supabase de desenvolvimento com fixtures temporárias.

## Destinos e evidências pendentes

| Critério | Estado em 03/10 | Evidência exigida para fechar |
| --- | --- | --- |
| Plataforma e URL HTTPS do Next | Cloudflare escolhida pelo responsável; nome do Worker e URL final ainda não identificados. O checkout não tem Git remote | Worker publicado identificado; TLS válido e redirecionamento HTTP→HTTPS |
| Repositório ligado ao build | Build `#bf9bcc96` falhou ao buscar o repositório, antes do build. O repositório GitHub `alexsandrors0312/comercio360` está público, **vazio e sem branch padrão**; falta confirmar que é o vínculo desse build | Vínculo Cloudflare↔Git conferido, acesso SCM válido, branch com o commit do projeto e clone concluído |
| Runtime Cloudflare | `not_run`; aplicação tem SSR, Server Actions, proxy e rota que reencoda imagem com `sharp` | Adaptador Workers compatível e fluxo privado de imagem verificado no runtime Cloudflare; Pages estático não cobre a aplicação |
| Sessão no domínio publicado | `not_run` | Login, seleção de loja, persistência após recarga, renovação, logout e cookies de Auth/contexto com `Secure` sob HTTPS, usando usuário fictício e relatório sanitizado |
| Chave HMAC operacional | `not_run`; chave temporária do ensaio foi removida | Mesmo segredo de 32 bytes no banco privado e no runtime da aplicação, desafio de consistência sem exibir o valor, upload HTTP publicado e remoção controlada de fixture |
| Worker agendado | `not_run`; o worker passou somente em execução dirigida | Agenda ativa em processo separado, identidade administrativa protegida, execução observada, falha transitória e retry observados, sem caminhos ou credenciais em logs |
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
