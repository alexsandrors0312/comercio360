# Gate H1 — testes hospedados aprovados; revisão arquitetural pendente

Consolidação: **10/09/2026 (America/Sao_Paulo)**. Aplicação **0.1.1 / Pacote 001.1**. O operador concluiu Verify com **36 PASS e zero FAIL**. Evidência: `H1_RESULTADOS.json`, produzido em **2026-09-11T00:29:31.252Z**, equivalente a 10/09 às 21:29 de Brasília. O JSON original permanece intacto, inclusive seu status `TESTES_PASSARAM_REVISAO_PENDENTE`.

## Ambiente e histórico

- Supabase descartável de desenvolvimento **comercio360-dev**, referência pública `qiwblpmocldqbijbylwg`, somente dados fictícios. Credenciais administrativas inseridas pelo operador em prompts ocultos no terminal; não registradas aqui.
- Evidência sanitizada do operador: `202609070001` e `202609080001` constam em Local e Remote; dry-run informou `Remote database is up to date.`. **Histórico alinhado; não reaplicar migrações.** Sem versões desconhecidas, repair ou reset.
- Ordem aplicada pelo operador: `202609070001_foundation.sql`, depois `202609080001_tenant_key_guards.sql`. Os arquivos existentes foram preservados. A migração inicial mantém SHA256 `39C5E858C3F1EFBE59963B5420C112B0B67D40D6E45956BEF36C1EE6DA7DA4E4`.
- Seed SQL presente com duas organizações e três lojas. Fase Seed preparou quatro contas `example.test`, preservando senhas existentes. Verify confirmou login real das quatro identidades.
- Cadastro público **desativado** e login por e-mail habilitado: PASS na consulta ao Auth hospedado. O endpoint público não informa o estado do login anônimo; **confirmação do operador no painel ainda pendente**.
- `.env.local` excluído da entrega; configuração pública sem credenciais administrativas. `.env.example` preservado sem credenciais.

## Evidências hospedadas

O operador executou `scripts/h1-manual.ps1 -Phase Verify`. Next de produção rodou em HTTP local na porta 3002 e Supabase hospedado em HTTPS. O servidor web recebeu ambiente sem variáveis administrativas. REST/RPC de autorização usaram JWT dos usuários; acesso administrativo serviu para preparar/restaurar fixtures e verificar integridade. Sem gravação de JWT, cookies, resposta bruta, screenshot, HAR ou storageState.

| Grupo | Evidências aprovadas |
| --- | --- |
| Autenticação | Login válido nas quatro contas, senha inválida recusada, renovação explícita e validação no servidor |
| Contexto multiempresa | Gerente Aurora acessa A1/A2; caixa apenas A1; gerente Horizonte apenas B1; usuário sem vínculo bloqueado |
| Vínculo ativo sem loja | Organização B omitida do seletor do gerente A; revogar a única loja do caixa bloqueia navegador e API |
| RLS real | IDs conhecidos de outro tenant retornam zero linhas; insert/update cruzados e RPC sem acesso rejeitados com JWT de usuário |
| Chaves estruturais | Dez campos protegidos recusam alteração, mantendo registro e auditoria intactos; nome, papel, ativo e atribuição do mesmo valor continuam permitidos |
| Auditoria | Snapshots old/new inconsistentes rejeitados; ator, origem, antes/depois, loja, organização e data verificados; seleção consecutiva idempotente; troca de organização sem copiar old_value anterior |
| Revogação | Revogar loja remove opção e leitura REST; revogar vínculo bloqueia próxima requisição e RPC mesmo com JWT ainda válido |
| Navegador | Login inválido bloqueado, troca A2 persiste ao recarregar, cookie adulterado não amplia acesso, logout impede acesso posterior |
| Logout Auth | Refresh token revogado; access JWT emitido pode permanecer válido até expirar |
| Expiração natural | Espera além da tolerância, dois JWTs antigos recusados, navegador autorizado após recarregar e cookie renovado |

Expiração: fonte de relógio `http_date`, diferença estimada **-1 segundo**, tolerância **30 segundos** e margem **5 segundos**. JWT antigo da API e do navegador retornaram **HTTP 401 / jwt_expired**. Após recarregar, navegador retornou **HTTP 200** na área autorizada; `tokenChanged=true` e `expiryExtended=true`. Nenhum valor secreto registrado; não foram alterados relógio, validade configurada ou critérios de aceitação.

Nenhuma falha de restauração das fixtures foi registrada pelo roteiro. Eventos de auditoria foram preservados. Isso comprova os cenários e o ambiente descritos, sem representar teste de carga ou operação com dados reais.

## Correções e evidência anterior

A tentativa anterior registrou 31 PASS e uma falha composta. Evidência preservada em `H1_RESULTADOS_2026-09-10_expiracao_pendente.json`; análise original em `ENTREGA_H1_2026-09-10_parcial.md`. Nenhum resultado anterior foi convertido manualmente para PASS.

O teste antigo exigia recusa em exp+5 segundos, dentro da tolerância de 30 segundos do PostgREST. A asserção exata que falhou naquela tentativa não é recuperável do diagnóstico antigo. O roteiro passou a aguardar a tolerância e a registrar cinco observações independentes sanitizadas. A nova execução comprovou todas elas. [Referência PostgREST](https://postgrest.org/en/stable/references/auth.html).

O wrapper Seed passou a enviar `--env-file=.env.local` diretamente ao Node: a opção é recusada em `NODE_OPTIONS`. Captura privada de saída e códigos fixos `H1-SEED-...` substituíram diagnóstico genérico. Foram acrescentadas validações de campos vazios e presença do seed SQL antes de criar contas. Preservados os guards de confirmação independente do projeto, flag de desenvolvimento e domínio `example.test`. A falha genérica intermediária não permite determinar retrospectivamente a causa ou ausência de escritas; o seed posterior e Verify demonstram o estado atual.

## Correção técnica separada H1-DEP-01

Após receber os 36 PASS hospedados, Vitest e sua dependência transitiva `@vitest/mocker` foram atualizados para **4.1.11**. Versão da aplicação permanece 0.1.1. Nenhuma dependência de produção mudou no lockfile; migrações e código funcional preservados. Sem `npm audit fix --force`. Causa, proposta e resultados: [CORRECAO_TECNICA_H1.md](CORRECAO_TECNICA_H1.md). Revisão independente: [patch de package.json e package-lock.json](CORRECAO_TECNICA_H1.patch).

| Verificação após H1-DEP-01 | Resultado |
| --- | --- |
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm test | **90/90 PASS**: 62 originais + 2 wrapper + 11 seed/diagnóstico + 15 expiração |
| npm run build | PASS, Next 16.3.4 |
| npm run test:e2e | **11/11 PASS**, código 0, 2,2 minutos |
| npm audit --json | **Zero vulnerabilidades**, desenvolvimento e produção incluídos; código 0 |

Verificações executadas em 10/09/2026, depois de instalar Vitest 4.1.11. Os E2E locais usam Auth simulado e PGlite; as 36 verificações hospedadas são a evidência separada do Supabase real. No Windows gerenciado, após as 11 asserções aprovadas, o encerramento automático dos servidores ficou aguardando. Foram encerrados somente os dois processos identificados pelos PIDs de inicialização e portas 3001/54329; Playwright então concluiu com 11 passed e código 0. Nenhuma asserção foi ignorada.


## Limites e parecer

**Os 36 testes hospedados passaram. A aprovação arquitetural permanece pendente.** A confirmação de login anônimo desativado no painel ainda não foi recebida; não foi inferida a partir do cadastro público desativado.

Next foi acessado em HTTP local e Supabase em HTTPS. Cookie Secure sob HTTPS da própria aplicação exige validação no ambiente de implantação antes de publicar. Revogação de refresh e expiração de access JWT são critérios distintos, conforme [Supabase](https://supabase.com/docs/guides/auth/signout). Backups/restauração e operação com dados reais não foram homologados.

A evidência hospedada corresponde à execução da aplicação 0.1.1 anterior à atualização exclusiva das ferramentas de teste. O JSON não foi recriado a partir da suíte simulada. Não houve nova execução administrativa pelo agente ou credenciais reais nos testes locais.

O ZIP integral acompanha este relatório e `H1_RESULTADOS.json`. Exclui ambientes reais, credenciais, tokens, `.git`, `.next*`, `node_modules`, `supabase/.temp`, caches e relatórios de navegador. Inclui fontes, migrações existentes, seeds fictícios, testes, documentação e lockfile atualizado.

**Pacote 002 bloqueado até revisão arquitetural do ZIP, deste relatório e de H1_RESULTADOS.json.** Produtos, estoque, fornecedores, PDV, pagamentos, fretes e mídias sociais não foram implementados. `DECISOES_PILOTO.md` orienta trabalho futuro sem ampliar este gate.
