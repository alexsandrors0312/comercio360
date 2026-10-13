# ADR-0016 — Consultas operacionais sobre leitores autorizados

12/10/2026. Decisão de implementação para o [Pacote008](../PACOTE_008_CONSULTAS_OPERACIONAIS.md), recorte da continuidade fictícia do SaaS autorizada pelo responsável.

O painel autenticado ainda mostra métricas fixas de apresentação; Relatórios ainda não permite consultar a operação registrada. Compor os leitores já autorizados de Estoque/PDV/Pedidos resolve esse passo sem duplicar regras, conceder privilégios ou inventar uma contabilidade. Contagens usam o total retornado pelo banco; valores por venda são os snapshots existentes. Contagem de vendas confirmadas não é receita recebida.

Alternativas: somar apenas uma página (rejeitada, trunca métricas); percorrer todas as páginas para calcular receita (rejeitada por custo e ausência de contrato financeiro); criar RPC agregadora privilegiada (adiada, desnecessária para contagens/consultas atuais); continuar com números fictícios fixos na operação autenticada (substituída por dados cadastrados, ainda fictícios no ambiente de desenvolvimento).

O escopo de loja vem de `requireAccess`; cada leitor revalida sessão/papel/loja no servidor e banco. Um papel no contexto só orienta apresentação; a autorização efetiva permanece no módulo de origem. Comprador/estoquista acessam apenas consulta de estoque. Leituras podem observar instantes distintos, sem garantia de snapshot conjunto; a UI explicita isso e não transforma falha em zero.

Sem nova persistência, migração, acesso a custos/contatos, exportação ou escrita. A demo pública conserva seus mocks. Evoluções com períodos, indicadores financeiros, exportação ou agregação entre lojas exigem contrato próprio, autorização e definição da origem de cada métrica. Dados reais e homologação remota permanecem fora deste ciclo.
