# Gate H1 — relatório parcial, homologação pendente

Início: 08/09/2026. Atualização: 10/09/2026. Versão da aplicação: **0.1.1 / Pacote 001.1**, aprovado na revisão técnica local segundo a base fornecida v0.5. Nenhum módulo funcional novo implementado. Última execução hospedada: **31 verificações PASS, uma verificação composta de expiração FAIL**. A homologação permanece pendente.

## Ambiente e histórico

- Operador confirmou projeto Supabase hospedado descartável de desenvolvimento, sem dados pessoais reais: **comercio360-dev**, referência pública `qiwblpmocldqbijbylwg`.
- Vínculo local e origem da URL pública conferidos: correspondem. `.env.local` contém somente `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `DEMO_ENABLED`. Os valores de chave não foram exibidos.
- Nova consulta pública HTTPS `/auth/v1/settings`: HTTP 200, login por e-mail habilitado e **cadastro público desativado** (`disable_signup=true`). A divergência inicial de cadastro foi corrigida no ambiente. O endpoint não informou o estado do login anônimo; confirmação no painel ainda pendente.
- **Histórico alinhado, comprovado pelas saídas sanitizadas do operador após a aplicação:** `202609070001` e `202609080001` constam tanto em Local quanto em Remote. O dry-run posterior informou `Remote database is up to date.`. Nenhuma versão remota desconhecida foi listada. Não reaplicar migrações.
- Tentativas do CLI nesta sessão pararam em EPERM ao gravar telemetria em diretório fora da permissão, antes de acesso ao banco. Conferência remota solicitada ao operador, sem credenciais pelo chat.
- **Migrações aplicadas pelo operador:** `202609070001_foundation.sql`, seguida de `202609080001_tenant_key_guards.sql`, conforme sequência orientada e histórico final fornecido. O agente não aplicou nem alterou migrações. As consultas públicas antigas com PGRST205 ocorreram antes dessa confirmação e não descrevem o estado atual. O operador confirmou a conclusão da fase Seed com a mensagem fixa PASS: quatro contas fictícias preparadas, senhas existentes preservadas. O programa atualizado verifica os IDs das duas empresas e três lojas antes de qualquer criação Auth; sua conclusão comprova essa presença e a conclusão das operações de perfis, vínculos e acessos previstas no seed. A mensagem do seed isoladamente não comprova login, RLS ou sessão; a execução Verify de 10/09/2026 acrescentou os 31 PASS detalhados abaixo.
- As duas migrações locais e `.env.example` foram preservados. A migração inicial mantém SHA256 `39C5E858C3F1EFBE59963B5420C112B0B67D40D6E45956BEF36C1EE6DA7DA4E4`.

## Verificações locais executadas

| Comando | Resultado e data |
| --- | --- |
| `npm ci` | Sucesso; 406 pacotes instalados; cache npm em pasta de trabalho autorizada |
| `npm run lint` | Sucesso; repetido em 10/09 após correção do teste de expiração |
| `npm run typecheck` | Sucesso; repetido em 10/09 após correção do teste de expiração |
| `npm test` | **90/90 em 10/09**: os 62 originais, 2 do wrapper, 11 de diagnóstico/seed e 15 regressões de expiração/observações sanitizadas |
| `npm run build` | Sucesso; Next 16.3.4 com configuração pública de desenvolvimento |
| `npx playwright install chromium` | Sucesso; cache externo de navegadores já instalado |
| `npm run test:e2e` | **11/11**, saída final 0, 1,7 min; API Auth simulada + PGlite |
| `npm audit` | Saída 1: **2 moderadas**, uma vulnerabilidade compartilhada por Vitest e @vitest/mocker |
| `npm audit --omit=dev` | **0 vulnerabilidades** reportadas nas dependências de produção |
| Sintaxe Node/PowerShell dos roteiros H1 | Sucesso; nova execução hospedada da expiração corrigida pendente |

No Windows gerenciado, após todas as 11 asserções passarem, o encerramento automático dos servidores E2E ficou aguardando. Foram encerrados somente os dois processos de teste identificados pelos PIDs emitidos na inicialização e pelas portas 3001/54329; então Playwright concluiu com 11 passed e código 0. Isso é uma limitação do encerramento da suíte neste ambiente, não uma evidência de autenticação hospedada.

## Matriz validada na execução hospedada de 10/09/2026

| Usuário fictício | Organização | Lojas autorizadas | Comportamento com PASS |
| --- | --- | --- | --- |
| gerente.aurora@example.test | Aurora | Centro (A1), Jardim (A2) | Seleção e persistência nas duas lojas |
| caixa.aurora@example.test | Aurora | Centro (A1) | A2 e Horizonte indisponíveis |
| gerente.horizonte@example.test | Horizonte | B1 | Nenhum dado da Aurora |
| sem.vinculo@example.test | Nenhuma | Nenhuma | `/sem-acesso` |
| Gerente Aurora com vínculo temporário B sem loja | Aurora e Horizonte | Somente A1/A2 | Horizonte omitida do seletor |
| Caixa após revogar sua única loja | Aurora, vínculo ativo | Nenhuma | `/sem-acesso`, API sem lojas |
| Caixa após desativar vínculo | Vínculo inativo | Nenhuma | Bloqueio na próxima requisição e RPC |

## Execução da fase Verify

O operador executou Verify localmente com credenciais em prompts ocultos. O arquivo `docs/H1_RESULTADOS.json`, datado de `2026-09-10T22:51:05.531Z`, registra 31 PASS e um FAIL, na etapa composta de expiração. Cópia integral preservada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`. A cópia não contém tokens ou credenciais. O erro final do PowerShell apenas propaga o resultado negativo da suíte, não identifica por si só a causa.

## Evidência hospedada obtida e pendência

O roteiro separado `tests/hosted/h1.mjs` foi executado no Supabase hospedado. A suíte simulada existente foi preservada.

PASS registrados: login válido/inválido no Auth real e navegador; persistência após recarregar; renovação explícita no Auth; logout e recusa posterior; revogação do refresh token; cookie de contexto adulterado sem ampliação; vínculos sem lojas; revogações de loja e vínculo; leituras REST cruzadas com zero linhas; insert/update/RPC indevidos rejeitados com JWT dos usuários; dez chaves estruturais bloqueadas sem alteração de dados/auditoria; updates administrativos legítimos; rejeição de snapshots inconsistentes; auditoria com ator, origem, antes/depois, organização, loja e data; seleção consecutiva idempotente; troca entre empresas sem copiar snapshot anterior. Nenhuma falha de restauração das fixtures foi registrada pelo roteiro.

Pendência: recusa de access JWT após expiração e tolerância, acesso autorizado no navegador após expiração e renovação do cookie. A etapa anterior reunia essas asserções e não registrava status/observações individuais. Os 31 PASS não foram convertidos em homologação geral. A próxima execução usará o teste corrigido e evidências separadas; o arquivo atual permanece intacto até a reexecução.

## Achados e encaminhamento

**Execução hospedada de 10/09/2026: 31 PASS e uma falha composta de expiração.** Evidência original preservada em `H1_RESULTADOS_2026-09-10_expiracao_pendente.json`, sem alteração de resultados. Login, renovação explícita, isolamento REST, revogações, auditoria, chaves estruturais, navegação e logout passaram. Nenhuma falha de restauração foi registrada. O relatório antigo não informa qual asserção de expiração falhou nem o status HTTP; não permite afirmar falha de renovação no aplicativo. Defeito confirmado no teste: exigia 401 cinco segundos após expirar, embora o PostgREST documente tolerância de 30 segundos. Isso é causa provável, não comprovação retrospectiva da asserção que falhou. Proposta registrada antes da correção e implementada: aguardar a expiração natural além da tolerância de 30 segundos, com margem de cinco segundos; estimar diferença de relógio com Date HTTP; registrar status e classificações fixas sem JWTs; separar recusa de cada token, navegação autorizada e renovação do cookie. Lint, tipos e 90 testes passaram, incluindo 15 regressões do helper de expiração. Os testes locais reproduziram o caso de 200 em exp+5 e 401 somente após a tolerância, com relógio e respostas fictícios, sem JWT real. Preservar o critério de recusa, sem aceitar 200 após a janela nem classificar qualquer 401 como expiração. Aplicação, banco e configurações de validade não foram alterados nessa correção do teste. [Tolerância documentada do PostgREST](https://postgrest.org/en/stable/references/auth.html).

**Segunda tentativa administrativa retornou somente erro genérico.** A saída sanitizada enviada pelo operador não permite distinguir preflight, falha de runtime ou erro do provedor, nem afirmar ausência de escritas nessa tentativa. O campo de confirmação da URL aparece vazio no texto recebido; pode ter sido removido na sanitização, portanto não é causa confirmada. Defeito diagnosticado no roteiro: supressão de erro sem classificação útil, agravada pelo tratamento de stderr nativo como exceção terminante do PowerShell. Correção: captura privada no processo filho, códigos de saída definidos e descrições fixas por etapa/categoria; nenhuma mensagem bruta, URL ou valor secreto incluído no diagnóstico. Campo de confirmação vazio agora interrompe antes de solicitar segredos. Adicionada conferência somente de leitura do seed SQL, após validar acesso administrativo pela listagem de usuários e antes de qualquer criação Auth. Os guards de confirmação de destino e domínio example.test foram preservados. Onze testes locais adicionais cobrem confirmação ausente/divergente, chave ausente/recusada, senha curta/política Auth, schema/seed ausente, falha de perfil e reexecução com usuários existentes. Provedor falso inclui marcadores privados em erros para verificar que não são repassados. A tentativa posterior concluiu com PASS informado pelo operador. A causa concreta da falha genérica anterior não foi comprovada, pois não houve código diagnóstico daquela tentativa. Nenhuma chamada administrativa real foi executada pelo agente nessa correção.

**Bloqueio no roteiro administrativo H1, fase Seed — corrigido localmente.** O operador reportou que Node recusou `--env-file` em `NODE_OPTIONS` antes de iniciar npm. Causa: opção de linha de comando utilizada em uma variável que não a permite. Impacto: essa tentativa não iniciou `seed-users.mjs` e não escreveu usuários no Supabase; não permite concluir o estado de execuções anteriores ou do seed SQL. A proposta registrada antes da alteração foi implementada: o roteiro invoca diretamente o mesmo `scripts/seed-users.mjs` usado por `npm run seed:users`, passando `--env-file=.env.local` na linha de comando do Node. Mantém saída privada, limpeza das variáveis administrativas e todos os guards existentes; preserva `NODE_OPTIONS` do operador. Dois testes executaram o wrapper PowerShell real com entradas e programa fictícios locais, cobrindo sucesso e falha, carregamento de configuração, supressão de stdout/stderr e limpeza. Lint, tipos e 64 testes passaram. O processo PowerShell dos testes usa RemoteSigned somente no processo filho para permitir os scripts locais temporários; nenhuma política da máquina foi alterada. Nenhuma credencial real foi usada ou registrada nesses testes. Reexecução administrativa hospedada concluída pelo operador com PASS da fase Seed.

1. **Cadastro público inicialmente habilitado — corrigido no ambiente.** Causa: configuração do Auth hospedado independente do `config.toml` local. Impacto anterior: criação pública de identidades, ainda sem vínculo/permissão operacional. Nova leitura HTTPS confirmou `disable_signup=true` e e-mail habilitado. Nenhuma mudança no código da aplicação necessária. A suíte autenticada repetirá a validação; o estado do login anônimo ainda precisa de confirmação no painel.
2. **GHSA-82fw-gwwq-j7x9 / CVE-2026-84373 em dependências de teste.** `npm audit` reporta Vitest 3.2.7 e @vitest/mocker. O advisory descreve leitura arbitrária de arquivo pelo mecanismo de redirect mock em servidor de desenvolvimento acessível. A suíte usa `vitest run` no Node, sem modo browser/servidor de mocks público; não foi demonstrada exploração no fluxo utilizado. Proposta: atualização controlada para versão corrigida (4.1.11 ou superior) em correção técnica específica, repetindo a suíte; não executar `npm audit fix --force` sem avaliar a mudança de major. Dependências preservadas nesta homologação. [Advisory e pré-condições](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
3. **Acesso CLI desta sessão limitado por telemetria fora da pasta autorizada.** O operador executou os comandos no PowerShell normal e forneceu evidência sanitizada suficiente para confirmar o alinhamento. Etapas administrativas seguintes também serão executadas localmente pelo operador, sem credenciais pelo chat.

A correção técnica de Vitest e @vitest/mocker foi autorizada em instrução posterior do operador, **somente depois da homologação hospedada**. Será separada, com versão corrigida compatível, sem `npm audit fix --force`, seguida de lint, tipos, toda a suíte (62 testes originais mais as regressões H1), build, 11 E2E e auditoria completa. Ainda não iniciada, respeitando essa ordem.

## Limites e parecer

**Gate H1 pendente; ainda não homologado.** Base local validada, histórico de migrações alinhado e cadastro público desativado. Seed SQL/usuários confirmado pela conclusão da fase Seed. A execução hospedada comprovou 31 verificações; faltam a confirmação de login anônimo desativado no painel e a reexecução da etapa de expiração corrigida. A tolerância documentada explica um defeito no teste, mas não comprova qual asserção falhou na tentativa anterior. Nenhuma aprovação retroativa foi concedida. Sessão em Supabase HTTPS será testada a partir de Next HTTP em loopback; cookie Secure sob HTTPS da aplicação permanece um aceite posterior de implantação. Tokens de acesso emitidos podem durar até expirar após logout; revogação de refresh e acesso da aplicação devem ser avaliados separadamente conforme [documentação Supabase](https://supabase.com/docs/guides/auth/signout).

Decisões de produto aprovadas foram registradas em `DECISOES_PILOTO.md`; não alteram a fundação. CHANGELOG atualizado pela correção efetiva do roteiro administrativo. ADRs e migrações preservados: não houve decisão arquitetural nova. O ZIP final H1 será gerado após a execução e revisão das evidências. **Pacote 002 permanece não autorizado.**
