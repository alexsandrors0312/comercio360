# H1-DEP-01 — correção técnica de dependências de teste

Escopo separado do Gate H1 funcional. Executada somente depois de receber o relatório com os 36 testes hospedados aprovados, conforme autorização do operador. A aplicação permanece na versão 0.1.1; módulos comerciais e migrações não fazem parte desta correção.

## Problema e proposta registrados antes da atualização

O npm audit anterior reportou duas entradas moderadas, Vitest 3.2.7 e @vitest/mocker, para o mesmo GHSA-82fw-gwwq-j7x9 / CVE-2026-84373. O problema permite leitura de arquivos por redirect mock em determinados servidores de desenvolvimento acessíveis. A suíte desta aplicação usa vitest run no Node, sem expor o modo browser/servidor de mocks. Não foi demonstrada exploração no fluxo utilizado.

Proposta: fixar Vitest em **4.1.11**, versão corrigida que depende exatamente de **@vitest/mocker 4.1.11**. Metadados do npm confirmam compatibilidade com Node 24. Não adicionar mocker como dependência direta desnecessária, não usar npm audit fix --force e preservar as dependências de produção. Validar lint, tipos, os 62 testes originais e as regressões H1, build, 11 E2E e auditoria completa.

Referências: [advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [release 4.1.11](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11).

## Resultado

Vitest fixado em **4.1.11**, com **@vitest/mocker 4.1.11** transitivo confirmado no lockfile. Instalação concluída. O comparativo de version, integrity e resolved de todas as entradas de produção do lockfile anterior não identificou nenhuma mudança. Nenhuma adaptação de configuração ou teste foi necessária para a nova versão.

O [patch separado](CORRECAO_TECNICA_H1.patch) contém somente package.json e package-lock.json, comparados com as cópias imediatamente anteriores à atualização. A versão da aplicação continua 0.1.1; migrações e código funcional intactos. O JSON hospedado original permanece inalterado.

| Verificação após H1-DEP-01 | Resultado |
| --- | --- |
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm test | **90/90 PASS**: 62 originais + 2 wrapper + 11 seed/diagnóstico + 15 expiração |
| npm run build | PASS, Next 16.3.4 |
| npm run test:e2e | **11/11 PASS**, código 0, 2,2 minutos |
| npm audit --json | **Zero vulnerabilidades**, desenvolvimento e produção incluídos; código 0 |

Verificações executadas em 10/09/2026, depois de instalar Vitest 4.1.11. Os E2E locais usam Auth simulado e PGlite; as 36 verificações hospedadas são a evidência separada do Supabase real. No Windows gerenciado, após as 11 asserções aprovadas, o encerramento automático dos servidores ficou aguardando. Foram encerrados somente os dois processos identificados pelos PIDs de inicialização e portas 3001/54329; Playwright então concluiu com 11 passed e código 0. Nenhuma asserção foi ignorada.

