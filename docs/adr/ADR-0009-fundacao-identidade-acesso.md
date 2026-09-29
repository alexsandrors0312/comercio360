# ADR-0009 — Detalhamento da identidade e acesso na fundação

Estado revisto em 26/09/2026: decisão mantida; fundação H1 **aprovada com condições para continuidade do desenvolvimento**, conforme [parecer atual](../REVISAO_ARQUITETURAL_H1.md). Não houve mudança de identidade, autorização, migrações ou runtime nesta revisão. Os registros de pendência abaixo descrevem o momento histórico do corretivo. O catálogo proposto requer decisão arquitetural própria antes da implementação.

Data inicial: 07/09/2026. Atualização: 08/09/2026, Pacote 001.1, aplicação 0.1.1. Estado: decisão aceita na revisão local registrada na base v0.3; corretivo implementado para nova revisão e homologação H1. Os números 0002–0008 mantêm as decisões já registradas na base e não foram reutilizados.

Contexto: uma identidade pode trabalhar em várias empresas. A regra genérica de `organization_id` não descreve a raiz da organização nem a identidade global. O pacote exige vínculos e acesso por loja, sem uma interface completa de administração.

Decisão: `auth.users` guarda identidade autenticável; `profiles` guarda somente nome de exibição global. `memberships` guarda papel por empresa e estado ativo. A organização usa seu próprio `id` como raiz. `user_store_access` usa chaves estrangeiras compostas para manter vínculo e loja no mesmo tenant. Não há proprietário com bypass automático de loja.

Nenhum usuário autenticado pode editar vínculos ou permissões diretamente. Provisionamento usa um canal administrativo fora do runtime web. `set_active_store` é a única operação mutável exposta, com autorização no banco, ator derivado de `auth.uid()` e idempotência da seleção repetida. O papel existente não autoriza ações comerciais ainda não implementadas. Catálogo completo de permissões por ação fica para o pacote que introduzir essas ações.

Alternativas: duplicar identidade por empresa; autorizar apenas no servidor; usar chave administrativa nas consultas; conceder acesso irrestrito por nome de papel. Rejeitadas por duplicação de identidade ou enfraquecimento do isolamento.

Impacto: seis tabelas públicas; acesso negado por padrão; dependência do Supabase limitada a adaptador de autenticação e `auth.uid()`. Triggers auditam mudanças na fundação e a RPC audita contexto. Eventos de uma empresa não contêm a seleção anterior de outra empresa.

Migrações: `202609070001_foundation.sql`, preservada, seguida de `202609080001_tenant_key_guards.sql`. A segunda é incremental, transacional e não cria tabelas nem move dados.

### Correção 001.1

Problema: um vínculo sem loja produzia uma opção de empresa inutilizável; updates administrativos podiam alterar a organização ou os relacionamentos de registros existentes e transportar snapshots antigos para outra auditoria; o seed não confirmava o projeto-alvo.

Decisão: derivar as organizações selecionáveis das lojas já autorizadas pelo banco. Um usuário vinculado a A e B com loja somente em A usa A e não pode selecionar B. Sem qualquer loja ativa autorizada, permanece em `/sem-acesso`; o vínculo não é apagado. Cookies inválidos continuam sendo apenas preferências descartáveis.

Chaves imutáveis: `organizations.id`; `stores.id/organization_id`; `memberships.id/organization_id/user_id`; `user_store_access.id/organization_id/membership_id/store_id`. Triggers BEFORE UPDATE rejeitam mudanças efetivas inclusive por `service_role` e pelo proprietário do banco em DML normal. Valores idênticos não são bloqueados. Renomes, desativação e mudanças legítimas de papel continuam possíveis. Transferir exige desativação/criação; acessos são revogados/removidos e recriados, sem introduzir campo `active` ou interface nova.

Auditoria: um CHECK valida o tenant declarado em `old_value` e `new_value` contra o evento e valida `id` nos snapshots de `organizations`. Uma seleção de contexto entre empresas não copia o contexto anterior para o novo tenant. A migração valida também registros históricos e falha atomicamente se houver inconsistência; não corrige nem elimina eventos antigos de forma silenciosa.

Seed: `ALLOW_DEVELOPMENT_SEED=yes` e confirmação independente `CONFIRM_SUPABASE_PROJECT_URL` devem coincidir com a origem canônica de destino. Portas e protocolo contam; HTTPS é exigido fora do loopback. Entradas ambíguas são recusadas. Todas as contas devem pertencer ao domínio exato `example.test`; validações terminam antes de criar o cliente ou acessar a API. Credenciais continuam somente no ambiente do processo, sem alteração do `.env.example`.

Alternativas avaliadas: deixar empresas vazias desabilitadas (escolhida omissão por simplicidade); depender apenas de FKs/RLS (não bloqueia toda reatribuição por serviço); descartar `old_value` nos updates de tenant (ocultaria a transferência); criar uma API de transferências (fora do escopo); derivar confirmação automaticamente da URL (não confirmaria a escolha do operador).

Otimização: `React.cache` memoiza `requireAccess` durante a renderização da requisição, conforme o guia de autenticação incluído no Next.js instalado. Não foi removida a validação da página/ação nem introduzido cache compartilhado entre requisições.

Impactos e reversão: seis tabelas públicas preservadas, uma nova função/trigger de proteção e uma restrição de auditoria. Não há migração de identidades ou registros. Preferir correção progressiva; eventual reversão exige migração revisada que retire explicitamente essas proteções e reconheça a reabertura do risco. Nunca reescrever a migração inicial nem apagar auditoria para permitir a atualização.

Riscos: testes locais não comprovam configuração do serviço hospedado; administradores do banco continuam tecnicamente privilegiados. Segredos administrativos devem permanecer restritos ao provisionamento.

Reversão: em desenvolvimento descartável, recriar o projeto/banco; com dados reais, restaurar backup validado ou realizar migração corretiva. Não foi incluído um rollback que apaga auditoria automaticamente.
