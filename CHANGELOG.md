# Changelog

## 29/09/2026 — Braço U1 Codex e revisão independente

- O worker Codex corrigiu a regressão sintética do estado ARIA do menu móvel no clone U1 e acrescentou teste a 360 px, alterando somente os dois arquivos autorizados. O resultado 0.1 foi validado e preservado em `docs/ai/H04_U1_CODEX_RESULTADO_2026-09-29.json`; a revisão cega não encontrou achados bloqueantes no código. TypeScript e diff passaram.
- A primeira suíte Playwright teve 4 aprovações e 2 falhas. O localizador do teste novo foi corrigido; a execução focada observada pelo worker mostrou `ok`, mas sem código final de saída devido ao encerramento preso no Windows, e a repetição independente também não terminou. Na cópia intacta, `/demo/nonexistent` respondeu HTTP 404 sem texto `404` visível, explicando a falha da asserção antiga sem atribuí-la ao patch. O gate E2E U1 permanece pendente.
- `Developer: Reload Window` no VS Code não recarregou o MCP da tarefa Codex: `dsh_health` ainda mostra apenas a raiz real. Nenhum braço DSH H-04 foi enviado. Código e evidências H1 do projeto real permanecem intactos.

## 29/09/2026 — Início controlado da avaliação H-04

- Três pares de cópias sintéticas (domínio D1, SQL S1 e interface U1) foram preparados sem credenciais, com baselines e contratos 0.1 iguais por par. As primeiras exportações com conversão involuntária de finais de linha no Windows foram substituídas por moldes conferidos byte a byte com o commit `4a80096`; o protocolo agora exige essa auditoria.
- O braço Codex D1 corrigido produziu JSON 0.1 válido, passou em 7/7 testes direcionados, tipos e diff, e recebeu revisão independente sem achados bloqueantes. Uma tentativa anterior na cópia inválida e a interrupção por limite de créditos foram preservadas como histórico, sem entrar em comparação de tempo/custo. O resultado está em `docs/ai/H04_D1_CODEX_RESULTADO_2026-09-29.json`.
- A allowlist DSH pessoal foi atualizada em disco para os três clones corrigidos, mas a conexão MCP ativa ainda mostra só a raiz real; nenhum worker DSH H-04 foi despachado. `docs/ai/RELATORIO_H04.md` registra o estado e os próximos gates. Código funcional do repositório real, migrações, dependências e evidências H1 não foram alterados.

## 29/09/2026 — Piloto DSH H-03 e preparação H-04

- Após confirmação de resposta no DSH Web, `dsh_delegate` via MCP respondeu `READY`. A primeira revisão H-03 atingiu timeout de 300000 ms; uma segunda chamada delimitada retornou JSON 0.1 na base `1a30bbd`, preservado em `docs/ai/H03_RESULTADO_DSH_2026-09-29.json`. Modelo efetivo, tokens e custo não foram expostos.
- Três achados do DSH foram reproduzidos independentemente em repositórios temporários: base avançada aceita pela API, mudança somente no índice invisível ao Git diff anterior e evidência inválida em `findings`. O validador e os testes foram corrigidos; `npm run test:harness` passou com 14/14, seis skills verificadas, `node --check`, ESLint direcionado e `git diff --check` passaram.
- `docs/ai/RELATORIO_H03.md` registra tentativas, evidências e limites. `docs/ai/AVALIACAO_H04.md` prepara três casos comparáveis em cópias descartáveis; nenhum caso foi executado. Código Next.js, banco, dependências e evidências H1 permanecem intactos.

## 29/09/2026 — Verificação após configuração das chaves e contrato somente leitura

- Após a configuração informada pelo responsável, `dsh_health` permaneceu OK, mas uma chamada mínima em conexão MCP nova retornou `DSH_RUN_FAILED (exit=1; category=authentication)`. DSH Web e headless usam o mesmo cofre atualizado; a chave da Sidebar fica separada. Nenhuma credencial foi lida e o piloto H-03 continua sem relatório.
- A extensão oficial Antigravity 1.5.0 foi inspecionada no VS Code e `Gemini 3.1 Pro Low` foi selecionado. O painel carregou após fechar e reabrir a janela, sem repetir o aviso anterior de cinco reinícios; um prompt mínimo obteve `READY` com `Thought for 8s` na interface. Não houve telemetria de modelo/custo nem avaliação comparativa H-04.
- O validador do harness agora confere alterações reais do Git em resultados de análise/revisão e rejeita mutação omitida do relatório. `npm run test:harness` passou com 11/11 testes e seis skills verificadas; `node --check`, `git diff --check` e `npm run lint` passaram. Nenhuma mudança na aplicação Next.js, no banco ou nas evidências H1.

## 29/09/2026 — Integração VS Code e diagnóstico do piloto

- Inspeção direta no VS Code confirmou a lateral DSH ativa com `DeepSeek-V4-Pro` selecionado. O Gemini Code Assist mostrou que a edição Individual não é mais suportada por esse cliente e pediu login/projeto compatível; nenhuma resposta Gemini foi obtida.
- A ponte MCP pessoal agora classifica apenas códigos terminais de erro por lista fechada, com backup e `node --check` aprovados. Uma conexão nova retornou `DSH_RUN_FAILED (exit=1; category=authentication)` em chamada mínima. A interface DSH Web local abriu para que o responsável atualize a chave no cofre DSH; nenhuma credencial foi lida ou inserida.
- Comércio 360 aberto no VS Code com extensões Codex e Gemini Code Assist já instaladas. Adicionados `GEMINI.md`, recomendações/configuração de extensões e tarefas de validação em `.vscode/`; `docs/ai/INTEGRACAO_VSCODE.md` registra as rotas e limites.
- Configuração MCP DSH compartilhada com a extensão Codex foi confirmada (`dsh_health`, `dsh_delegate`). Após autorização explícita do usuário, o piloto H-03 e uma chamada mínima chegaram à ponte, mas falharam com `DSH_RUN_FAILED (exit=1)`. Nenhum relatório de worker ou modelo efetivo foi obtido.
- Identificada divergência entre referência R1/NVIDIA NIM sem variável `NVIDIA_API_KEY` presente e padrão DSH `deepseek-official`/`deepseek-v4-pro`. A ponte pessoal recebeu classificação de falhas sem stderr bruto, com backup e `node --check` aprovados; a conexão já aberta ainda requer recarga.
- O auto-review rejeitou inicialmente instalar a extensão comunitária DSH Sidebar por exigir aprovação específica do pacote e do acesso persistente ao editor. Após aprovação expressa do responsável, `lixxx1.dsh-sidebar@0.0.5` foi instalada e confirmada no VS Code. O responsável delegou a escolha do provedor para o piloto; foi selecionado o padrão DSH `deepseek-official`/`deepseek-v4-pro`. Nova chamada mínima via MCP falhou com `exit=1`; ativação da lateral e resposta do modelo ainda não foram comprovadas. Sem mudança funcional na aplicação ou no banco.
- `npm run test:harness` (6/6), `npm run lint`, parse dos JSONs de `.vscode/` e `git diff --check` passaram; gates da aplicação não foram reexecutados.

## 29/09/2026 — Base local e primeira implementação do harness

- Primeiro commit local `5977cdb` registra o baseline existente, sem remoto. A identidade `Codex <codex@localhost>` foi usada apenas nesse commit porque o Git não tinha autor configurado.
- Adicionados seis perfis em `.codex/agents/` e seis skills em `.agents/skills/`, com limites próprios para dados, domínio, aplicação, interface, QA e segurança/arquitetura. TOML e estrutura das skills conferidos; discovery e comportamento em nova sessão ainda não observados.
- Adicionado validador local de contratos Git 0.1 e seis testes, incluindo casos negativos de travessia, proteção de arquivos, evidência ausente, base divergente e mudança fora da allowlist. `node --test tests/harness-contract.test.mjs`, checagem local de skills e `npm run lint` passaram. O validador oficial de skills não rodou por ausência de `PyYAML` no Python disponível.
- `dsh_health` retornou OK no cliente. A primeira delegação DSH foi rejeitada pelo auto-review antes da execução por falta de autorização explícita para enviar documentos privados do repositório ao serviço/modelo externo. Nenhum worker ou teste da aplicação foi executado nesta etapa; Catálogo 002 continua sem aceite.

## 28/09/2026 — Correção da disponibilidade DSH MCP

- Diagnóstico em `docs/ai/DIAGNOSTICO_DSH_MCP.md`: ausência de cadastro MCP ativo, pacote npm inexistente no registro público e parâmetros incompatíveis na skill.
- Integração local externa à aplicação registrada no Codex, com ponte de revisão fixa ajustada para Windows e backups. Contrato corrigido para task/cwd/timeout_ms; verificações de protocolo/saúde passaram, sem tarefa de modelo executada. Recarga do Codex ainda necessária para disponibilidade nesta conversa.
- Atualizados contexto e contratos propostos. Git confirmado inicializado, index preservado, primeiro commit ainda ausente. Sem mudança funcional ou migração do Comércio 360.

## 28/09/2026 — Plano de desenvolvimento por IA

- Adicionados `docs/ai/PLANO_ORQUESTRACAO.md` e `docs/ai/CONTRATOS_HARNESS.md`: mapa do produto, orquestração Sol alto/Astra, funções de workers, seis skills propostas, contexto delimitado, contratos de saída, revisão e implantação gradual.
- Atualizados os apontadores de continuidade em context.md e README. Harness, perfis, skills e validador ainda não implantados; integração DeepSeek indisponível nesta sessão por ausência de `dsh_delegate`.
- Conferidos os hashes da evidência H1, das duas migrações e do lockfile contra a revisão anterior. Código funcional e evidências históricas preservados; testes de aplicação não reexecutados nesta tarefa documental.
- Proposta do Catálogo 002 continua aguardando aceite próprio; condições de publicação/dados reais permanecem abertas.

## 26/09/2026 — Revisão arquitetural H1 e proposta do catálogo

- Fundação 0.1.1 aprovada com condições para continuidade do desenvolvimento; parecer em `docs/REVISAO_ARQUITETURAL_H1.md`. ZIP íntegro e 78 arquivos originais iguais à pasta antes das atualizações documentais; evidências hospedadas, duas migrações, dependências e lockfile preservados.
- Instalação, lint, tipos, 90 testes unitários/SQL, build, 11 E2E e auditoria npm com zero vulnerabilidades reproduzidos e aprovados. Resultados e incidentes de ambiente registrados no parecer, separados dos 36 PASS hospedados históricos.
- Login anônimo ainda não conferido pelo operador; HTTPS/cookies, backups/restauração, produção separada e loja participante continuam condições explícitas para implantação e piloto.
- Proposta revisável do Pacote 002 em `docs/PACOTE_002_CATALOGO_PROPOSTA.md`, com categorias, produtos, variantes, preços por loja, capa privada, permissões e critérios de aceite. Implementação depende de aceite próprio; nenhuma funcionalidade comercial adicionada.

## 10/09/2026 — H1-DEP-01 — correção técnica separada

- Após 36 PASS hospedados, Vitest e @vitest/mocker atualizados para 4.1.11, sem audit fix --force. Dependências de produção, aplicação 0.1.1 e migrações preservadas.
- Patch e validação em docs/CORRECAO_TECNICA_H1.md. Pacote 002 bloqueado até revisão arquitetural.

## 10/09/2026 — Gate H1 — testes hospedados e roteiro administrativo

- 36 verificações hospedadas PASS, incluindo expiração e renovação do cookie. Evidência anterior com falha preservada; revisão técnica pendente.

- Teste de expiração hospedada aguarda a tolerância de 30 segundos do PostgREST mais margem de cinco segundos e estima diferença de relógio por Date HTTP. Separa recusa dos JWTs, navegação e renovação de cookie em resultados independentes e sanitizados. Não altera validade de sessão, aplicativo ou migrações.

- Diagnósticos administrativos por códigos fixos `H1-SEED-...`, sem mensagens brutas do provedor; captura de stdout/stderr no processo filho preserva o código de saída diante de erros nativos do PowerShell.
- Campos vazios e senha curta são sinalizados no terminal; seed verifica a presença das empresas/lojas fictícias antes de criar identidades Auth. Onze testes com API local fictícia cobrem preflight, falhas do provedor, ausência de seed SQL e preservação de contas existentes.

- Fase Seed de `scripts/h1-manual.ps1` passa `--env-file=.env.local` diretamente ao Node, corrigindo o bloqueio causado pelo uso não permitido em `NODE_OPTIONS`. Mantém o mesmo programa e os guards de `seed:users`.
- Saída privada suprimida também em erros nativos do PowerShell; limpeza das variáveis administrativas em sucesso/falha, preservando `NODE_OPTIONS` do operador.
- Dois testes de regressão executam o wrapper real com programa e entradas fictícios locais. Nenhuma alteração em migrações, dependências ou módulos comerciais.

## 0.1.1 — 08/09/2026 — Pacote corretivo 001.1

- Organizações sem lojas autorizadas omitidas do seletor; vínculo ativo sem nenhuma loja mantém o usuário em `/sem-acesso`.
- Nova migração transacional protege chaves estruturais de organizações, lojas, vínculos e acessos, inclusive em updates administrativos com `service_role`.
- Restrição de consistência entre tenant do evento e snapshots de auditoria; testes de seleção entre empresas preservam `old_value` isolado.
- Seed exige confirmação independente da URL do projeto antes de qualquer chamada à API e valida todos os endereços no domínio exato `example.test`.
- `requireAccess` memoizado com `React.cache` durante a renderização da requisição, mantendo as validações nas páginas e ações.
- Testes adicionais de domínio, SQL, preflight do seed e E2E para vínculo ativo sem loja; documentação e ADR-0009 atualizados.
- Versões de dependências e `.env.example` preservados; nenhuma funcionalidade comercial adicionada.

## 0.1.0 — 07/09/2026

- Fundação Next.js/TypeScript com módulos de domínio, validação, interface e configuração separados.
- Autenticação Supabase SSR, bloqueio por falta de vínculo, seleção validada de empresa/loja e logout.
- Migração PostgreSQL com seis tabelas, RLS, grants mínimos, chaves compostas e auditoria append-only.
- Seed fictício de duas empresas, três lojas e script administrativo opcional de quatro identidades.
- Painel demonstrativo, estados de carregamento/vazio/erro, navegação responsiva e abas futuras em construção.
- Prévia pública separada da autenticação e manifesto para apresentação standalone; sem operação offline.
- Testes de domínio e banco PostgreSQL/PGlite; testes Chromium com contrato de autenticação simulado.
- Documentação de arquitetura, ADRs, instalação, integração real e recuperação.

Os testes de integração Supabase hospedada do H1 passaram; a revisão arquitetural de 26/09/2026 aprovou a continuidade do desenvolvimento com condições. Nenhuma publicação ou operação comercial real executada.
