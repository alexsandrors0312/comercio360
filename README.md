# Comércio 360 — Fundação 001.1 e Catálogo 002

Para retomar o desenvolvimento, leia primeiro o [contexto permanente](context.md) e atualize-o ao concluir cada mudança relevante.

O [plano de desenvolvimento por IA](docs/ai/PLANO_ORQUESTRACAO.md) mapeia módulos, agentes, skills e etapas do harness. Há seis perfis em `.codex/agents/`, seis skills em `.agents/skills/` e um [validador local dos contratos](docs/ai/CONTRATOS_HARNESS.md). O [piloto H-03](docs/ai/RELATORIO_H03.md) integrou três correções. A [avaliação H-04](docs/ai/RELATORIO_H04.md) concluiu D1/S1 e U1 apenas no escopo sintético; o runner original permanece pendente. A [telemetria G](docs/ai/TELEMETRIA_G.md) capturou uma chamada MCP DSH real, sem permitir comparação de custo com Codex.

Fundação executável em Next.js 16, TypeScript e PostgreSQL/Supabase. Interface em português, login por e-mail/senha, seleção de empresa/loja autorizada, políticas RLS, auditoria e painel com dados exclusivamente fictícios. O Catálogo 002 está integrado à árvore principal e passou nos ensaios de Auth, REST, Storage, rota Next local e worker no Supabase de desenvolvimento; os demais módulos comerciais exibem **Em construção**. O estado e os gates estão no [relatório do Catálogo](docs/ENTREGA_CATALOGO_002.md) e na [verificação de 03/10](docs/CATALOGO_002_HOSPEDADO_2026-10-03.md).

## Catálogo 002

`/app/produtos` oferece categorias, produtos com primeira variante e SKU, variantes adicionais, pesquisa e filtros, preço por loja e capa privada opcional. Proprietário e gerente podem editar; caixa, estoquista e comprador autorizados podem consultar. Toda leitura e escrita exige vínculo, papel e loja ativa autorizada. O catálogo é comum à organização; o preço mostrado pertence à loja selecionada. As sete migrações até `202610030001_catalog_conflict_http.sql` foram aplicadas em `comercio360-dev`, após conferência do histórico.

Para operar capas em um ambiente próprio, provisione **a mesma chave aleatória de 32 bytes** na linha única de `private.catalog_image_attestation_key.secret` e na variável de runtime `CATALOG_IMAGE_ATTESTATION_KEY` em base64, por canal seguro. A migração não inclui chave; sem ela o POST de capa responde 503. Nunca coloque essa chave ou `SUPABASE_SECRET_KEY` no repositório, em variáveis `NEXT_PUBLIC_*` ou na conversa. Remoções e falhas de upload deixam objetos rastreáveis para limpeza após carência de duas horas; o worker roda em processo separado do Next. O ensaio de 03/10 usou uma chave HMAC temporária e a removeu; o worker apagou dois objetos vencidos de teste. O [gate de publicação](docs/PUBLICACAO_OPERACAO_2026-10-03.md) e o [runbook do worker](scripts/catalog-image-cleanup.RUNBOOK.md) registram preparação, evidência e pendências operacionais.

## Executar

Requer Node.js 22.12+ (validado com 24.13.1) e npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Abra [demonstração local](http://127.0.0.1:3000/demo). Ela funciona sem conta ou banco; não cria sessão e não autoriza acesso a `/app`. `DEMO_ENABLED=false` desativa a rota pública. O painel dentro da área autenticada também é demonstrativo neste pacote, com indicação visível. Empresa e loja vêm do banco; os indicadores não.

## Conectar um Supabase de desenvolvimento

1. Crie ou use um projeto **de desenvolvimento** vazio, com autenticação por e-mail/senha. Não execute o seed em produção.
2. Em um projeto novo, aplique as sete migrações da pasta em ordem: as duas da fundação (`202609070001` e `202609080001`), as três iniciais do Catálogo (`202609300001` a `202609300003`) e as corretivas `202610020001` e `202610030001`. Em um projeto já migrado, aplique apenas as migrações ainda pendentes. Confira a vinculação da CLI e o histórico de migrações antes de `supabase db push`; não repare nem reaplique migrações para contornar divergências.
3. Execute `supabase/seed.sql` nesse mesmo banco para criar duas empresas e três lojas fictícias.
4. Preencha em `.env.local` `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, usando os valores públicos do projeto. Para o POST de capa, configure adicionalmente `CATALOG_IMAGE_ATTESTATION_KEY` pelo processo seguro descrito acima. Reinicie o servidor.
5. Crie os usuários fictícios com o script abaixo ou provisione usuários, perfis, vínculos e acessos às lojas por um processo administrativo confiável. A aplicação não oferece cadastro público nem criação de permissões.
6. Desative cadastro público no Supabase hospedado, mantenha limitação de tentativas de login e configure URLs autorizadas. O `config.toml` já desativa cadastro no ambiente local.

Para uma instalação local completa do Supabase, instale a CLI e Docker, execute `supabase start`, aplique a migração/seed e use as chaves públicas locais. Esses serviços não estavam disponíveis nesta entrega; os testes de banco usam PostgreSQL via PGlite.

### Seed de usuários fictícios

O script chama a API administrativa oficial, confirma somente endereços `example.test` e vincula os usuários às empresas fictícias. A senha deve ser fornecida pelo operador; nenhuma senha utilizável é entregue no código. Antes de qualquer acesso à API, ele exige `ALLOW_DEVELOPMENT_SEED=yes` e `CONFIRM_SUPABASE_PROJECT_URL` correspondente à origem de `NEXT_PUBLIC_SUPABASE_URL`. Confira a URL no painel do projeto e informe a confirmação separadamente; não a derive automaticamente da variável de destino.

A comparação inclui protocolo, host e porta, normalizando apenas a representação de origem (por exemplo, barra final). Use HTTPS, ou HTTP somente para loopback local. URLs com credenciais embutidas, caminho, query ou fragmento são rejeitadas. Confirmação ausente/divergente aborta antes de leituras, criação de usuários ou escritas. Toda a lista de contas é validada para o domínio exato `example.test` antes da construção do cliente.

```powershell
# Defina os valores no ambiente do terminal, sem salvá-los no repositório.
$env:NEXT_PUBLIC_SUPABASE_URL='<URL do projeto de desenvolvimento>'
$env:SUPABASE_SECRET_KEY='<chave secreta apenas para este script>'
$env:SEED_PASSWORD='<senha de teste escolhida por você, com 12+ caracteres>'
$env:ALLOW_DEVELOPMENT_SEED='yes'
$env:CONFIRM_SUPABASE_PROJECT_URL='<URL conferida separadamente no projeto de desenvolvimento>'
npm run seed:users
Remove-Item Env:SUPABASE_SECRET_KEY, Env:SEED_PASSWORD, Env:ALLOW_DEVELOPMENT_SEED, Env:CONFIRM_SUPABASE_PROJECT_URL
```

Contas: `gerente.aurora@example.test` (duas lojas A), `caixa.aurora@example.test` (uma loja A), `gerente.horizonte@example.test` (loja B) e `sem.vinculo@example.test` (sem acesso à operação). Reexecuções preservam senhas existentes e não duplicam vínculos.

## Verificar

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` reúne lint, tipos, testes de domínio/banco e build. `npm test` carrega a migração real em **PGlite, PostgreSQL em WebAssembly**, com papéis sem privilégios e `auth.uid()` fornecido pelo harness. Verifica leituras A/B, restrição por loja, falta/revogação de vínculo, escrita indevida, chaves compostas, auditoria e idempotência da seleção. Não substitui teste do serviço Supabase hospedado.

Os testes E2E usam Chromium, Next na porta **3001** e um servidor de contratos HTTP de teste na **54329**, isolados da prévia em 3000. Exercitam formulário de login, cookies, redirecionamentos, troca de loja, logout e navegação; o servidor simula a API de autenticação e executa consultas sob RLS em PGlite. **Não comprova assinatura, renovação ou infraestrutura de autenticação do Supabase real.** Não publique `tests/support/auth-server.mjs` como serviço.

O teste de responsividade cobre 360, 768 e 1440 px. A tabela preserva colunas em uma região com rolagem horizontal; a página não transborda. `/demo` permite selecionar estados com dados, carregando, vazio e erro.

Se os navegadores estiverem em um cache personalizado, defina `PLAYWRIGHT_BROWSERS_PATH` com o caminho absoluto desse cache. Esse caminho não depende da localização do projeto na Área de Trabalho; em outra máquina, a instalação normal acima é suficiente.

## Comportamento do contexto no 001.1

- Só aparecem no seletor organizações que tenham ao menos uma loja ativa autorizada para o usuário. Um vínculo ativo isolado não basta.
- Se o usuário tem vínculo em A e B, mas loja autorizada somente em A, B é omitida. O vínculo B permanece no banco, sem conceder acesso à operação daquela empresa.
- Se nenhuma organização tem loja autorizada, a área autenticada redireciona para `/sem-acesso`, com orientação para solicitar liberação.
- Um cookie antigo apontando para B sem acesso não concede privilégios: o contexto volta à primeira loja autorizada disponível; sem nenhuma loja, o usuário permanece bloqueado.
- `requireAccess` usa `React.cache` para reutilizar o resultado entre layout e página durante a renderização da mesma requisição. Não há cache persistente de autorização entre usuários/requisições; validações da página, Server Actions e RLS permanecem.

## Chaves estruturais e auditoria no 001.1

A nova migração impede mudanças efetivas em `organizations.id`, `stores.(id, organization_id)`, `memberships.(id, organization_id, user_id)` e `user_store_access.(id, organization_id, membership_id, store_id)`. A proteção por trigger também se aplica a `service_role`; atualizar uma chave para o mesmo valor continua permitido, preservando o seed repetível. Nome, papel e estado ativo continuam editáveis pelo processo administrativo.

Não mova registros existentes para outra empresa por UPDATE. Desative o registro original e crie outro com nova identidade. Para acessos a lojas, revogue/remova o acesso anterior e crie um novo, já que essa tabela não possui campo `active`. Uma operação formal de transferência continua fora do escopo.

Uma restrição adicional rejeita snapshots `old_value`/`new_value` que declarem tenant diferente do evento, incluindo o `id` raiz nos snapshots de organizações. Seleções autorizadas entre empresas mantêm `old_value=null` no evento da nova empresa. A restrição valida o histórico existente: se houver dados incompatíveis, a migração falha e desfaz a transação. Investigue o histórico antes de tentar novamente, sem apagar ou reatribuir auditoria automaticamente.

## Estrutura e limites

| Pasta                 | Responsabilidade                                        |
| --------------------- | ------------------------------------------------------- |
| `app`                 | Rotas, Server Actions e metadados PWA                   |
| `lib`                 | Adaptador Supabase e obtenção de contexto autorizado    |
| `packages/domain`     | Regra pura de seleção de contexto                       |
| `packages/validation` | Esquemas Zod de entrada                                 |
| `packages/ui`         | Layout e componentes da interface                       |
| `packages/config`     | Navegação centralizada                                  |
| `mocks`               | Dados fictícios, importados apenas pela apresentação    |
| `supabase`            | Migração, seed, configuração e SQL do harness de testes |
| `tests`               | Domínio, RLS e contratos E2E                            |
| `docs`                | Arquitetura, ADRs, operação e resultados                |

O banco libera leitura conforme vínculo e escopo. O provisionamento de identidade e permissões permanece administrativo; a seleção de loja e as mutações específicas do Catálogo são as operações expostas aos papéis autorizados, com auditoria. Papéis iniciais são registrados no vínculo, sem CRUD de permissões nem bypass de proprietário. Novas ações exigem contratos e políticas próprios.

`organizations` é a raiz do tenant; `profiles` representa identidade global e se vincula a `auth.users`. As demais tabelas de negócio possuem `organization_id`. As chaves compostas impedem vincular loja de outra empresa, inclusive em gravações privilegiadas. Desative lojas/vínculos em vez de excluir entidades referenciadas pela auditoria.

O manifesto permite apresentação como aplicativo em navegadores compatíveis. A operação é **online-first**, sem service worker, cache de páginas autenticadas ou funcionalidade offline.

## Estado de revisão e pendências de implantação

- Migrações e seed conferidos no Supabase descartável: **36 verificações hospedadas PASS**, incluindo autenticação, RLS, revogação, auditoria, chaves estruturais e expiração natural.
- A revisão arquitetural H1 de 26/09/2026 registra **aprovação com condições para continuidade do desenvolvimento**. O ZIP foi comparado com a pasta atual e a evidência hospedada original foi preservada. Veja [parecer atual](docs/REVISAO_ARQUITETURAL_H1.md), [relatório histórico H1](docs/ENTREGA_H1.md) e [execução manual sem credenciais no chat](docs/OPERACAO_H1.md).
- Nome Comércio 360 e nicho moda/acessórios aprovados; piloto de uma loja, ainda a identificar. [Demais decisões aprovadas](docs/DECISOES_PILOTO.md) orientam etapas futuras e não ampliam o escopo deste gate.
- O [Catálogo 002](docs/PACOTE_002_CATALOGO_PROPOSTA.md) foi aceito e integrado; o ensaio de 03/10 passou no Supabase de desenvolvimento. O painel confirmou login anônimo desativado em 02/10. Em 04/10, a chave HMAC foi provisionada e o Cron Worker separado foi publicado e observado em homologação; ainda faltam o retry remoto e validar Auth/Storage no aplicativo HTTPS. Backup/restauração, produção separada e loja piloto permanecem condições antes de dados reais.
- Correção de Vitest e @vitest/mocker para 4.1.11: [H1-DEP-01](docs/CORRECAO_TECNICA_H1.md).
- O [gate de publicação](docs/PUBLICACAO_OPERACAO_2026-10-03.md) e o [deploy Cloudflare](docs/CLOUDFLARE_DEPLOY.md) registram evidências e pendências. A URL HTTPS atual é somente homologação com `comercio360-dev` e contas fictícias; a operação com dados reais continua pendente.

Veja [relatório de entrega](docs/ENTREGA.md), [arquitetura atual](docs/architecture/ARQUITETURA.md) e [operação/recuperação](docs/OPERACAO.md).
