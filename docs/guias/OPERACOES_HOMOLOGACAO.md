# Homologação operacional 003/004 em dev

Preparado em 09/10/2026. Este documento descreve o instrumento; **não comprova execução remota**. A aplicação e as duas migrações devem passar nos gates locais e na revisão independente antes da aplicação/publicação pelo responsável pela entrega.

Alvos fixos: projeto `comercio360-dev`, referência `qiwblpmocldqbijbylwg`; aplicação HTTPS `https://comercio360.alexsandrors-0312.workers.dev`. Somente dados fictícios. O ensaio de limpeza permanece `not_run` e não é iniciado por este instrumento.

## Execução autorizada após publicação

```powershell
powershell -NoProfile -File scripts/operations-hosted.ps1 `
  -ConfirmProjectUrl https://qiwblpmocldqbijbylwg.supabase.co `
  -ConfirmWorkerUrl https://comercio360.alexsandrors-0312.workers.dev `
  -ConfirmCurrentDeployment
```

O wrapper confirma referência vinculada e nome do projeto, nove versões exatas de migração (sete anteriores, `202610090001` e `202610090002`), bucket privado, HMAC presente e as duas identidades fictícias existentes. Usa somente o executável nativo em cache `@supabase/cli-windows-x64` **2.119.0**, validando também o manifesto do pacote `supabase`; não passa SQL por `npx`/`cmd`, que pode truncar consultas multilinha no Windows. Cache ausente/ambíguo interrompe antes do ensaio.

Não executar os wrappers históricos de Catálogo/HTTPS que ainda exigem sete migrações após aplicar nove: suas guardas documentam a entrega original e permanecem preservadas. Este wrapper não aplica migrações, não publica o Worker, não reaplica seed e não altera Auth, vínculos ou concessões de lojas.

## Sessões e fluxo

As chaves vêm do CLI autenticado em memória. A chave administrativa fica no processo Node pai de Chromium, nunca no navegador. O filho Chromium recebe somente variáveis locais necessárias ao sistema operacional, sem credenciais. Diagnósticos de SDK/CLI/provider, cookies, JWTs, corpos e fingerprints privados não entram no relatório.

O login usa `gerente.aurora@example.test` e `caixa.aurora@example.test` existentes: confere ID/e-mail com `getUserById`, gera link com `admin.generateLink` e verifica seu `hashed_token` com `@supabase/ssr` em memória. `generateLink` não envia e-mail. Não cria/remove usuários nem redefine senhas. Cookies de sessão no navegador usam `Secure`; o browser acessa a aplicação HTTPS real.

O fluxo principal cria produto fictício e dois SKUs por RPC, cadastra fornecedor na interface, monta pedido com duas linhas/custos, recebe integralmente e confere saldo/histórico na interface e no REST. Verifica replay de UUID, payload alterado/CAS com HTTP409/PT409, duas requisições REST paralelas com chaves diferentes (um sucesso/um conflito), duas com a mesma chave (mesmo resultado), uma entrada por SKU e uma auditoria de recebimento por pedido. Confere negação de loja alheia e de custos/recebimento para caixa, incluindo a interface do caixa. Não altera papéis temporariamente.

Requisições simultâneas são conexões REST reais ao Supabase. O instrumento não afirma capturar PIDs de backend PostgreSQL; a evidência vem dos resultados concorrentes, movimentos e auditoria. Não reclassifica testes locais de uma sessão como concorrência remota.

## Encerramento e evidência

Fixtures usam o marcador **FICTICIO HOMOLOG004** com UUID único. Como pedidos, movimentos, snapshots e auditoria são imutáveis, não são deletados. O encerramento descobre escritas ambíguas por nome exato, cancela pedidos ainda abertos, calcula os recebimentos próprios, exige que os saldos coincidam e registra saídas compensatórias justificadas. Só então inativa fornecedor/produto por RPC com revisão atual. Saldo inesperado interrompe a compensação, preservando evidência para conferência.

O postflight compara em memória fingerprints de identidade/vínculos/concessões e de senha/HMAC; não persiste esses fingerprints. Também compara SHA-256 do conteúdo integral do conjunto exato de eventos de auditoria que existiam no preflight, identificado por IDs capturados somente em memória. Novos eventos aumentam legitimamente a contagem; eventos anteriores precisam permanecer byte-equivalentes na representação JSON ordenada. O instrumento limita esse conjunto a 500 eventos prévios para respeitar o limite de argumentos do Windows; acima disso interrompe antes das fixtures, exigindo evolução do canal de leitura. Confere bucket privado, nove migrações, identidades/senhas/HMAC e contagens de imagens preservados. O relatório contém apenas fases/status, flags e contagens, em arquivo novo `docs/evidencias/operacoes-004-hosted-<timestamp>.json` criado exclusivamente (`CreateNew`), inclusive em falha.

CLI tem prazo de 120 s por chamada; o processo Node tem 10 min, e autenticação/REST têm 20 s por requisição. Timeout tenta encerrar apenas a árvore do processo conhecido e confere sua saída. Descendente segurando pipe sem identidade comprovável deixa `process_termination_confirmed=false`, impedindo aprovação; não encerra processos por nome ou PIDs possivelmente reutilizados.

Falha mantém a fase exata no relatório do probe, nunca o corpo do provider. Saídas não confirmadas, fixtures não arquivadas, falha de postflight ou teste não executado impedem `passed`. Falhas anteriores permanecem intactas; uma nova tentativa cria outro arquivo. Em interrupção abrupta do processo/máquina, o marcador único identifica os dados fictícios para recuperação manual; não prometer compensação se o `finally` não terminou.

O primeiro ensaio de 09/10 falhou em `browser_supplier` e preservou seu JSON original. Para diagnosticar sem capturar dados privados, o instrumento registra subetapas fixas: `page_status`, `heading`, `store`, `open`, `fields`, `submit`, `rpc`, `cookies`. A primeira falha é persistida como `failed_substep`, com apenas nomes/status. Flags fixas registram HTTP200, rota Compras/login e indicação de acesso negado/indisponibilidade; nunca URL completa, texto livre ou HTML. Conteúdo da página, mensagens de erro, cookies e provider continuam omitidos. As asserções funcionais permanecem as mesmas.

O segundo ensaio isolou a falha em `submit`, sem cadastro de fornecedor. O delta de diagnóstico classifica apenas mensagens conhecidas da interface (`invalid`, `denied`, `conflict`, `duplicate`, `unavailable`, `ambiguous`, `success`, `none`) e o status HTTP allowlisted do POST da aplicação. Não lê payload, headers ou resposta do POST. Em falha de envio, tenta capturar o **viewport da página dev com dados fictícios** em `test-results/operations-supplier-failure.png`, inclusive se uma navegação tiver removido o formulário. Esse arquivo é diagnóstico local, ignorado pelo Git e **não deve ser publicado**. O JSON inclui apenas a flag de captura, nunca a imagem ou dados livres. A flag booleana `native_form_query` identifica parâmetros de um possível envio nativo sem registrar URL ou valores.

O [quarto ensaio de 09/10](../evidencias/operacoes-004-hosted-2026-10-09T21-00-08-881Z.json) completou as 15 fases, compensação/arquivamento e postflight, com 32 novos eventos legítimos de auditoria e preservação do conjunto anterior. As três tentativas anteriores permanecem FAIL; esse PASS não reclassifica seus resultados nem encerra a investigação da interação antes da hidratação. Uma correção posterior de interface exige sua própria revisão/publicação e novo ensaio. O retry de limpeza continua `not_run`.

Validação local do instrumento: `node --check tests/hosted/operations.mjs`, parser PowerShell sem execução e `npm test -- tests/operations-hosted.test.ts`. Não confundir validação local com homologação remota.
