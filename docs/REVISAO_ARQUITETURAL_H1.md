# Revisão arquitetural H1 — fundação Comércio 360

Revisão iniciada em 25/09 e consolidada em **26/09/2026 (America/Sao_Paulo)**. Aplicação **0.1.1 / Pacote 001.1**.

## Parecer e alcance

**Aprovado com condições para continuidade do desenvolvimento.** A inspeção do código e das migrações, a comparação com o artefato congelado e a evidência hospedada sustentam a fundação multiempresa/multiloja. Não foi identificado defeito crítico ou alto que exija alteração da fundação para especificar o próximo módulo.

Esta revisão libera **a definição e revisão do escopo do Pacote 002**. Não aprova automaticamente sua implementação: campos, permissões, contratos, migração incremental e critérios de aceite próprios precisam ser aceitos. A proposta concreta está em [PACOTE_002_CATALOGO_PROPOSTA.md](PACOTE_002_CATALOGO_PROPOSTA.md).

Publicação e uso de dados reais continuam sem homologação. Login anônimo desativado, cookies sob HTTPS próprio, recuperação e ambiente de produção separado são condições explícitas abaixo. Não foram marcados como PASS por inferência.

## Integridade do material revisado

Artefato: `C:\Users\Alexs\Documents\Codex\2026-09-07\files-mentioned-by-the-user-arquitetura\outputs\comercio360-h1.zip`.

- SHA-256 confirmado: `F1BEE053725F261551331E3CE0FBCB27835593C28B58E720F50C074FBA3024E0`.
- **78 arquivos do ZIP coincidiram byte a byte** com a pasta `C:\Users\Alexs\Desktop\Comercio360` antes das alterações documentais desta revisão.
- Nenhuma entrada com caminho absoluto, unidade ou travessia `..`. Não há `.env` real, `.git`, `node_modules`, `.next*` ou `supabase/.temp` no ZIP; `.env.example` é o modelo permitido.
- Pasta atual sem repositório Git. A comparação utilizou o ZIP e hashes de conteúdo; não há diff Git disponível.
- `package.json` confirma versão 0.1.1, Next 16.3.4 e Vitest 4.1.11. Instalação por `npm ci`, preservando o lockfile e todas as versões fixadas.

| Arquivo preservado | SHA-256 |
| --- | --- |
| `docs/H1_RESULTADOS.json` | `0C3952991A0063461E3AE7F3589DC7E2ACFB9C64D78C0847F561CEDD27C3A79C` |
| `supabase/migrations/202609070001_foundation.sql` | `39C5E858C3F1EFBE59963B5420C112B0B67D40D6E45956BEF36C1EE6DA7DA4E4` |
| `supabase/migrations/202609080001_tenant_key_guards.sql` | `E5AB4D3DFAA01D06484F2A0CA8879111CF6BF9410D03B50F547DB43E84257091` |
| `package-lock.json` | `2CF95AD85F559085119F05CF159C37D37393654E61DA14C5FB43372C30982263` |

O ZIP, `ENTREGA_H1.md`, as bases históricas e os dois JSONs hospedados não foram reescritos. Este parecer é um documento novo: o status original `TESTES_PASSARAM_REVISAO_PENDENTE` em `H1_RESULTADOS.json` continua descrevendo a evidência da execução de 10/09, sem transformação retroativa de resultados.

Conferência final: **74 dos 78 arquivos originais permanecem idênticos**. As quatro diferenças intencionais são README, changelog, arquitetura implementada e ADR-0009, atualizados apenas para apontar o parecer atual. Foram adicionados este parecer e a proposta do catálogo. `next-env.d.ts`, regenerado pelos comandos de validação, foi restaurado byte a byte do ZIP ao limpar os artefatos temporários. Código funcional, configuração, testes, migrações, seed e dependências permaneceram iguais ao artefato revisado.

## Fundamentação da revisão

| Tema | Evidência inspecionada | Conclusão |
| --- | --- | --- |
| Limites modulares | `app`, `lib`, pacotes de domínio/validação/UI/configuração e `mocks` | Monólito modular aderente; regra pura de contexto sem Supabase ou mocks |
| Autenticação e sessão | `lib/supabase/server.ts`, `proxy.ts`, rotas e actions | `getUser()` no servidor; refresh no proxy; páginas/actions não dependem só do layout |
| Autorização por requisição | `lib/tenancy.ts` e páginas protegidas | `React.cache` limita repetição na renderização; sem cache persistente de permissões |
| Multiempresa/multiloja | Domínio, RLS, memberships e acessos explícitos | Empresa sem loja autorizada é omitida; cookie é indicação de contexto e não fonte de permissão |
| Integridade estrutural | Duas migrações e testes SQL | Chaves compostas mantêm relacionamentos no tenant; guard protege dez campos, inclusive DML administrativo comum |
| RLS e privilégios | Seis tabelas, grants, políticas e funções | `anon` sem leitura; usuário com SELECT restrito e RPC específica; runtime web sem chave administrativa |
| Auditoria | Triggers, RPC e restrição de snapshots | Ator derivado da sessão; eventos append-only; tenant coerente; troca de empresa não copia estado anterior de outra |
| Seed administrativo | Guard, programa, wrapper e testes | Confirmação independente de destino, flag, domínio exato e preservação de senhas; diagnósticos sanitizados |
| Interface e demonstração | Shell, dashboard, rotas demo e testes E2E | Referência visual mantida; dados fictícios identificados; onze módulos futuros permanecem Em construção |
| Operação | Entrega, operação e roteiro H1 | Histórico hospedado declarado alinhado; nenhuma reaplicação, reset, seed ou chamada administrativa nesta revisão |

Foram consultados os guias **da instalação Next 16.3.4** em `node_modules/next/dist/docs/01-app/`: `02-guides/authentication.md`, `02-guides/data-security.md`, `03-api-reference/03-file-conventions/proxy.md` e `03-api-reference/04-functions/cookies.md`. A implementação usa `proxy.ts`, cookies assíncronos e validação nas actions de acordo com esses contratos. O proxy não é considerado a única barreira de autorização.

A evidência de banco não implica resistência ao proprietário do banco que possa desativar triggers ou alterar DDL. O controle administrativo é um limite de confiança; o endurecimento cobre DML normal, como declarado no corretivo.

## Evidência hospedada preservada

`ENTREGA_H1.md` e `H1_RESULTADOS.json` registram **36 PASS, zero FAIL**, produzidos em `2026-09-11T00:29:31.252Z`. Foram conferidos os 36 registros e a correspondência com o roteiro hospedado, incluindo matriz de acesso, RLS usando JWT de usuário, dez chaves estruturais, revogação, auditoria, expiração e renovação.

O relatório mantém HTTP 401 / `jwt_expired` para os dois tokens antigos e HTTP 200 com cookie renovado no navegador. A falha anterior e sua análise continuam arquivadas. A distinção entre Auth real hospedado e Auth simulado local está preservada.

Não houve nova execução hospedada nesta revisão. A declaração de migrações Local/Remote alinhadas provém da evidência sanitizada do operador de H1, sem consulta atual ao banco. Nenhum acesso ao painel Supabase ou confirmação de configurações remotas foi realizado pelo agente.

## Verificações locais desta revisão

Ambiente: Windows, Node **24.13.1**, npm **11.8.0**. Execuções entre 25/09 e 26/09/2026, conforme horário local.

| Comando | Resultado desta revisão |
| --- | --- |
| `npm ci` | PASS, 399 pacotes; versões e lockfile preservados |
| `npm run lint` | PASS, código 0 |
| `npm run typecheck` | PASS, código 0 |
| `npm test` | **90/90 PASS**, sete arquivos, código 0 |
| `npm run build` | PASS, Next 16.3.4, código 0 |
| `npm audit --json` | PASS, zero vulnerabilidades reportadas, produção/desenvolvimento, código 0 |
| `npm run test:e2e` | **11/11 PASS**, 3,6 minutos, código 0 após encerrar somente os auxiliares identificados |

As duas tentativas de instalação restrita falharam: acesso ao npm/cache recusado (`EACCES`) e diagnóstico `Exit handler never called`. A instalação com acesso de rede autorizado concluiu usando o lockfile. A primeira tentativa E2E terminou com **11 falhas de inicialização**, todas pelo executável Chromium headless shell v1243 ausente, sem executar as asserções dos cenários. Não são PASS nem defeitos funcionais demonstrados. O cache prévio tinha v1234.

A instalação do navegador v1243 encontrou `ENOSPC`. O cache npm temporário criado por esta revisão foi removido; a instalação do navegador então concluiu. Não foram removidos arquivos pessoais, caches anteriores do usuário ou fontes do sistema. Os auxiliares das duas execuções foram identificados pelas portas 3001/54329, horário de criação e comando antes do encerramento; o teardown no Windows ficou aguardando como na execução histórica. A segunda execução concluiu com **11 passed e código 0**, sem mudança de configuração ou asserção.

Na execução aprovada, o servidor de desenvolvimento registrou um `ECONNRESET`/requisição abortada e avisos de cores de terminal; todos os cenários passaram. Isso foi tratado como observação de ambiente, sem alegar que os logs foram silenciosos. Os artefatos descartáveis de build/teste gerados nesta revisão foram removidos ao final para recuperar espaço, mantendo fontes, dependências instaladas e documentação.

Os 90 testes exercitam migrações em PGlite, regras e scripts com fixtures. Os E2E usam Auth simulado e PGlite. Esses resultados não substituem Supabase hospedado, HTTPS próprio ou dados reais.

## Condições e acompanhamento

| Condição | Estado confirmado | Critério para concluir | Implicação |
| --- | --- | --- | --- |
| Login anônimo do Supabase | Operador respondeu **“Ainda não conferi”** nesta tarefa | Conferir no painel do projeto e registrar confirmação de desativação, sem compartilhar segredos | Condição aberta de configuração; cadastro público desativado não a comprova |
| HTTPS e cookies | H1 utilizou Next em HTTP local | Login, seleção de loja, persistência, renovação e logout sob domínio HTTPS próprio; verificar atributos dos cookies de sessão e contexto, inclusive Secure | Bloqueia publicação; loopback HTTP não homologou esse comportamento |
| Backup/restauração | Nenhum ensaio homologado | Definir responsável, frequência/retenção, RPO/RTO e restaurar em ambiente novo, conferindo Auth, dados, chaves, auditoria e isolamento | Bloqueia dados reais |
| Ambiente de produção | Desenvolvimento descartável; sem implantação homologada | Separar produção/desenvolvimento, conferir Auth, URLs, segredos por canal seguro e histórico incremental | Bloqueia publicação/dados reais |
| Loja participante | Uma loja de moda/acessórios escolhida como direção, identidade pendente | Produto identifica comerciante e valida o fluxo real; não reutilizar seed como escolha de piloto | Bloqueia aceite operacional do piloto |
| Administração rastreável | Service role sem sessão pode gerar ator nulo, limite documentado | Procedimento registra operador responsável, motivo e execução sem segredos em logs | Condição antes de provisionamento de operação real |

Backlog de baixa prioridade preservado: foco/contenção/retorno de foco no menu móvel, CSP/HSTS adequados à implantação, acessibilidade prática além das asserções de largura e atualização planejada do ESLint. `npm ci` repetiu aviso de ESLint 9.39.5 sem suporte; auditoria reportou zero vulnerabilidades. Troca de dependências não foi incluída nesta revisão.

## Continuidade concreta

O parecer conclui a revisão arquitetural H1 com condições explícitas. Não é uma declaração de sistema pronto para produção. O próximo entregável é o aceite da proposta de Catálogo: categorias, produtos, variantes, preços por loja e capa privada, com contratos de tenant, papéis, auditoria e testes.

Após aceite, registrar ADR e implementar em pacote próprio, preservando as migrações existentes e as evidências H1. Homologação do catálogo deve ter relatório novo e ambiente descartável identificado. Este documento substitui **somente o estado atual de revisão** citado como pendente nos documentos históricos; não altera suas execuções ou conclusões da época.
