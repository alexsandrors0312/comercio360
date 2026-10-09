# Pacote 004 — Compras, fornecedores e recebimento

Autorização de 09/10/2026: o responsável pediu a próxima implementação operacional, seguida de homologação das migrações e publicação no ambiente dev existente. O ensaio remoto de limpeza continua pendente; produção/dados reais não são autorizados. Este recorte implementa `/app/compras`, após Estoque003.

## Escopo e regras

- Fornecedores por organização: nome Unicode aparado3–120, contato livre opcional até160, ativo/inativo, revisão CAS. Nome sem distinção de caixa único por organização. Identidade imutável; sem delete. Alterações não reescrevem snapshots dos pedidos.
- Pedido por loja e fornecedor ativo:1–50 variantes ativas e distintas, quantidade inteira1–1.000.000 por linha, custo unitário BRL em centavos1–100.000.000. Total calculado no banco, máximo100.000.000.000centavos (R$1bi). Dinheiro não usa float nem preço de venda do Catálogo. Snapshot de fornecedor/produto/SKU/custo no pedido.
- Estados: `open` (aberto), `received` (recebido integralmente), `cancelled` (cancelado). Criação não movimenta estoque. Recebimento integral cria uma entrada por linha e atualiza pedido/estoque/auditoria na mesma transação. Falha em qualquer linha faz rollback de tudo. Cancelamento só aberto, sem movimento de estoque. Pedido criado não é editável; cancelar/recriar se necessário.
- Leitura: owner,manager,buyer,stockist. Cadastro de fornecedor e criar/cancelar pedido: owner,manager,buyer. Receber: owner,manager,stockist. Vínculo e concessão explícita à loja ativos, também para owner/manager. Cashier não acessa custos/compras. Ator derivado de auth.uid.
- Escritas com revisão esperada quando existente e idempotência por organização/loja/ator/chave UUID+operação+payload normalizado. Repetição idêntica devolve resultado original; chave reutilizada com dados diferentes éPT409. Reautorização também no replay. Novo recebimento exige produtos/variantes ativos; fornecedor inativo impede novo pedido, mas não impede receber pedido já aberto.
- Recebimento usa `inventory_move` transacional existente, com revisão atual lida e saldos bloqueados em ordem estável de variant_id; nenhuma sobrescrita de saldo antigo. Historico de estoque/auditoria preservados. Razão de entrada identifica pedido, até240Unicode. Recebimento e cancelamento disputam lock do pedido; idempotência possui lock por chave. Locks de autorização/cadastro evitam revogação/inativação no meio da escrita.
- UIpt-BR com busca/paginação, editor de até50 linhas, totais calculados para revisão, confirmação explícita “Receber pedido completo”, motivos de cancelamento obrigatórios3–240. Envio ambíguo conserva payload/revisão/chave e bloqueia edição até confirmar.

Fora deste recorte: recebimento parcial, devoluções, aprovação/alçadas, contas a pagar/pagamentos, documento fiscal/CNPJ validado, comunicação com fornecedor, custo médio/valoração, reservas/transferências e PDV. Contato é texto, não integração de e-mail/WhatsApp.

## Contratos RPC (nomes e ordem fixos)

Escopo inicial de todas as RPCs: `p_organization_id uuid,p_store_id uuid`. Saídas snake_case; revisões/bigint podem vir texto no REST.

- `procurement_suppliers(scope,p_query text,p_limit int,p_offset int,p_supplier_id uuid default null)` →id,name,contact,active,revision,total_count.
- `procurement_orders(scope,p_query text,p_status text,p_limit int,p_offset int,p_order_id uuid default null)` →id,supplier_id,supplier_name,status,revision,total_cents,created_at,received_at,cancellation_reason,total_count. p_status `all`/open/received/cancelled. Query busca fornecedor ou UUID textual. Ordemcreated_at,id decrescente.
- `procurement_order_items(scope,p_order_id uuid)` →variant_id,product_name,sku,quantity,unit_cost_cents; ordemvariant_id.
- `procurement_save_supplier(scope,p_supplier_id uuid,p_name text,p_contact text,p_active boolean,p_expected_revision bigint,p_idempotency_key uuid)` →id,revision. Criação exige revisão0 e novo UUID; atualização exige revisão atual. Mesma operação idempotente via ledger próprio, sem expor payload fora do escopo.
- `procurement_create_order(scope,p_supplier_id uuid,p_items jsonb,p_idempotency_key uuid)` →id,revision. p_items array `{variant_id:uuid,quantity:int,unit_cost_cents:int}`. Estadoopen/revisão1. Banco valida cada valor/tipo/duplicado antes da escrita.
- `procurement_receive_order(scope,p_order_id uuid,p_expected_revision bigint,p_idempotency_key uuid)` →id,revision. Somenteopen; retorna novo estadoreceived/revisão+1. Entradas com UUID por linha associado imutavelmente ao pedido; razão `Recebimento de compra `+orderid.
- `procurement_cancel_order(scope,p_order_id uuid,p_expected_revision bigint,p_reason text,p_idempotency_key uuid)` →id,revision. Somenteopen, motivotrimUnicode3–240.
- Erros:42501autorização/escopo,22023validação,PT409revisão/chave/estado,23505nomefornecedorduplicado; infraestrutura/resposta inválida sanitizada.
- Listas queryaté200/limit1–100/offset>=0. Tabelas com RLS/FKs compostas e privilégios mínimos; authenticated/service semDML direto; RPCssecuritydefinersearch_pathfixo; snapshots/linhas/pedido terminal/idempotência imutáveis, auditoria append-only.

DTOs/actioncontratos em `packages/domain/procurement-contracts.ts`. Actions `saveProcurementSupplier`, `createPurchaseOrder`, `receivePurchaseOrder`, `cancelPurchaseOrder`, `findPurchaseVariants`; cada uma reautoriza escopo/papel. Leituras em `lib/procurement/server.ts`. Busca de variantes retorna até100ativas; UI permite refinar sem descartar linhas.

## Critérios

Domínio/servidor cobrem fronteiras, dinheiro/total, autorização e sanitização. SQL real local cobre tenant/loja/papéis/revogação/CAS/replay/locks inspecionados, transação multiline/rollback/auditoria e invariantes. Navegador cobre fornecedor→pedido→recebimento→Estoque, cancelamento, leituraestoquista/negaçãocaixa, reenvio ambíguo e360/768/1440. Revisão independente antes de remoto. Homologação em Supabase dev com REST e browserHTTPS, concorrência entre sessões reais se canal disponível, postflight preservando auditoria. Sem reexecutar seed ou editar migrações anteriores; aplicar somente incrementais revisadas003/004, conferir projeto e baseline antes de escrita. Publicar app após gates locais/revisão e verificar versão/domínio.
