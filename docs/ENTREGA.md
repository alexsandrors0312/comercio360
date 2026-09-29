# Entrega — Pacote corretivo 001.1

Data: 08/09/2026. Versão da aplicação: 0.1.1. Implementação e validação local concluídas. O projeto permanece em `C:\Users\Alexs\Desktop\Comercio360`. A homologação Supabase hospedada (Gate H1) e a revisão do corretivo permanecem pendentes.

## Resultado e comportamento

1. **Contexto multiempresa:** o seletor omite organizações sem pelo menos uma loja ativa autorizada. Vínculo em A e B com loja somente em A permite operar em A; B não é selecionável. Se nenhuma loja estiver autorizada, o usuário permanece em `/sem-acesso`, com orientação explícita. Cookies antigos não ampliam privilégios.
2. **Chaves de tenant:** a nova migração `202609080001_tenant_key_guards.sql` bloqueia mudanças efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`. Protege também atualizações administrativas normais por `service_role`, inclusive registros desativados ou sem referências.
3. **Auditoria:** uma restrição rejeita snapshots que declarem tenant diferente do evento e valida o ID raiz em snapshots de organizações. Seleções legítimas entre empresas mantêm `old_value=null` no evento da nova empresa. A migração valida o histórico existente e falha atomicamente em caso de inconsistência.
4. **Seed:** exige confirmação independente `CONFIRM_SUPABASE_PROJECT_URL`, além da flag de desenvolvimento. A origem confirmada deve corresponder ao destino, incluindo protocolo/porta. Domínio exato `example.test` é validado para todo o lote. A ausência/divergência de confirmação aborta antes de qualquer chamada HTTP.
5. **Acesso por requisição:** `requireAccess` usa `React.cache` para reutilizar a validação durante a renderização da mesma requisição. Permanecem as checagens nas páginas e Server Actions e o RLS no banco; não há cache persistente entre usuários/requisições.

## Comandos executados

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Aprovado, código 0 |
| `npm run typecheck` | Aprovado, código 0 |
| `npm test` | 62 testes aprovados, código 0 |
| `npm run build` | Build de produção aprovado, código 0 |
| `npm run test:e2e` | 11 testes Chromium aprovados, código 0 |

Total: **73 testes aprovados**.

- 13 testes existentes de RLS/auditoria.
- 30 testes SQL adicionais para chaves estruturais, updates administrativos, consistência de snapshots e troca legítima de organização.
- 6 testes de domínio/validação, incluindo organizações com vínculo e sem loja autorizada.
- 13 testes de preflight do seed, incluindo execução do CLI com servidor HTTP local e contagem de **zero requisições** quando a confirmação está ausente ou divergente.
- 11 testes E2E: os nove fluxos anteriores e dois cenários adicionais de vínculo ativo sem loja. A suíte mantém verificações em 360, 768 e 1440 px.

Os testes de banco executam as duas migrações reais em PostgreSQL/PGlite. As tentativas estruturais são verificadas sob `service_role` e proprietário do banco, distinguindo o bloqueio por trigger das permissões de escrita da aplicação. O caminho permitido (nome/papel/desativação e chaves com valor idêntico) também foi validado, com auditoria preservada no tenant original.

A autenticação dos testes E2E é simulada no contrato HTTP; esses testes não comprovam assinatura, expiração ou renovação de sessão no Supabase hospedado. Nenhum seed foi executado contra um projeto externo. No Windows gerenciado, os dois processos auxiliares E2E foram encerrados explicitamente após todas as asserções, permitindo o término do comando com código 0.

## Migração e compatibilidade

- A migração inicial foi preservada byte a byte, assim como `.env.example`.
- Em um banco do Pacote 001, aplicar somente `202609080001_tenant_key_guards.sql`. Em instalação nova, aplicar ambas em ordem.
- Não há novas tabelas, transferência automática ou migração de dados entre empresas.
- Transferências exigem desativar/criar registros. Para `user_store_access`, revogar/remover e criar novo acesso; a tabela não ganhou campo `active`.
- Chaves atualizadas para o próprio valor continuam permitidas, mantendo os upserts do seed compatíveis.
- Se a validação do histórico de auditoria falhar, investigar antes de reaplicar. Não apagar, reatribuir ou reescrever eventos automaticamente.
- Dependências não foram atualizadas; apenas a versão da aplicação e do pacote raiz no lockfile passou para 0.1.1.

## Arquivos alterados e adicionados

| Grupo | Arquivos |
| --- | --- |
| Contexto e orientação | `lib/tenancy.ts`, `packages/domain/tenancy.ts`, `app/sem-acesso/page.tsx` |
| Banco | nova `supabase/migrations/202609080001_tenant_key_guards.sql` |
| Seed | `scripts/seed-users.mjs`, novo `scripts/seed-guard.mjs` |
| Testes | `tests/tenancy.test.ts`, `tests/database.test.ts`, novos `tests/tenant-keys.test.ts` e `tests/seed-guard.test.ts`, `tests/e2e/auth.spec.ts`, `tests/support/auth-server.mjs`, nova fixture SQL `supabase/tests/context-fixtures.sql` |
| Documentação | ADR-0009, README, CHANGELOG, ARQUITETURA e este relatório; cópia imutável da base fornecida v0.3 |
| Metadados | `package.json`, `package-lock.json` (somente versão raiz), `.prettierignore` para preservar a base v0.3 |

## Artefato e limites

ZIP: `comercio360-pacote001.1.zip`. Contém código, migrações, testes, lockfile e documentação. Exclui arquivos de ambiente reais, `node_modules`, `.next*`, `.git`, resultados/caches de testes e segredos. Inclui somente o modelo `.env.example`, preservado e sem valores de credenciais.

Não foram implementados produtos, estoque, fornecedores, PDV, pagamentos, fretes ou mídias sociais. O Gate H1 e a revisão do corretivo continuam sendo as próximas validações, sem iniciar o Pacote 002.

