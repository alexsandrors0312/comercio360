# Homologação Cloudflare HTTPS — 04/10/2026

Ambiente: Worker `comercio360` em `comercio360.alexsandrors-0312.workers.dev`, ligado ao GitHub `alexsandrors0312/comercio360` `main`; Supabase **`comercio360-dev`**, contas `example.test` e produto temporários. Este resultado não autoriza produção ou dados reais.

## Publicação e transporte

- Build Cloudflare [`#9a188a00`](https://dash.cloudflare.com/41004f5611c7e9a6597a750f3ed55c6e/workers/services/view/comercio360/production/builds/9a188a00-e700-4194-95cc-8751e6f317d7) **sucesso**, commit `9695ffdea27707ea97c823b253fd33ef9a4b6020`, `npm run build:cloudflare` e `npm run deploy:cloudflare`. Instalação, compilação Linux e deploy concluídos. O build anterior de clone `#bf9bcc96` continua FAIL histórico.
- `GET http://.../login?x=1`: **308** para a mesma rota/query sob HTTPS; `GET http://.../icon.svg?probe=1`: **308** para HTTPS; `POST http://.../api/catalog/images/invalid`: **308** para HTTPS. `GET https://.../login`: **200**. O `custom-worker.ts` e `assets.run_worker_first` cobrem handler e asset; requisições de assets contam no limite Free.
- No Worker web, `CATALOG_IMAGE_PROCESSOR=cloudflare`, `IMAGES` e a chave HMAC operacional estão configurados. URL e chave pública do Supabase dev estão no build e runtime. `wrangler secret list --format json` após o deploy retornou somente `CATALOG_IMAGE_ATTESTATION_KEY` no web e somente `SUPABASE_SECRET_KEY` no Worker de limpeza; nenhum valor foi lido. A chave administrativa não está no web.

## Ensaio funcional no domínio publicado

`scripts/cloudflare-https.ps1` confirmou projeto vinculado, 7 migrações, bucket privado, HMAC presente e zero fixtures antes/depois. `tests/hosted/cloudflare-https.mjs` gerou senha aleatória somente em memória e exercitou:

1. Login da conta fictícia e cookies Auth `Secure`.
2. Troca entre duas lojas autorizadas, cookie de contexto `Secure`/`HttpOnly` e persistência após recarga HTTPS.
3. Leitura inicial sem capa (404) e negação anônima (403); origem externa e imagem inválida rejeitadas.
4. `POST` reencodou JPEG de origem com EXIF, `GET` gerou URL assinada privada, e os bytes lidos do Storage estavam sem EXIF e com dimensões esperadas. Isso prova o caminho Images binding → Storage → HMAC no Worker publicado para esta fixture.
5. Revisão antiga retornou 409 sem trocar a capa; perda de papel impediu escrita, e revogação do vínculo impediu leitura.
6. `DELETE` com revisão antiga retornou 409; remoção válida retornou 200 e leitura final 404. Logout removeu cookies e redirecionou o acesso à página privada para `/login`.

Resultado final: **16 linhas PASS, exit 0** incluindo preflight e postflight; zero contas/produtos/objetos/ledger residuais do ensaio e uma chave HMAC operacional preservada. O relatório e o terminal não contêm e-mail, senha, JWT, cookie, URL assinada, path privado ou segredo.

Houve tentativas instrumentais anteriores: o wrapper PowerShell falhou no preflight por tratar stderr informativo do CLI como exceção, sem criar fixture; depois a primeira verificação da troca de loja leu o cookie antes de a Server Action terminar. As correções estão no script e no polling do harness; essas tentativas permanecem **FAIL de harness**, não são reclassificadas como PASS da mesma execução. Os postflights confirmaram zero resíduos.

## Cron e limites

O Worker `comercio360-catalog-cleanup-dev` versão `989ad952-c9d0-46a4-bb75-aab3a4a29590` está separado, sem URL HTTP, com `*/15 * * * *`. O painel Observability mostrou 8 Success/0 Errors na última hora às 18h11 e novamente às 18h34 BRT, incluindo a execução das 18h30; o evento das 18h teve `outcome=ok`, CPU 1 ms, wall 977 ms. Primeira execução observada no tail: `claimed=0 deleted=0 failed=0`. Testes locais do Worker 5/5 e ensaio hospedado manual anterior `claimed=2 deleted=2` são evidência distinta. **Falha transitória/retry remoto ainda não foi provocado**; observar backlog após uso regular.

Revisão independente do delta de sanitização e redirecionamento em `9695ffd` não encontrou P0/P1/P2 de código; apontou lacuna de evidência HTTP, fechada pelos três `curl` acima, e a lacuna de renovação de sessão no domínio publicado. A renovação natural após expiração **não foi ensaiada nesta execução**. O H1 histórico ensaiou expiração/renovação no ambiente anterior; não transferir esse PASS automaticamente para Cloudflare. Perfis ICC não sRGB extremos também não foram ensaiados.

Ainda bloqueiam dados reais: renovação HTTPS, falha/retry remoto do Cron, backup/restauração de banco **e Storage** em projeto novo, Supabase de produção separado com URLs e segredos próprios, e identificação da loja piloto. O plano Free e a dependência da cota de Images exigem acompanhamento operacional.
