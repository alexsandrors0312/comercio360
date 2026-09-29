# Operação e recuperação da fundação

Esta entrega é local e não recebeu dados reais. Antes do piloto, use um Supabase de desenvolvimento para o aceite de integração e depois configure um ambiente de produção separado.

O Gate H1 começou em 08/09/2026 no ambiente descartável confirmado pelo operador. Veja [roteiro de execução manual](OPERACAO_H1.md) e [relatório de homologação](ENTREGA_H1.md). O histórico remoto está alinhado, o cadastro público foi desativado e a fase Seed concluiu com PASS pelo operador. Verify concluiu com 36 PASS e zero FAIL em 10/09 às 21:29 de Brasília, incluindo expiração natural. Evidência anterior com falha preservada. Revisão arquitetural e confirmação de login anônimo desativado no painel continuam pendentes. O roteiro exige conferir o histórico antes de aplicar migrações, entrada oculta de credenciais no terminal e limpeza das variáveis administrativas; não grave senhas literais no histórico do PowerShell. A configuração do Auth hospedado deve ser conferida no painel: `db push` não aplica o `config.toml` ao Auth remoto.

## Checklist de integração real

1. Aplicar migração e seed num ambiente descartável; criar as quatro identidades fictícias.
2. Fazer login como gerente Aurora, selecionar as duas lojas permitidas e confirmar persistência após recarregar.
3. Entrar como caixa Aurora e confirmar que a segunda loja não aparece e que RPC direta para ela retorna acesso negado.
4. Entrar como Horizonte e consultar IDs conhecidos da Aurora via API REST com token do próprio usuário: leituras devem retornar lista vazia, sem dados cruzados.
5. Entrar com usuário sem vínculo: destino `/sem-acesso`. Revogar vínculo e conferir bloqueio no próximo acesso.
6. Validar login inválido, expiração e renovação da sessão, logout e acesso posterior recusado. Conferir cookies sob HTTPS e ausência de cache de sessão compartilhado.
7. Conferir ator, origem, antes/depois e organização/loja nos eventos de auditoria. Confirmar que chamadas idênticas consecutivas não duplicam seleção.
8. Registrar evidências, revisar RLS no ambiente hospedado e obter aceite do arquiteto/produto.

## Backups e restauração

Definir responsável, frequência, retenção, RPO e RTO com a operação antes de receber dados reais. Usar backups suportados pelo provedor e exportação SQL quando apropriado. Incluir no plano os usuários de autenticação, dados transacionais e, quando introduzidos, arquivos e segredos recuperáveis pelo canal seguro.

Ensaio: criar organização/loja fictícia e registrar contagens; fazer backup; restaurar em ambiente novo e isolado; conferir migrações, contagens, chaves e auditoria; executar suíte de isolamento e login real; registrar duração e perdas observadas. Nunca testar restauração sobre o ambiente de operação. Nenhuma restauração foi executada nesta entrega sem um projeto Supabase configurado.

## Evolução e reversão

A migração inicial é transacional. Em falha durante aplicação, PostgreSQL desfaz a transação. Após receber dados, preferir migração corretiva e restauração validada, preservando auditoria. Desativar lojas/membros via `active=false`; exclusões de entidades referenciadas são restritas. Mudanças administrativas devem usar identidade rastreável no processo de provisionamento; chamadas com service role sem sessão têm `actor_user_id=null` e origem `database`.

O aplicativo não grava senha, token ou conteúdo pessoal em logs próprios. Não introduzir logs de payloads completos. Política de retenção, procedimentos de direitos do titular e observabilidade operacional completa precisam ser fechados antes do piloto.
