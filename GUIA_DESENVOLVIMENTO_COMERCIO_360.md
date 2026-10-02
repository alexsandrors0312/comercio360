# Comércio 360 — guia de continuidade do desenvolvimento

**Estado conferido em 24/09/2026.** Este guia descreve a entrega disponível no projeto `C:\Users\Alexs\Desktop\Comercio360` e a evidência produzida até 10/09/2026. Use-o ao iniciar uma nova tarefa com a pasta ou o ZIP do projeto. Ele registra o trabalho realizado; não substitui a revisão arquitetural que ainda falta.

## 1. Estado em uma página

| Tema | Estado |
| --- | --- |
| Aplicação | Versão **0.1.1**, Pacote 001 + corretivo 001.1; fundação executável |
| Banco | Duas migrações aplicadas no Supabase descartável de desenvolvimento; Local e Remote alinhados |
| Seed fictício | Duas organizações, três lojas e quatro contas `example.test` preparados |
| Gate H1 hospedado | **36 verificações PASS, zero FAIL**; relatório mantém o estado `TESTES_PASSARAM_REVISAO_PENDENTE` |
| Testes após correção técnica | Lint, tipos e build PASS; **90 testes unitários/SQL PASS**, **11 E2E PASS**, auditoria npm completa com **zero vulnerabilidades** em 10/09/2026 |
| Correção técnica | Vitest e `@vitest/mocker` **4.1.11**; versão da aplicação e dependências de produção preservadas |
| Aprovação arquitetural | **Pendente**; Pacote 002 permanece bloqueado |
| Publicação | Não realizada; operação com dados reais não homologada |

O artefato congelado para revisão é `comercio360-h1.zip`, SHA-256 `F1BEE053725F261551331E3CE0FBCB27835593C28B58E720F50C074FBA3024E0`. A conferência atual confirmou a existência desse ZIP, da pasta do projeto, das duas migrações, da versão 0.1.1, de Vitest 4.1.11 e dos 36 registros PASS. Os resultados de lint, testes, build, E2E e auditoria são os da execução documentada em 10/09; **não foram reexecutados em 24/09**.

## 2. O que foi construído

A aplicação é um **monólito modular** em Next.js 16.3.4, React 19, TypeScript e Supabase/PostgreSQL. Tem interface em português, login por e-mail/senha, seleção autorizada de organização e loja, proteção de rotas e ações no servidor, RLS no banco e auditoria. O painel autenticado mostra indicadores fictícios; as áreas comerciais futuras mostram “Em construção”. A rota `/demo` é uma prévia pública com mocks e não concede acesso à área autenticada. A operação é online, sem funcionamento offline implementado.

O modelo de identidade tem `auth.users` no Supabase, `profiles` como identidade global, `memberships` por organização e `user_store_access` por loja. Uma pessoa pode pertencer a várias organizações, mas só pode operar nas lojas explicitamente autorizadas. O papel de gerente ou proprietário não elimina a exigência de acesso à loja. `organizations` é a raiz do tenant; as relações estruturais entre loja, vínculo e acesso permanecem na mesma organização por chaves compostas. A seleção de loja usa a RPC autorizada `set_active_store`; as demais escritas de provisionamento ficam no canal administrativo.

O Pacote corretivo 001.1 resolveu estes pontos:

1. **Contexto multiempresa:** o seletor mostra apenas organizações com ao menos uma loja ativa autorizada. Um vínculo ativo sem loja não cria opção vazia. Se houver outra organização com loja, ela continua utilizável; sem lojas em qualquer organização, o destino é `/sem-acesso`. Cookie antigo ou adulterado não amplia acesso.
2. **Chaves de tenant:** a migração incremental impede alterações efetivas em `organizations.id`, `stores.id/organization_id`, `memberships.id/organization_id/user_id` e `user_store_access.id/organization_id/membership_id/store_id`, inclusive em DML administrativo. Transferências futuras precisam de operação explícita; por enquanto, desativa-se/cria-se o registro, ou revoga-se/remove-se/cria-se novamente o acesso à loja.
3. **Auditoria:** o tenant declarado em `old_value` e `new_value` precisa coincidir com o evento. Ao trocar de organização, o evento da nova empresa não recebe o estado anterior da outra. Eventos são preservados; uma inconsistência histórica faz a migração falhar atomicamente.
4. **Seed de usuários:** exige `ALLOW_DEVELOPMENT_SEED=yes`, confirmação independente da URL de destino e domínio exato `example.test` antes de acessar a API. Reexecuções preservam senhas existentes. O wrapper administrativo passa `--env-file=.env.local` diretamente ao Node e apresenta apenas códigos de diagnóstico sanitizados.
5. **Autorização por requisição:** `requireAccess` usa `React.cache` durante a renderização da mesma requisição. Páginas, Server Actions e RLS continuam validando acesso; não existe cache compartilhado de permissão entre usuários.

As migrações existentes são `supabase/migrations/202609070001_foundation.sql` e `supabase/migrations/202609080001_tenant_key_guards.sql`. No projeto hospedado de desenvolvimento, o operador apresentou as versões `202609070001` e `202609080001` em **Local e Remote**, e `db push --dry-run` indicou banco atualizado. **Não reaplique, reescreva, repare ou resete esse histórico sem uma nova análise específica.**

## 3. Gate H1: o que foi comprovado e o que não foi

O operador executou a homologação em Supabase hospedado descartável. Os **36 testes** cobriram login real das quatro contas, senha inválida, renovação de sessão, matriz de acesso por empresa/loja, RLS em consultas e escritas, tentativas de alteração de dez campos estruturais, auditoria, revogação de loja e vínculo, cookie adulterado, logout, expiração natural de JWT e renovação do cookie no navegador. Os JWT antigos da API e do navegador foram recusados com **HTTP 401 / `jwt_expired`** depois da tolerância do PostgREST; o navegador voltou à área autorizada com **HTTP 200** e cookie renovado. A execução registrou **zero FAIL**.

Uma tentativa anterior teve 31 PASS e uma falha composta de expiração. Ela continua arquivada sem mudança dos resultados. O teste esperava recusa cinco segundos após o vencimento, dentro da tolerância documentada de 30 segundos. A causa exata da falha daquela execução não pôde ser recuperada; o teste foi corrigido para esperar a tolerância, registrar verificações separadas e manter critério estrito de `jwt_expired`. A reexecução passou.

O servidor Next do teste hospedado foi acessado por **HTTP local**, enquanto o Supabase estava em HTTPS. O comportamento do cookie Secure sob **HTTPS da própria aplicação** ainda precisa ser validado no ambiente de implantação antes da publicação. O endpoint público confirmou cadastro público desativado e login por e-mail habilitado; a **desativação de login anônimo no painel ainda não recebeu confirmação explícita do operador**. Não deduza esse estado do cadastro público desativado. Backups, restauração, carga, ambiente de produção e dados reais também não foram homologados.

Os testes locais E2E usam API Auth simulada e PGlite; servem para regressão da interface e das regras. Os 36 testes hospedados são a evidência separada de Supabase real. A correção posterior de Vitest alterou apenas ferramentas de teste; não houve nova execução administrativa hospedada depois dessa troca.

## 4. Arquivos para ler primeiro na nova tarefa

1. `docs/ENTREGA_H1.md` — parecer consolidado, resultados, limites e pendências.
2. `docs/H1_RESULTADOS.json` — evidência sanitizada original dos 36 PASS. Preserve o conteúdo e o status de revisão pendente.
3. `docs/architecture/ARQUITETURA.md` e `docs/adr/ADR-0009-fundacao-identidade-acesso.md` — desenho da fundação e decisões de identidade/tenant. As frases antigas sobre H1 “pendente” nesses documentos são **históricas**; use `ENTREGA_H1.md` para o estado dos testes hospedados.
4. `docs/DECISOES_PILOTO.md` — decisões de produto aprovadas, ainda sem implementação dos módulos futuros.
5. `README.md`, `docs/OPERACAO_H1.md` e `docs/OPERACAO.md` — execução local, roteiro administrativo e limites operacionais.
6. `docs/CORRECAO_TECNICA_H1.md` e `.patch` — atualização separada de Vitest e lockfile.
7. `docs/ENTREGA.md` — entrega histórica do corretivo 001.1, antes do H1; não a trate como parecer final.

Pastas principais: `app/` contém rotas e ações; `lib/` contém acesso e adaptadores Supabase; `packages/domain/` contém regras puras; `packages/validation/`, `packages/ui/` e `packages/config/` separam validação, interface e navegação; `supabase/` contém migrações e seed; `tests/` contém testes de domínio, SQL, wrappers, E2E e homologação hospedada; `docs/` registra decisões e evidências.

## 5. Por onde continuar

**Primeiro, fazer a revisão arquitetural da entrega H1.** Compare a pasta anexada com o ZIP final, confira `docs/ENTREGA_H1.md` e `docs/H1_RESULTADOS.json`, e registre um parecer claro: aprovado, aprovado com condições ou ajustes necessários. Confirme com o operador no painel Supabase se o login anônimo está desativado. Essa confirmação é uma informação de configuração, não exige compartilhar senha, chave ou token. Não reexecute seed nem migração para fazer a revisão.

**Depois, fechar critérios operacionais que ainda faltam para publicar:** teste do aplicativo sob HTTPS próprio e cookie Secure, plano de backup/restauração, operação em ambiente separado e decisão sobre a loja participante do piloto. Nem todos precisam ser realizados antes de um novo pacote de desenvolvimento, mas devem constar como limites de implantação. Não marque como aprovados por inferência.

**Somente após a revisão arquitetural liberar o Pacote 002**, definir seu escopo e seus critérios de aceite antes de codificar. Há decisões de direção: nome **Comércio 360**, nicho **moda e acessórios**, piloto com **uma loja** preservando a arquitetura multiloja, canais futuros **balcão e WhatsApp**, e motoristas/veículos exclusivos de cada organização. A loja participante e os detalhes do sistema fiscal/maquininha ainda precisam ser levantados. Essas decisões não autorizam, por si só, implementar catálogo, estoque, fornecedores, PDV, pagamentos, fretes, WhatsApp operacional ou mídias sociais. O próximo pacote deve vir de uma especificação e aprovação arquitetural próprias, com regras de tenant, permissões, auditoria, migrações incrementais e testes correspondentes.

Para qualquer trabalho de código autorizado, comece conferindo a árvore e o estado real do projeto anexado, leia `AGENTS.md` e os documentos relevantes do Next instalado, estabeleça um baseline e mantenha as mudanças restritas ao pacote aprovado. Preserve dados e histórico hospedados. Ao alterar dependências, migrações ou contratos de autenticação, explique o motivo e a compatibilidade antes da execução. Rode as verificações aplicáveis e atualize os relatórios com resultados reais, sem converter pendências em PASS por redação.

## 6. Execução e proteção de credenciais

Para a base atual, o `README.md` exige Node.js 22.12+ e npm; a última validação documentada usou Node 24.13.1. Em PowerShell, a rotina local é:

```powershell
Set-Location 'C:\Users\Alexs\Desktop\Comercio360'
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Instale Chromium com `npx playwright install chromium` se o cache não estiver disponível. Os E2E usam as portas locais 3001 e 54329. No Windows gerenciado anterior, as 11 asserções passaram, mas o encerramento automático aguardou; os dois servidores de teste identificados pelas portas foram encerrados antes de o Playwright retornar código zero. Não encerre processos desconhecidos.

Para uma demonstração sem banco, execute `npm run dev` e acesse `/demo`. A autenticação real precisa de `.env.local` com URL e chave **publicável** do projeto. **Não anexe `.env.local`, chave administrativa, senhas, tokens, diretórios `.git`, `.next*`, `node_modules` ou `supabase/.temp` ao novo chat.** O ZIP `comercio360-h1.zip` já foi preparado sem esses itens e pode ser usado como cópia limpa da entrega. Se optar por anexar a pasta da Área de Trabalho, remova esses itens da cópia anexada; mantenha o projeto original intacto.

O script `scripts/h1-manual.ps1` solicita segredos em entrada oculta somente no terminal do operador. Nunca coloque senhas literais em comandos, histórico do PowerShell, documentação ou conversa. Não peça valores de chaves/tokens pelo chat. Resultados compartilháveis: versões Local/Remote, mensagens PASS/FAIL sanitizadas e os relatórios já preparados.

## 7. Critério para encerrar a próxima revisão

A nova tarefa pode encerrar a **revisão H1** quando houver parecer baseado no ZIP, em `ENTREGA_H1.md` e em `H1_RESULTADOS.json`; a configuração de login anônimo estiver confirmada ou explicitamente registrada como condição; e riscos de implantação restantes estiverem separados dos defeitos da fundação. Até esse parecer, o estado correto é: **testes hospedados aprovados, revisão arquitetural pendente, Pacote 002 bloqueado**.
