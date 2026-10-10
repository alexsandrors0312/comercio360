# ADR-0013 — PDV e baixa integral atômica

09/10/2026. Adotada para o [Pacote005](../PACOTE_005_PDV.md), conforme autorização do responsável para continuar a fase2 e homologar/publicar no dev fictício existente.

Venda é criada diretamente confirmada. Carrinho não reserva saldo; confirmação revalida preço da loja informado para revisão e guarda snapshots em centavos, baixando todos os SKUs na mesma transação. Divergência de preço é conflito, saldo insuficiente recusa tudo. Não introduzir pagamento/fiscal ou cliente obrigatório.

Owner/manager/cashier leem e confirmam; apenas owner/manager cancelam integralmente com motivo e CAS. Cancelamento repõe mercadoria integralmente, inclusive SKU inativado, e preserva venda/linhas/auditoria. A UI exige atestação de retorno; não constitui estorno financeiro. Política de devoluções/trocas e operação com dados reais seguem pendentes de descoberta.

RPCs específicas não ampliam permissão manual de Estoque. O módulo usa os mesmos saldos e movimentos imutáveis, com autorização própria, locks de cadastro/preço/saldo em ordem compatível, limites existentes e auditoria transacional. FKs compostas/RLS/grants mínimos mantêm isolamento; reautorização também no replay. Idempotência ordena itens e compara operação/payload; resposta ambígua conserva tentativa por usuário/loja, também após reload da aba. Nenhuma compensação automática por timeout.

Migração somente incremental `202610090003_sales.sql`; versões anteriores permanecem intactas. Revisão independente e gates locais precedem escrita remota. Supabase/HTTPS dev geram provas separadas; não prometem todos os interleavings PostgreSQL nem prontidão de produção. Recuperação completa, produção isolada, loja piloto e retry de limpeza permanecem pendentes; ensaio de cinco horas não será iniciado/reagendado.
