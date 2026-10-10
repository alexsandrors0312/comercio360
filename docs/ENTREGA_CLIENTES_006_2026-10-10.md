# Entrega Clientes006 e homologação integrada — 10/10/2026

O [Pacote006](PACOTE_006_CLIENTES.md) e a [ADR-0014](adr/ADR-0014-clientes-venda.md) estão implementados no ambiente de desenvolvimento fictício. O cadastro é isolado por empresa, exige vínculo e loja concedida, e permite nome com telefone/e-mail opcionais. Proprietário, gerente e caixa consultam/criam; somente proprietário/gerente editam ou inativam com revisão concorrente. A busca de contato usa Server Action POST, sem colocar nome, telefone ou e-mail na URL. O PDV associa cliente opcional e grava ID/nome no snapshot da venda; replay e venda sem cliente preservam o contrato anterior.

## Código e validação local

- Código do recorte no commit `120318073a0f1fd65e2d1f4ada5d86bbadddc3bf`, publicado em `main`. A incremental `202610100001_customers.sql` tem SHA-256 `c13cd8a6c178ff3f26d85f6de48049e5df3e33a5ee44bc119508b04d109cad1c`.
- Domínio 29/29, SQL em PGlite 14/14, integração dirigida 52/52, suíte completa 463/463 Vitest e E2E completo 60/60 PASS. Após ajuste de autorização/busca, os 9/9 E2E de Clientes passaram. Tipos e build PASS; lint com zero erros e um aviso histórico fora do pacote. A inspeção independente do delta não apontou bloqueios; não repetiu execução remota.
- A primeira suíte completa dentro do sandbox teve 455 PASS e 7 FAIL em diagnóstico de seed por loopback. Os 11 testes desse diagnóstico e a suíte completa passaram fora do sandbox. Um E2E de Clientes falhou inicialmente por sincronização do teste; depois passou. Essas tentativas não são reclassificadas.

## Migração, publicação e homologação dev

[Migração006](evidencias/clientes-006-migrate-2026-10-10T18-43-12-878Z.json) aplicada somente no projeto dev, após preflight e conferência do hash. São onze migrações; identidades, senhas, concessões, HMAC, imagens e auditoria anterior foram preservados. Não houve seed, reset ou repair. O build Cloudflare Linux `b82809c2-c7c1-4d67-9a2d-417fd3dbeb75` terminou com sucesso e ativou a versão web `59211b24-4408-45a1-955d-93ce6fdcd0a1` a 100%. O Worker de limpeza permaneceu na versão `13ea018b-4e64-484d-8824-fc3339d25716`.

O [ensaio HTTPS final](evidencias/clientes-006-probe-2026-10-10T18-50-14-972Z.json), run `5737e11b-ddd7-4ed7-a8b5-83d6f0706e78`, passou nas **23 fases**: catálogo, compra/recebimento, cliente, venda com snapshot, saldo, cancelamento/reposição, replay legado, isolamento, autorização e concorrência REST. A disputa pelo último item teve um sucesso; as duas respostas da mesma chave devolveram o mesmo resultado. O instrumento confirmou compensação e arquivamento das fixtures fictícias, sem mutação pendente. O postflight preservou identidades/senhas/concessões, HMAC, imagens, bucket privado e conteúdo dos eventos anteriores; registrou acréscimo global de 60 eventos durante o ensaio e manteve onze migrações. Versões web e de limpeza ficaram estáveis durante o ensaio. A concorrência observada cobre os cenários executados, não todos os interleavings possíveis.

As duas tentativas anteriores continuam intactas: [a primeira](evidencias/clientes-006-probe-2026-10-10T18-46-00-589Z.json) falhou no preflight antes de criar fixtures; [a segunda](evidencias/clientes-006-probe-2026-10-10T18-47-33-268Z.json) passou nas 23 fases e compensou/arquivou, mas ficou FAIL porque o postflight não pôde ser concluído. Com 568 eventos de auditoria no banco, a consulta com todos os IDs como argumento de processo era sensível ao limite de linha de comando do Windows. O instrumento passou a enviar a consulta por arquivo temporário no workspace; sintaxe PowerShell e ensaio completo repetido passaram. Não se atribui PASS retroativo à tentativa anterior.

## Limites e próximo passo

A homologação usa somente dados fictícios no desenvolvimento. Não implementa pagamentos, fiscal, marketing, consentimento/retenção para dados reais ou recuperação completa. O ensaio remoto de cinco horas do Worker de limpeza segue `not_run` e não foi reiniciado. Produção, dados reais e loja piloto continuam pendentes das decisões e gates operacionais próprios. O próximo recorte de produto deve ser definido em contrato e ADR antes de desenvolvimento.
