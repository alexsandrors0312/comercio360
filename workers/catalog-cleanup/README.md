# Catálogo 002 — Worker de limpeza para homologação

Este Worker é separado do serviço Next `comercio360`. O código aceita somente `https://qiwblpmocldqbijbylwg.supabase.co` (`comercio360-dev`), fixa a conta Cloudflare `41004f5611c7e9a6597a750f3ed55c6e`, roda a cada 15 minutos UTC e não publica endpoint HTTP. A chave administrativa pertence apenas a `comercio360-catalog-cleanup-dev` como secret `SUPABASE_SECRET_KEY`; não a coloque no Worker web, em `vars`, `.env` versionado ou logs.

## Contrato

- O handler chama as RPCs `catalog_claim_image_cleanup` e `catalog_finish_image_cleanup` com a chave administrativa. O banco seleciona somente objetos sem capa ativa, anteriores ao corte, com `FOR UPDATE SKIP LOCKED` e atualiza o estado para `deleting`.
- Processa no máximo 16 objetos por execução, com até 16 por página, para manter margem sob o limite de 50 subrequests do Workers Free (até 34 chamadas HTTP para lote cheio). O corte é de duas horas; SQL também impõe no mínimo uma hora. Remoções são sequenciais. Falha de Storage finaliza como `cleanup_pending`, marca a execução como falha e permite retry após a carência. Objeto já ausente pode ser finalizado como removido.
- Emite uma linha JSON por execução com `status`, `claimed`, `deleted`, `failed` e `duration_ms`. Erros causam resultado de Cron com falha. Não registra caminhos, IDs de objetos, respostas brutas ou credenciais. `claimed=16` gera `status=saturated` para investigar backlog.

## Ativação no ambiente de desenvolvimento

1. Confirme que o projeto de destino é `comercio360-dev`, que as sete migrações do Catálogo estão alinhadas e que o secret administrativo é do mesmo projeto. Execute `node --test workers/catalog-cleanup/test/index.test.mjs` e um `wrangler deploy --dry-run --config workers/catalog-cleanup/wrangler.jsonc` antes de qualquer deploy.
2. Crie o Worker separado `comercio360-catalog-cleanup-dev` na mesma conta Cloudflare do app. Provisione `SUPABASE_SECRET_KEY` **somente** nele via Secret do painel ou cofre de CI. Restrinja acesso administrativo e logs. O arquivo Wrangler declara o secret como obrigatório e o deploy falha se ele estiver ausente. Evite `wrangler secret put` como primeira operação sem revisar o efeito: esse comando publica uma versão imediatamente.
3. Publique o Worker usando `wrangler deploy --config workers/catalog-cleanup/wrangler.jsonc` depois da revisão de alvo e credencial. Confira no painel que o Cron `*/15 * * * *` pertence a `comercio360-catalog-cleanup-dev`, não ao Worker web. O cron é UTC; pode levar alguns minutos para propagar.
4. Observe duas execuções consecutivas em **Workers & Pages → comercio360-catalog-cleanup-dev → Settings → Trigger Events → View events** e em **Observability → Logs**, filtrando `event=catalog_cleanup`. Confira resultado de Cron bem sucedido, `failed=0` e contagens. O Worker Logs está configurado com amostragem 100%; a retenção da conta pode ser curta, portanto defina alerta externo para Cron failed, ausência de execução por 30 minutos, `failed>0` e `status=saturated` se for requisito operacional.
5. Ensaie no destino uma remoção e um retry com fixtures fictícias e antigas, verificando antes/depois o estado do ledger e Storage. O teste hospedado existente já provou `claimed=2 deleted=2 failed=0` em execução manual, mas ainda não prova o Cron remoto nem falha de Storage ao longo do tempo.

Para pausar o agendamento, altere `triggers.crons` para `[]` e faça deploy. Remover a propriedade não desativa Cron Triggers existentes. Mantenha a chave no Worker separado e acompanhe objetos `cleanup_pending`/`deleting` antigos por consultas agregadas restritas no Supabase.

Fontes: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
