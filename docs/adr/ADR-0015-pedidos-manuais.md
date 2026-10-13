# ADR-0015 — Pedidos manuais separados de venda e estoque

10/10/2026. Adotada para o [Pacote007](../PACOTE_007_PEDIDOS.md), após escolha explícita do responsável por pedidos de balcão e WhatsApp registrados manualmente.

Pedido representa intenção de atendimento; venda representa baixa efetiva. Capturar pedido não reserva nem movimenta estoque. A conclusão chama `private.sales_confirm_core` existente na mesma transação e só então marca o pedido como `fulfilled`, com vínculo único à venda. O preço capturado é proposta imutável; se preço ou saldo mudou, a conclusão falha integralmente e o operador cancela/refaz o pedido. Não há sobrecarga ambígua das RPCs antigas de venda nem alteração do payload/replay do PDV005/Clientes006.

Origem `whatsapp` é preenchida por operador, sem API, bot, envio, captura de conversa ou automação por navegador. Esse canal exige cliente ativo com telefone no cadastro; somente ID/nome snapshot ficam no pedido. Cliente de balcão é opcional. Estados de pedido, venda, pagamento e atendimento permanecem separados. O cancelamento posterior da venda não reabre o pedido.

O banco é a autoridade sobre escopo, papel, revisão, replay, preço e estoque. RPCs de escrita bloqueiam pedido antes dos recursos de venda; RLS, FKs compostas e grants mínimos preservam empresa/loja. A auditoria é transacional e append-only. A interface mantém a chave de tentativa para resposta ambígua e não informa sucesso sem resposta confirmada. Dados reais, mensageria, consentimento/retenção, pagamentos e fretes dependem de decisões posteriores.
