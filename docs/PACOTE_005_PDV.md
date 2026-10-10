# Pacote 005 — Venda básica / PDV

09/10/2026. Autorizado pelo responsável para implementação, revisão independente e homologação/publicação no dev existente, apenas com dados fictícios. Base `075c545`; alterações locais anteriores de documentação/limpeza são preservadas e não integram este pacote. [ADR-0013](adr/ADR-0013-pdv.md).

## Fluxo e limites

Carrinho local por loja; confirmar cria venda já `confirmed`, revisão 1, e baixa integralmente o estoque. Não há pedido aberto, reserva ou garantia de saldo no carrinho. Cada venda contém 1–50 SKUs distintos ativos, quantidades inteiras 1–1.000.000, preço BRL vigente da loja e snapshots de produto/SKU/preço. Preço ausente impede venda; zero é permitido conforme Catálogo. Centavos inteiros, unitário 0–999.999.999.999 (limite do numeric(12,2) existente), total 0–1.000.000.000.000. Cálculo intermediário exato; banco é autoridade.

O operador envia o preço em centavos que revisou. A confirmação bloqueia/reconsulta o preço vigente; diferença é conflito `PT409`, sem aceitar silenciosamente outro total. Produto/SKU inativo é entrada inválida. Saldo insuficiente é `PT422`; falha em qualquer item/auditoria desfaz venda, linhas e todos os movimentos. Saldo atual é bloqueado e lido no banco, sem exigir revisão do saldo que envelhece no carrinho. Locks em ordem estável devem ser compatíveis com Catálogo, Estoque e Compras.

Leitura e confirmação: owner, manager, cashier. Cancelamento: owner, manager. Todo papel exige vínculo ativo, loja ativa e concessão explícita. Ator deriva de auth.uid; reautorizar dentro da transação, inclusive replay. Buyer/stockist continuam consultando Estoque/Catálogo, sem acesso ao PDV. Não ampliar `inventory_move` para caixa.

Cancelar integralmente uma venda `confirmed` exige revisão esperada, motivo Unicode aparado 3–240 e confirmação do operador de que todas as mercadorias retornaram ao estoque. Transição única para `cancelled`, revisão +1, repõe exatamente quantidades originais, mesmo se produto/SKU foi inativado desde a venda. Estouro de saldo/revisão recusa tudo. Snapshots não mudam; nenhuma exclusão ou edição de venda confirmada. Esse cancelamento é correção operacional de estoque, **não estorno de pagamento**. Não há devolução parcial, troca ou cancelamento automático por perda de resposta.

Idempotência por organização/loja/ator/UUID com operação e payload normalizado (itens ordenados por UUID). Mesma chave/mesma entrada recupera resultado original, inclusive após mudança de catálogo ou cancelamento posterior; chave com entrada/operação diferente é conflito. UUID de venda retornado identifica o resultado. Lock por chave precede escrita. Resposta de infraestrutura, transporte ou resultado inválido é ambígua: preservar chave/payload, bloquear nova tentativa editada e permitir confirmar o mesmo envio. A UI deve preservar tentativa também após recarregar a aba, por usuário/organização/loja; sessão local não é fila offline. Autorização negada não autoriza repetir com outro usuário.

Fora: pagamentos, recebimento de dinheiro/troco, fiscal, maquininha, descontos, cliente obrigatório/cadastro, WhatsApp, dados reais, offline, reservas e devoluções parciais. A identificação da loja piloto, a política comercial de devoluções, pagamentos e fiscal precisam de descoberta própria. As decisões acima limitam a homologação fictícia; não presumem essas regras para produção.

## RPCs e apresentação

Escopo inicial `p_organization_id uuid,p_store_id uuid`. RPCs públicas:

- `sales_variants(scope,p_query text,p_limit int,p_offset int)` → variant_id,product_name,sku,color,size,unit_price_cents (nullable),quantity,total_count. Apenas produtos/SKUs ativos; query até200 busca produto/SKU/código de barras, paginação1–100/offset>=0, ordem produto/SKU/id.
- `sales_list(scope,p_query text,p_status text,p_limit int,p_offset int,p_sale_id uuid default null)` → id,status,revision,total_cents,created_at,cancelled_at,cancellation_reason,total_count. Status all/confirmed/cancelled; query busca UUID/SKU/nome snapshot; ordem created_at/id desc.
- `sales_items(scope,p_sale_id uuid)` → variant_id,product_name,sku,quantity,unit_price_cents; ordem variant_id.
- `sales_confirm(scope,p_items jsonb,p_idempotency_key uuid)` → id,revision. Itens `{variant_id:uuid,quantity:int,expected_unit_price_cents:integer}`. Cria snapshots/baixa/auditoria atomicamente.
- `sales_cancel(scope,p_sale_id uuid,p_expected_revision bigint,p_reason text,p_idempotency_key uuid)` → id,revision. A UI exige confirmação de retorno; RPC exige autorização/motivo/revisão e faz reposição integral atômica.

Erros:42501 escopo/autorização;22023 entrada;PT409 preço/revisão/estado/chave;PT422 saldo insuficiente. Tabelas `sales`, `sale_items` e ledger privado de idempotência, FKs compostas, RLS, sem DML direto authenticated/service. Funções security definer com search_path fixo, grants mínimos; linhas/ledger/histórico imutáveis. Integrar a auditoria sem enfraquecer políticas anteriores ou divulgar custos de Compras ao caixa.

DTOs em `packages/domain/sales-contracts.ts`; domínio `sales.ts`; validação `packages/validation/sales.ts`. Aplicação `lib/sales/server.ts` e actions `confirmSale`, `cancelSale`, `findSaleVariants`. Rota `/app/pdv`: busca de SKUs, carrinho, confirmação explícita, lista/busca/paginação, detalhe e cancelamento conforme papel. Acessibilidade pt-BR, foco/teclado, vazio, carregamento, erro, conflito, insuficiência, tentativa ambígua e bloqueio pré-hidratação. Demonstração mantém mocks identificados.

## Evidências exigidas

Domínio: limites, duplicados/UUID normalizado, preço zero/ausente, total exato e overflow. SQL PGlite: tenant/loja/papéis/revogação, preço snapshot, atomicidade multiline/rollback/auditoria, baixa/reposição, CAS/replay/imutabilidade e locks inspecionados. Servidor: reautorização, DTO/erros sanitizados. Browser local: Catálogo/Estoque → venda → saldo/cancelamento, caixa sem cancelamento, negação de papel, preço alterado, insuficiência, resposta perdida/replay e 360/768/1440. Gates lint/tipos/Vitest/build/E2E e revisão independente de risco.

Homologação remota exige preflight do Supabase dev existente (nove migrações), apenas incremental005 revisada, preservação de auditoria/identidades/permissões/segredos/imagens. Confirmar alvo e versão; fixtures fictícias com reposição/compensação e encerramento, auditoria preservada. REST paralelo real disputa último item e replay, browser HTTPS percorre integração. Evidência remota separada; ausência de execução permanece not_run. Limpeza de cinco horas continua adiada. Produção/dados reais bloqueados por recuperação completa, ambiente isolado e loja piloto.
