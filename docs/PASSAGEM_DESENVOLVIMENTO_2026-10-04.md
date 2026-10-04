# Comércio 360 — passagem de desenvolvimento em 04/10/2026

Este arquivo encerra a seção de trabalho da Fundação 001.1 e do Catálogo 002 em **homologação** e orienta a próxima seção. Antes de agir, ler `AGENTS.md`, `context.md`, conferir `git status`, `git log -1` e confrontar este retrato com código, migrações, ambiente e evidências atuais. Nenhum resultado antigo deve ser convertido em PASS por redação.

## Etapa e percentual

**Etapa atual: 2 — núcleo comercial, iniciada pelo Catálogo.** A fundação técnica da etapa 1 está implementada. A descoberta da etapa 0 ainda precisa identificar a loja piloto e levantar o processo real. Estoque, fornecedores e venda básica, que completam a etapa 2, não foram entregues. As etapas 3–6 (omnichannel/logística, marketing, financeiro/gestão e escala) não começaram como módulos operacionais. Fonte do roteiro: `docs/architecture/BASE_v0.3.md`, seção 13.

**Estimativa de avanço da visão do produto: cerca de 20% (faixa indicativa de 15–25%).** Critério: sete etapas do roteiro, com descoberta parcial, fundação implementada, apenas uma parte do núcleo comercial implementada e etapas posteriores ainda em especificação. É uma avaliação de planejamento, **não** uma medição de esforço, prazo, cobertura ou aceite de todo o MVP. A proposta do Pacote 002 foi aceita integralmente, e seu fluxo principal foi homologado; isso não torna o projeto completo nem libera operação real.

| Marco | Estado em 04/10 | Próxima decisão ou prova |
| --- | --- | --- |
| 0 — descoberta | Nicho moda/acessórios e piloto de uma loja definidos; loja e processos reais pendentes | Identificar loja, fluxo de balcão/WhatsApp e dependências fiscal/maquininha |
| 1 — fundação | Auth, organização/loja, papéis, RLS, auditoria e layout integrados; H1 36 PASS e parecer aprovado com condições | Fechar condições operacionais antes de dados reais |
| 2 — núcleo comercial | Catálogo 002 implementado e homologado no desenvolvimento | Definir e aceitar um pacote seguinte; estoque, fornecedores e venda não estão prontos |
| 3–6 — demais etapas | Navegação/previsão de produto; módulos comerciais não operacionais | Descoberta, contratos, autorização e entregas próprias |

## Escopo que existe de fato

- Versão do app `0.1.1`; `main` estava limpa em 04/10, HEAD `7c0f95a` e `origin/main` no mesmo commit antes deste documento. Revalidar antes de continuar.
- Next.js 16.3.8, React 19, TypeScript, Supabase/PostgreSQL, OpenNext/Cloudflare. `app/` contém rotas e actions; `lib/`, adaptadores e acesso; `packages/`, domínio, validação, configuração e interface; `supabase/`, migrações; `tests/`, provas. Consultar `docs/architecture/ARQUITETURA.md` e `docs/ai/REPOMAP.md`.
- Fundação: login por e-mail, seleção de organização e loja autorizadas, isolamento de tenant por RLS e chaves compostas, auditoria append-only e verificações no servidor. A chave administrativa não pertence ao Worker web.
- Catálogo: categorias, produtos, variantes/SKU, preço BRL por loja, busca/filtro e capa opcional privada. `app/api/catalog/images/[productId]/route.ts` usa processamento de imagem com binding Cloudflare em homologação e atestado HMAC; Storage permanece privado. O Worker separado `comercio360-catalog-cleanup-dev` limpa objetos pendentes com Cron `*/15 * * * *`.
- `/app/produtos` é o módulo comercial funcional. Visão Geral usa indicadores fictícios identificados; `/demo` é prévia pública; vendas/PDV, pedidos, estoque, compras/fornecedores, clientes/CRM, entregas/fretes, marketing, financeiro e relatórios exibem “Em construção”. Não inferir funcionalidade pelo item de navegação.
- O contrato aceito está em `docs/PACOTE_002_CATALOGO_PROPOSTA.md` e ADR-0010. Estoque, compras, PDV, pagamento, fiscal, logística e WhatsApp operacional ficaram fora do Pacote 002. A proposta de novo módulo precisa de escopo e aceite próprios.

## Ambientes e evidências conferidas

| Área | Resultado comprovado | Limite |
| --- | --- | --- |
| Supabase | `comercio360-dev` com as duas migrações H1 e cinco do Catálogo até `202610030001_catalog_conflict_http.sql` alinhadas em Local/Remote; bucket privado e contas fictícias `example.test` | Não há projeto de produção separado confirmado. Não reaplicar, reescrever ou reparar migrações existentes |
| Testes locais | Vitest 143/143; lint 0 erros e 1 aviso histórico H-04; tipos e build Next PASS; build OpenNext Linux PASS; `npm audit --omit=dev` sem vulnerabilidades | Último Playwright local mostrou 17 casos OK mas travou no teardown e terminou inconclusivo; execução anterior de 03/10 foi 17/17 PASS antes do ajuste de origem |
| App publicado | `https://comercio360.alexsandrors-0312.workers.dev`, homologação no plano Cloudflare Free ligada ao Supabase dev. HTTP→HTTPS 308, login HTTPS 200. Build funcional `#9a188a00` publicou `9695ffd`; build posterior `#90b80e57` publicou `7c0f95a` segundo a verificação da sessão anterior | Verificar hash/build atual antes de novo ensaio; não usar dados reais |
| Ensaio HTTPS | `scripts/cloudflare-https.ps1` concluiu 16 linhas PASS/exit 0: login, cookies Secure, duas lojas, persistência, capa JPEG sem EXIF no Storage privado, HMAC, 409 por revisão antiga, revogação, delete e logout; zero fixtures temporárias após | Renovação natural após expiração ainda `not_run` no domínio Cloudflare; perfis ICC extremos não ensaiados |
| Limpeza | Worker separado com secret administrativo apenas nele; 5/5 testes locais, ensaio manual hospedado `claimed=2 deleted=2`, Cron observado com 8 Success/0 Errors na hora e evento `outcome=ok` | Falha transitória e retry remoto controlado ainda `not_run` |
| Harness de IA | H-01 concluído; H-02 parcial; H-03 integrado; H-04 D1/S1/U1 encerrado no escopo sintético; G mediu uma chamada DSH real | U1-V1 original permanece FAIL Codex/`not_run` DSH. Rota Codex, subagentes e custo comparável não têm medição; não começar novos pares de custo |

Fontes primárias: `docs/CLOUDFLARE_HTTPS_2026-10-04.md`, `docs/PUBLICACAO_OPERACAO_2026-10-03.md`, `docs/CATALOGO_002_HOSPEDADO_2026-10-03.md`, `docs/REVISAO_ARQUITETURAL_H1.md`, `docs/ai/RELATORIO_H04.md` e `docs/ai/TELEMETRIA_G.md`. O build de clonagem `#bf9bcc96`, os 504 REST de 02/10, o primeiro probe Images com EXIF retido e tentativas instrumentais do harness continuam FAIL históricos; as correções posteriores têm evidências próprias.

## Próximo ciclo recomendado

1. **Fechar a homologação operacional já autorizada:** provar renovação natural de sessão no domínio HTTPS; provocar falha recuperável de limpeza e observar retry remoto sem apagar capa ativa; registrar resultados sanitizados e postflight de fixtures. Não usar credenciais em argumentos, logs ou documentos.
2. **Preparar recuperação e produção:** definir responsável, retenção e RPO/RTO; testar backup de banco **e bytes do Storage** com restauração em projeto novo descartável; depois criar/configurar Supabase de produção separado, URLs Auth, migrações e segredos próprios. Esses passos são gates para dados reais, não tarefas de seed no dev.
3. **Concluir descoberta do piloto:** identificar loja participante e validar processo de balcão, WhatsApp e dependências fiscal/maquininha. Somente depois decidir o próximo pacote comercial. Pela sequência da etapa 2, estoque/fornecedores/venda são candidatos de discussão, não escopo autorizado.
4. **Trilha do harness, independente do produto:** concluir a telemetria G da rota Codex e cobertura de subagentes/custos antes de novos pares; reparar o runner U1-V1 original separadamente. Preserve as evidências H-04 existentes.

Para qualquer alteração de código Next, ler antes o guia pertinente em `node_modules/next/dist/docs/`, conforme `AGENTS.md`. Executar somente as verificações pertinentes ao delta; comandos disponíveis em `package.json`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm run test:harness`. O ensaio remoto cria fixtures e exige conferência explícita do projeto e postflight; não é teste de rotina a repetir sem motivo.

## Guardas para a retomada

- Homologação é `comercio360-dev` com usuários e produtos fictícios. **Dados reais e produção não estão liberados.** Tokens CLI autorizados pelo responsável devem permanecer fora do Git e dos relatórios; não revogá-los por iniciativa própria. Nunca registrar senhas, JWT, cookies, URL assinada, HMAC ou `SUPABASE_SECRET_KEY`.
- O segredo HMAC operacional fica no Worker web e no banco dev por canal seguro; o segredo administrativo fica somente no Worker de limpeza. Não usar chave administrativa no runtime web ou `NEXT_PUBLIC_*`.
- Migrações já aplicadas são imutáveis; mudanças novas são incrementais e exigem revisão. Não usar `db reset`/`migration repair` para contornar divergências; não executar seed novamente por rotina.
- Prioridade documental: `AGENTS.md` e `context.md` atuais, este retrato, contrato aceito e relatórios datados. `GUIA_DESENVOLVIMENTO_COMERCIO_360.md`, `docs/DECISOES_PILOTO.md` e `docs/ai/CONTINUACAO_NOVO_CHAT.md` contêm trechos históricos anteriores ao aceite do Catálogo/publicação; consultar como história, sem substituir o estado atual.

**Início sugerido para a próxima seção:** ler os arquivos prioritários acima; conferir `git status`, commit e deploy; escolher o gate operacional ainda pendente; registrar prova e limites; atualizar `context.md` e este retrato, ou criar passagem datada nova, ao concluir mudança relevante.
