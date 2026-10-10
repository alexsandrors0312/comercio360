# Homologação do PDV005 em dev

Instrumento preparado em 10/10/2026. Este roteiro não comprova execução; consulte a entrega e os JSONs datados. Alvos exclusivos: `comercio360-dev` (`qiwblpmocldqbijbylwg`) e `https://comercio360.alexsandrors-0312.workers.dev`. Autorização de desenvolvimento vigente; somente dados fictícios. Não inicia o ensaio de limpeza.

## Migração incremental

Após gates locais e revisão independente, executar:

```powershell
powershell -NoProfile -File scripts/sales-hosted.ps1 -Mode migrate `
  -ConfirmProjectUrl https://qiwblpmocldqbijbylwg.supabase.co `
  -ConfirmWorkerUrl https://comercio360.alexsandrors-0312.workers.dev `
  -ExpectedWebVersion <UUID-web-atual> `
  -ExpectedMigrationSha256 e7aec5256cfc7ea9669004425062ff1a689dbdbf9ef08c097f42daad85ad4efd `
  -ConfirmCurrentDeployment
```

O wrapper valida projeto vinculado/nome, versões web e limpeza, nove migrações anteriores exatas, identidades/senhas/concessões, HMAC, auditoria e imagens. O dry-run deve conter exclusivamente `202610090003_sales.sql`, com hash revisado. Aplica uma vez por `db push --linked --skip-vault --yes`, sem seed/reset/repair/roles. Confere dez versões depois. Timeout não autoriza reaplicar: lê o registro e persiste falha. CLI nativo em cache versão2.119.0; cache ausente/ambíguo interrompe.

## Publicação e probe

Publicar somente o código005 revisado pelo build Linux configurado; confirmar commit, conclusão e versão web ativa100%. Executar o wrapper com `-Mode probe`, as mesmas URLs, `-ExpectedWebVersion <UUID-publicado>` e `-ConfirmCurrentDeployment`. Não executar diretamente `tests/hosted/sales.mjs` nem wrappers históricos com contagem antiga de migrações.

O probe autentica os usuários fictícios existentes por link gerado/verificado em memória, sem enviar e-mail nem alterar senha. Chromium recebe ambiente sem segredos. Cria produto/dois SKUs e compra fictícia; recebe estoque, confirma venda na interface, confere saldo/snapshots, preço alterado, rollback multilinha, duas disputas REST pelo último item, replay concorrente da mesma chave, isolamento e restrições do caixa, cancelamento integral e disputa de cancelamento. São16 fases obrigatórias. Concorrência REST usa conexões reais; não afirma observar PIDs do PostgreSQL.

Cada execução tem UUID persistido pelo wrapper antes de iniciar o filho. Journal local ignorado `test-results/pdv-005/<UUID>.json` registra antes de enviar somente payloads fictícios e chaves de idempotência, sem tokens/cookies/segredos. Tentativa de navegador é capturada da persistência original e reprocessada pela mesma chave antes da compensação. Uma escrita REST de resultado incerto impede afirmar compensação/arquivamento e exige conferência pelo run_id; não iniciar automaticamente outra execução para escondê-la.

Antes de cancelar qualquer venda, todas as vendas e todas as linhas precisam corresponder aos IDs próprios conhecidos e às variantes/SKUs/marcador da execução. Venda desconhecida ou mista interrompe. Requisições paralelas são aguardadas integralmente. O encerramento cancela vendas próprias ainda confirmadas, confere histórico/saldo próprios, registra saída compensatória justificada e só então inativa fornecedor/produto. Históricos, pedidos, vendas e auditoria permanecem; não há exclusão de evidência.

O postflight compara identidades/senhas/concessões/HMAC e conteúdo integral dos eventos anteriores em memória, bucket privado, imagens, dez migrações e versões dos Workers. Não publica fingerprints privados. Relatório novo criado exclusivamente em `docs/evidencias/pdv-005-<modo>-<UTC>.json` contém fases/flags/contagens sanitizadas. PASS exige16 fases, compensação, arquivamento e postflight confirmados. Interrupção abrupta não garante execução do finally; run_id/journal orientam recuperação manual.

## Provas locais do instrumento

`npm test -- tests/sales-hosted.test.ts`: seis testes incluindo guard PowerShell por AST com sete casos, rejeição de venda desconhecida/mista, espera de ambas requisições e rejeição de PASS incompleto. Não equivalem à execução remota. Cada falha permanece intacta, e nova tentativa gera outro relatório.
