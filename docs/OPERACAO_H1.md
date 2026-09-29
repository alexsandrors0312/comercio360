# Gate H1 — execução manual no Supabase descartável

Use apenas o projeto de desenvolvimento confirmado pelo operador. Nunca envie credenciais ao chat. Execute em PowerShell privado, sem transcrição, gravação de tela, `--debug` ou redirecionamento de saída de autenticação. Não altere o `.env.local`: ele deve conter apenas configuração pública da aplicação.

## 1. Conferir o histórico antes de qualquer escrita

Na pasta do projeto:

```powershell
Set-Location -LiteralPath 'C:\Users\Alexs\Desktop\Comercio360'
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Compartilhe somente a tabela Local/Remote e os nomes das migrações pendentes. Se houver pedido de senha de banco ou login administrativo, conclua pelo terminal/painel local. Não compartilhe URLs de conexão, tokens ou saída de debug. O vínculo esperado nesta homologação é `comercio360-dev`, referência pública `qiwblpmocldqbijbylwg`.

Banco vazio: devem estar pendentes `202609070001_foundation.sql` e `202609080001_tenant_key_guards.sql`, nessa ordem. Um banco com a fundação aplicada deve mostrar somente a segunda pendente. Qualquer histórico divergente exige conferência antes de continuar. `migration list` compara versões; não substitui conferir possíveis objetos criados manualmente no banco.

**Histórico conferido e alinhado:** o operador forneceu `202609070001` e `202609080001` em Local e Remote, com dry-run `Remote database is up to date.`. Não reaplicar migrações. Não usar reset remoto ou `migration repair`. Em nova divergência, interromper e investigar.

Com o histórico alinhado, aplicar o `supabase/seed.sql` já existente no projeto descartável:

```powershell
npx supabase@latest db push --linked --include-seed
```

O CLI respeita o histórico de migrações e inclui o seed configurado em `supabase/config.toml`. [Procedimento oficial](https://supabase.com/docs/guides/deployment/database-migrations). Confirme na saída a execução de `supabase/seed.sql` e a conclusão sem erro; uma mensagem isolada de banco atualizado não comprova o seed. Há [relato de versões anteriores que omitiam o seed sem migrações pendentes](https://github.com/supabase/cli/issues/4907). Se o CLI apenas informar banco atualizado, pare e retorne esse resultado para executarmos o mesmo arquivo pelo SQL Editor, sem criar ou reaplicar migrações. Se surgir proposta de aplicar qualquer migração nesta etapa, interrompa e confira o histórico novamente.

No painel Authentication do projeto, mantenha **Allow new users to sign up** desativado, confirme que **Anonymous Sign-Ins** está desativado e preserve login por e-mail/senha. O `config.toml` controla o Supabase local; `db push` não sincroniza essas configurações do Auth hospedado. A nova leitura pública confirmou cadastro desativado e e-mail habilitado. O endpoint não informou o estado de login anônimo; confirmar esse item no painel.

## 2. Preparar as quatro contas fictícias

Somente após ambas as migrações e o seed SQL estarem confirmados:

```powershell
powershell -NoProfile -File .\scripts\h1-manual.ps1 -Phase Seed
```

O roteiro pede a URL conferida separadamente no painel, confirmação do histórico, chave administrativa e senha das contas (12+ caracteres). Os dois últimos valores têm entrada oculta e permanecem em memória/ambiente do processo. Ele executa `node --env-file=.env.local scripts/seed-users.mjs`, o mesmo programa usado por `npm run seed:users`, com o guard existente. O argumento `--env-file` é passado diretamente ao Node; não pode ser colocado em `NODE_OPTIONS`. Diagnósticos brutos são suprimidos, falhas não produzem mensagem de sucesso e variáveis administrativas são limpas em `finally`. O roteiro não altera `NODE_OPTIONS` do operador. O seed aceita somente `example.test` e preserva senhas de contas preexistentes; use a senha já escolhida se for uma reexecução. Em falha, não execute a próxima fase. Informe apenas a etapa que falhou para prepararmos diagnóstico sanitizado.

Se a tentativa anterior parou com `--env-file= is not allowed in NODE_OPTIONS`, o programa de seed não chegou a iniciar nessa tentativa. Após a correção do roteiro, repita somente `-Phase Seed`, mantendo a confirmação de histórico e seed SQL já executados. Esse erro não exige reaplicar migrações ou executar novamente o seed SQL.

Se aparecer `H1-SEED-...`, retorne somente esse código e a descrição fixa. A captura de saída agora ocorre no processo filho, preservando o código de saída mesmo se Node/SDK escreverem em stderr. Conteúdo bruto não é exibido nem salvo. A URL de confirmação deve ser preenchida no terminal a partir do painel; campo vazio interrompe antes de solicitar chave/senha. A listagem administrativa verifica acesso ao Auth e a leitura de empresas/lojas confere os IDs fictícios do seed SQL antes da primeira criação de usuário.

| Código | Significado / próximo passo |
| --- | --- |
| `H1-SEED-21` | URL pública não configurada |
| `H1-SEED-22` | Confirmação da URL não preenchida |
| `H1-SEED-23` | Origem inválida ou confirmação divergente; conferir separadamente no painel |
| `H1-SEED-24` | Chave administrativa não preenchida |
| `H1-SEED-25` | Senha com menos de 12 caracteres |
| `H1-SEED-61` | Listagem administrativa recusada; conferir chave e projeto no terminal |
| `H1-SEED-53` | Tabela não encontrada na API durante conferência do seed; investigar sem reaplicar migrações |
| `H1-SEED-57` | Empresas/lojas fictícias não encontradas; conferir execução do seed SQL |
| `H1-SEED-76` | Política do Auth recusou a senha; escolher outra localmente |
| Demais códigos | A descrição fixa informa a etapa: cliente, seed SQL, Auth, perfil, vínculo ou acesso; pode haver escrita parcial nas etapas posteriores à criação do usuário |
| `H1-SEED-RUNTIME` | Não foi possível obter diagnóstico do programa; conferir Node, dependências e configuração sem presumir sucesso ou ausência de escritas |

O erro genérico da versão anterior não permite determinar a causa nem afirmar se houve alguma escrita. Não avance para Verify até obter PASS da fase Seed. As regras de confirmação de destino e restrição a `example.test` permanecem obrigatórias; não compartilhe valores privados para investigar uma falha.

O roteiro não aplica migrações nem deriva automaticamente a confirmação da URL de destino. Não coloque senhas literais em comandos, pois o histórico do PowerShell pode persistir esses comandos.

## 3. Executar a homologação hospedada separada

Requer dependências instaladas, `npm run build` concluído com a configuração pública desse projeto e Chromium instalado. Deixe a porta 3002 livre. Os testes simulados continuam em `tests/e2e`, sem alteração.

```powershell
# Nesta máquina, o Chromium validado está neste cache:
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\Alexs\Documents\Codex\2026-09-07\files-mentioned-by-the-user-arquitetura\work\browsers'
powershell -NoProfile -File .\scripts\h1-manual.ps1 -Phase Verify
```

Em outra máquina, instale Chromium normalmente e use seu cache. A fase Verify solicita novamente os valores privados, executa `tests/hosted/h1.mjs` e grava somente nomes fixos de verificações e PASS/FAIL em `docs/H1_RESULTADOS.json`. Não grava storageState, HAR, vídeo, screenshot, trace, JWT ou resposta bruta de API. Não use `DEBUG` nem recursos de gravação durante a execução.

O teste inicia e encerra seu próprio servidor Next de produção em loopback na porta 3002, removendo variáveis administrativas do ambiente antes de criar os processos web/navegador. REST/RPC de isolamento usam a chave pública e JWT de cada usuário. A chave administrativa serve apenas para preparar/restaurar fixtures, verificar triggers e inspecionar auditoria; nunca é usada para afirmar que RLS passou.

O teste altera temporariamente nome, papel, ativação e acessos das contas fictícias; cria um vínculo temporário Aurora→Horizonte, primeiro sem loja, depois com B1 para conferir auditoria entre empresas. Restaura os vínculos/acessos em `finally` e preserva eventos de auditoria. Execute sozinho nesse ambiente. Uma falha interrompe as próximas verificações, registra FAIL e tenta restaurar as fixtures. Se o processo for encerrado à força ou a rede falhar durante a restauração, revise o estado administrativo antes de reexecutar. Nenhuma auditoria é apagada.

O teste de expiração **aguarda o vencimento natural** do JWT (até 75 minutos de validade restante, normalmente aproximadamente uma hora), com mensagem de espera a cada 30 segundos. Não altera configurações de tempo do projeto ou do computador. Depois confirma que o token antigo recebe 401 e que o navegador renova a sessão ao recarregar, com novo cookie. Não interrompa essa espera se desejar evidência de expiração real.

Correção de 10/09: a espera agora inclui a tolerância de 30 segundos documentada pelo PostgREST mais cinco segundos de margem, usando Date HTTP para estimar a diferença de relógio. A versão anterior verificava apenas cinco segundos após o vencimento e podia falhar dentro da tolerância legítima. Header de data ausente ou diferença acima de dois minutos interrompe a etapa para diagnóstico; o relógio do computador e a validade dos tokens não são alterados. [Referência PostgREST](https://postgrest.org/en/stable/references/auth.html).

O relatório separa a espera, a recusa dos dois JWTs antigos, o destino da navegação e a renovação do cookie. Registra somente HTTP status, categorias fixas, diferença aproximada de relógio e booleanos. Um 401 genérico não comprova expiração; 200 após a janela continua sendo falha. Se uma verificação HTTP falhar, as demais observações de expiração são coletadas, mantendo o Gate reprovado. As observações nunca contêm tokens, cookies, respostas brutas ou URLs. A tentativa anterior foi arquivada em `docs/H1_RESULTADOS_2026-09-10_expiracao_pendente.json`; não a apague nem converta resultados para PASS manualmente.

O Supabase revoga refresh tokens no logout, mas um access JWT emitido pode continuar válido até expirar. A suíte distingue esse comportamento da recusa de `/app` depois do logout no navegador. Referência: [Supabase — sign out](https://supabase.com/docs/guides/auth/signout).

Limite: Next é acessado por HTTP em loopback; o Supabase por HTTPS. A configuração de cookie Secure sob HTTPS da própria aplicação continua a exigir ambiente HTTPS dedicado antes de publicação. Um PASS do roteiro não é aprovação arquitetural nem autorização do Pacote 002.

## 4. Retorno e entrega

Informe apenas a conclusão das fases e o caminho `docs/H1_RESULTADOS.json`. O arquivo contém somente evidência sanitizada. A revisão consolidará os resultados em `docs/ENTREGA_H1.md`, incluindo histórico remoto, limites, falhas e parecer. Só então gerar o ZIP final integral, excluindo `.env*` (exceto exemplo sem credenciais), `.git`, `.next*`, `node_modules`, `supabase/.temp`, caches, relatórios de navegador e qualquer segredo.

## Última execução registrada

Verify concluiu com **36 PASS / zero FAIL**, em 2026-09-11T00:29:31.252Z (10/09, 21:29 de Brasília), incluindo as cinco observações de expiração. O relatório consolidado está em `ENTREGA_H1.md`; a evidência anterior permanece arquivada. A revisão arquitetural e a confirmação do login anônimo desativado no painel continuam pendentes. A correção separada H1-DEP-01 atualizou somente dependências de teste; lint, tipos, 90 testes, build, 11 E2E e auditoria completa passaram.
