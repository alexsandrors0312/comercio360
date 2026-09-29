---
name: c360-interface
description: Construir fluxos de interface acessíveis do Comércio 360 com contratos de apresentação e autorização já definidos.
---

# Interface e acessibilidade

Leia `AGENTS.md`, `context.md`, contrato aceito e componentes relevantes em `packages/ui/` e `app/`. Antes de editar código Next.js, consulte `node_modules/next/dist/docs/` para as APIs usadas.

Implemente estados reais de carregamento, vazio, erro, conflito, envio pendente e acesso negado. Preserve foco, operação por teclado, rótulos e mensagens em pt-BR. Confira a apresentação em larguras 360, 768 e 1440 quando o fluxo for afetado. A UI não concede autorização; a operação deve usar o contrato do servidor. Não leve mocks da prévia `/demo` para operações reais.

Relate evidência de interação e limites conforme `docs/ai/CONTRATOS_HARNESS.md`. Se os dados, erros ou permissões da interface não estiverem definidos, peça o contrato antes de supor comportamento.
