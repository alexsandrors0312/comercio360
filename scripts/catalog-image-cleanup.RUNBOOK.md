# Catálogo 002 — operação do worker de limpeza

O worker é um processo separado do Next. Execute `node scripts/catalog-image-cleanup.mjs` em um agendador que ofereça segredos, logs restritos e alerta por código de saída. Não inclua `SUPABASE_SECRET_KEY` no runtime web, arquivo versionado ou argumento da linha de comando.

## Configuração por ambiente

Injete estas variáveis no processo, por um cofre ou Environment protegido:

| Variável                       | Valor esperado                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`     | Origem HTTPS exata do projeto Supabase de destino                                 |
| `CONFIRM_SUPABASE_PROJECT_URL` | A mesma origem, configurada separadamente para impedir troca acidental de projeto |
| `ALLOW_CATALOG_IMAGE_CLEANUP`  | `yes`                                                                             |
| `SUPABASE_SECRET_KEY`          | Credencial administrativa do projeto, disponível apenas ao worker                 |

Prepare um agendamento **a cada 15 minutos**, sem execuções sobrepostas por ambiente. O código processa até 100 objetos por execução em lotes de 20; cada claim usa um corte de duas horas, e o SQL nunca aceita objetos com menos de uma hora. O banco revalida ausência de capa ativa antes de marcar e finalizar cada objeto. O agendador deve iniciar sempre um processo novo e manter o histórico de execuções.

## Sinais e resposta

O stdout emite somente `CATALOG-CLEANUP claimed=N deleted=N failed=N`. Saída 0 indica nenhuma falha de remoção ou finalização. Saída 1 indica remoção falha, erro de RPC ou configuração inválida; configure alerta para toda saída diferente de zero. O processo não imprime caminhos de objetos, resposta bruta do Storage ou credenciais. Uma falha de remoção volta o objeto a `cleanup_pending`; uma falha após claim pode deixá-lo `deleting`. Ambos são elegíveis de novo após a carência de duas horas. A remoção de objeto já ausente é idempotente.

Monitore por ambiente: horário da última execução, códigos de saída consecutivos, `failed`, volume `claimed` encostando em 100 e contagem/idade das linhas `cleanup_pending` e `deleting` sem referência ativa. Investigue antes de aumentar frequência ou limite. Registre a consulta de backlog apenas em painel administrativo restrito, com contagens e idade agregadas, sem caminhos de objetos. O worker não elimina auditoria.

Antes de ativar um cron remoto, confirme o destino e a separação desenvolvimento/produção, segredos provisionados no agendador, log restrito, alerta e ensaio de falha/retry no ambiente alvo. A prova local de falha de transporte e recuperação está em `tests/catalog-cleanup-guard.test.ts`; o ensaio hospedado existente cobre remoção bem sucedida e retomada de objeto já ausente, mas não falha real de Storage ao longo do tempo.
