# Pacote 003 — Estoque por loja

Em 09/10/2026, o responsável pediu continuidade nas abas de Operações e desenvolvimento do sistema, deixando o ensaio remoto de limpeza pendente. Este documento registra o primeiro recorte dessa autorização: Estoque, dependência de compras e vendas. É implementação local para homologação; não libera produção, dados reais ou aplicação remota de migrações.

## Comportamento

- Saldo por organização, loja e variante/SKU do Catálogo; ausência de saldo representa zero e revisão `0`. A lista também mostra cadastros inativos, identificados, preservando saldos/histórico.
- Entradas e saídas manuais, em unidades inteiras, de 1 a 1.000.000 por movimento. Saldo de 0 a 2.147.483.647; saída insuficiente é recusada. Motivo obrigatório, aparado nas pontas, de 3 a 240 caracteres Unicode.
- Leitura: owner, manager, stockist, cashier e buyer com vínculo e loja ativos/autorizados. Escrita: owner, manager e stockist, com acesso explícito à loja. O ator vem da sessão, nunca do formulário.
- Produto e variante devem estar ativos para novas movimentações. Nenhuma edição/exclusão do histórico; correções usam novo movimento compensatório justificado.
- Revisão esperada evita alterações sobre saldo desatualizado. Idempotência por organização/loja/ator/chave UUID: mesma entrada devolve resultado original, payload diferente é conflito. Nova autorização é exigida mesmo em repetição.
- Saldo, movimento e auditoria são gravados na mesma transação. Locks no saldo serializam alterações e FKs compostas isolam empresas/lojas; histórico append-only também para serviço administrativo.
- Busca por produto/SKU, paginação de saldos e histórico da variante selecionada; vazio, carregamento, envio, acesso negado, infraestrutura indisponível, conflito e saldo insuficiente em pt-BR. Reenvio ambíguo conserva a chave de idempotência.

Ficam para os próximos recortes: fornecedores/compras e recebimento integrado, PDV/venda, reservas, transferências entre lojas, custo/valoração, inventário físico, limites de reposição, pagamentos e fiscal.

## Contratos de integração

DTOs compartilhados em `packages/domain/inventory-contracts.ts`. Entrada em `packages/validation/inventory.ts`: `variantId`, `kind` (`entry`/`exit`), `quantity` (texto inteiro), `reason`, `expectedRevision` (texto bigint, aceita zero), `idempotencyKey` UUID. Organização/loja são escopo validado separadamente.

- `inventory_stock(p_organization_id uuid,p_store_id uuid,p_query text,p_limit integer,p_offset integer,p_variant_id uuid default null)`: `variant_id`, `product_name`, `sku`, `color`, `size`, `active`, `quantity`, `revision`, `total_count`. Revisões/contagens podem chegar como texto. Lista estável por nome/SKU/id; query até 200, limit 1–100, offset >=0.
- `inventory_history(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,p_limit integer,p_offset integer)`: `id`, `kind`, `quantity`, `reason`, `balance_after`, `created_at`, `total_count`. Ordem created_at/id decrescente; escopo autorizado, limit 1–100.
- `inventory_move(p_organization_id uuid,p_store_id uuid,p_variant_id uuid,p_kind text,p_quantity integer,p_reason text,p_expected_revision bigint,p_idempotency_key uuid)`: retorna `id`, `revision`, `quantity` (saldo resultante).
- Erros: `42501` acesso, `22023` entrada inválida, `PT409` revisão/idempotência conflitante, `PT422` saldo insuficiente. Falhas de infraestrutura não expõem resposta bruta.
- Server Action `recordInventoryMovement(scope,input)`: `InventoryMutationResult`. Leituras `getInventoryAccess`, `listInventoryStock`, `getInventoryItem`, `listInventoryHistory`. Componente `InventoryWorkspace` recebe scope, storeName, stock, selectedItem, history, query e canWrite.

## Critérios de entrega

1. SQL real em PGlite comprova tenant/loja, papéis/revogação, zero inicial, entrada/saída, limite/insuficiência, CAS, idempotência, rollback e auditoria/histórico imutáveis.
2. Domínio e servidor cobrem fronteiras/erros, autorização em cada operação e sanitização.
3. Navegador local exercita movimentação/histórico, busca, leitura sem escrita, conflito/insuficiência e larguras 360/768/1440. Ambiente HTTP simulado com SQL real não representa Supabase hospedado.
4. Tipos, lint, testes, build e revisão independente proporcionais; histórico de limpeza preservado como inconclusivo/`not_run`.

Estado em 09/10: implementado e integrado localmente. [Entrega e limitações](ENTREGA_ESTOQUE_003_2026-10-09.md), [validação](evidencias/estoque-003-validation-2026-10-09.json) e [revisão independente](evidencias/estoque-003-review-2026-10-09.json). Nenhuma execução remota faz parte deste pacote local.
