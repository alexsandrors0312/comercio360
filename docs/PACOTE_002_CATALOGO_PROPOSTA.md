# Pacote 002 — proposta de Catálogo de Produtos

Data: 26/09/2026. **Escopo integral aceito pelo responsável em 30/09/2026 para implementação no checkout isolado codex/catalogo-002.** A decisão arquitetural está em [ADR-0010](adr/ADR-0010-catalogo-produtos.md); publicação e operações hospedadas não foram autorizadas.

Esta especificação dá continuidade à seção 15C de `architecture/BASE_v0.3.md` e às decisões de `DECISOES_PILOTO.md`. Não altera a fundação 0.1.1, o banco hospedado ou a evidência H1. O parecer da fundação está em `REVISAO_ARQUITETURAL_H1.md`.

## Objetivo e fluxo de aceite

Permitir que o proprietário ou gerente de uma loja de moda e acessórios cadastre uma categoria, um produto e suas variantes de cor/tamanho, informe preços em reais por loja e encontre o cadastro na aba Produtos. Um usuário com permissão de consulta deve conseguir pesquisar esses produtos sem ganhar permissão de edição.

Exemplo fictício: categoria “Blusas”; produto “Camiseta básica”; variantes “Azul / P” e “Azul / M”, cada uma com SKU próprio; preço de R$ 59,90 na Loja Centro. Esse fluxo não cria saldo, movimento de estoque, pedido ou venda.

## Escopo proposto

- Categorias simples, sem hierarquia, com nome e ativação/desativação.
- Produtos com nome, descrição opcional, categoria opcional e estado ativo/inativo.
- Variantes com SKU obrigatório, cor e tamanho opcionais, unidade `UN` no primeiro ciclo e código de barras opcional.
- Preço básico em BRL por variante e loja autorizada; preço ausente aparece como “Sem preço”, sem substituir por zero.
- Uma imagem de capa opcional por produto, armazenada com acesso autenticado.
- Consulta, pesquisa por nome/SKU/código de barras, filtros por categoria e estado e paginação.
- Criação, edição e desativação com validação, autorização no servidor e no banco e auditoria transacional.

Estoque, fornecedores, compras, PDV, descontos, custos/margens, pagamentos, fiscal, importação em massa, etiquetas, WhatsApp, fretes e marketing ficam para pacotes próprios. A Visão Geral continua identificando seus indicadores como fictícios.

## Contratos de dados propostos

| Entidade | Escopo e campos essenciais | Integridade |
| --- | --- | --- |
| `product_categories` | organização, nome, ativo, datas | Nome normalizado de 1 a 120 caracteres; unicidade na organização, inclusive inativos |
| `products` | organização, categoria opcional, nome, descrição, ativo, datas | Categoria da mesma organização; nome 1–120 caracteres, descrição até 2.000 |
| `product_variants` | organização, produto, SKU, cor, tamanho, unidade, código de barras opcional, ativo, datas | Produto da mesma organização; SKU 1–64 caracteres, único por organização após trim/normalização; código de barras tratado como texto para preservar zeros |
| `product_prices` | organização, loja, variante, valor BRL, datas | Loja e variante da mesma organização; uma linha por loja/variante; valor decimal não negativo |
| `product_images` | organização, produto, caminho interno do objeto, tipo, tamanho, datas | Produto da mesma organização; uma capa por produto; caminho controlado pelo servidor |

Todas as relações de negócio usam chaves compostas com `organization_id`. IDs, tenant e relações estruturais não podem ser reatribuídos por UPDATE. Produtos pertencem à organização; preços pertencem à loja. Não criar cópias de produtos por loja nem assumir que a seleção em cookie autoriza leitura/escrita.

Cor e tamanho têm até 60 caracteres cada; valores vazios são normalizados para ausência. A combinação produto/cor/tamanho é única considerando ausências iguais. Produtos sem variação usam uma variante sem cor/tamanho, com SKU próprio. Código de barras, quando informado, tem até 64 caracteres e é único por organização. Uma categoria inativa preserva cadastros associados, mas não pode ser escolhida em novas associações.

Valores monetários entram como texto decimal validado, persistem em `numeric(12,2)` e são apresentados em pt-BR. Não calcular valores financeiros em ponto flutuante no domínio. O limite de armazenamento e o limite de entrada devem coincidir. Código de barras não implica GTIN validado nem emissão fiscal.

## Permissões e isolamento

Matriz de papéis aceita pelo responsável em 30/09/2026:

| Papel do vínculo ativo | Consultar catálogo e preço em loja autorizada | Criar, editar e desativar | Alterar imagem |
| --- | --- | --- | --- |
| Proprietário / gerente | Sim | Sim | Sim |
| Caixa / estoquista / comprador | Sim | Não | Não |
| Marketing / logística / motorista | Não neste pacote | Não | Não |

As ações são `catalog.read`, `catalog.create`, `catalog.update` e `catalog.deactivate`, avaliadas por papel e escopo. Nenhum papel elimina a exigência de loja ativa explicitamente autorizada. O catálogo comum da organização só é acessível quando houver ao menos uma loja autorizada nela. Preços exigem acesso explícito à respectiva loja.

Server Actions usam a sessão e a chave pública, nunca a chave administrativa. RLS protege leituras diretas; escritas são expostas por RPCs específicas com autorização dentro da transação, parâmetros validados e `search_path` fixo. Não aceitar ator ou payload livre de auditoria do navegador. Helpers de autorização têm contrato explícito e privilégios mínimos; não ampliar o significado de `set_active_store`.

Revogação de vínculo/loja ou mudança de papel deve valer na requisição seguinte, com testes pela API e interface. A demonstração pública permanece baseada em mocks, sem acesso ao catálogo real ou ao bucket.

## Auditoria, desativação e concorrência

Registrar criação, edição, mudança de preço, imagem e desativação com organização, loja quando aplicável, ator da sessão, entidade, antes/depois, origem e data. Falha ao auditar desfaz a escrita de negócio. Preservar `audit_events` e sua restrição de consistência de tenant.

Desativação preserva histórico; não expor exclusão definitiva. Produto inativo deixa suas variantes indisponíveis para novos usos, sem apagar variantes/preços/imagem. SKU e código de barras de registros inativos continuam reservados. Categoria inativa não apaga produtos. Reativação, se incluída, exige a mesma autorização de edição e auditoria.

Updates recebem a versão lida (`updated_at` ou contador dedicado) e recusam gravação concorrente sobre versão alterada. A interface informa conflito e permite recarregar. Criação do produto com variante inicial é atômica; repetição de envio não cria duplicatas, usando chave idempotente vinculada ao usuário e à organização. Não introduzir mecanismo genérico de filas ou sincronização offline.

## Imagem de capa

Usar bucket privado separado para catálogo, sem URL pública permanente. Caminho inclui organização/produto/identificador aleatório; URLs temporárias somente após autorização. Aceitar JPEG, PNG e WebP até 5 MB, validando conteúdo real e dimensões, sem SVG. Remover metadados desnecessários e rejeitar arquivos inválidos antes de vinculá-los ao produto.

O armazenamento de arquivos e a transação SQL não são atômicos juntos. Substituição mantém a imagem anterior até o novo objeto e sua referência estarem confirmados. Documentar limpeza de objetos órfãos e erros de remoção sem apagar auditoria; testar falhas de upload, vínculo e substituição. Não liberar o bucket nem criar políticas globais em `storage.objects` que afetem outros módulos.

## Interface e organização do código

Preservar o padrão visual da referência fornecida: navegação verde, contexto empresa/loja, cartões claros e textos em português. Implementar a aba Produtos com lista, busca, filtros, detalhe e formulário; categorias podem ser geridas dentro desse módulo. Exibir preço da loja selecionada e descrição clara do catálogo comum da empresa.

Separar domínio de catálogo, esquemas de entrada, adaptador Supabase e componentes. Mocks só na demonstração. Estados carregando, vazio inicial, busca sem resultados, erro, permissão negada, envio pendente e conflito devem ser reais e acessíveis. Mensagens não devem divulgar dados de outra organização. Verificar teclado, foco em diálogos e larguras de 360, 768 e 1440 px.

## Migração e compatibilidade

Antes de codificar, registrar ADR próprio com modelo, matriz de permissão, política de arquivos, concorrência e contratos das RPCs. Ler a documentação do Next instalado conforme `AGENTS.md`.

Criar somente migrações incrementais novas. Não reescrever, reaplicar ou reparar as versões `202609070001` e `202609080001`. Manter autenticação e seleção de contexto compatíveis com a fundação. Seed novo deve conter apenas dados fictícios e manter a confirmação independente do destino. Aplicação hospedada de migração/seed exige ambiente descartável identificado e execução própria, posterior à revisão dos arquivos.

Reversão após dados: preferir migração corretiva e desativação da funcionalidade, preservando dados e auditoria. Não prometer rollback destrutivo automático. Mudanças de dependências, se necessárias para imagens, devem ter justificativa e compatibilidade registradas antes da instalação.

## Critérios de aceite verificáveis

1. Gerente cadastra categoria, produto, duas variantes, preço e capa; consulta persiste após recarregar, em sessão autorizada.
2. Caixa consulta e pesquisa; tentativas de escrita por chamada direta são negadas no banco sem mudança de dados/auditoria.
3. Usuário de B não lê nem altera catálogo, preços, imagens ou auditoria de A, mesmo conhecendo IDs/caminhos; relações cruzadas falham também sob escrita administrativa comum.
4. Gerente sem acesso à loja não lê/escreve seu preço. Sem nenhuma loja autorizada na organização, não acessa seu catálogo. Revogação passa a valer na requisição seguinte.
5. SKU/composição/código de barras duplicados falham de forma clara; nomes e preços inválidos não são persistidos. Registros desativados preservam histórico.
6. Preços decimais preservam centavos; ausência de preço não vira zero; mudança de preço registra antes/depois e loja correta.
7. Falha de auditoria desfaz a escrita; conflito de edição não sobrescreve mudança alheia; reenvio idempotente não duplica produto/variante.
8. Bucket privado impede leitura/gravação indevida; upload inválido, falha de vínculo e substituição têm tratamento comprovado.
9. Pesquisa/filtros/paginação têm ordenação estável e isolamento no servidor; consulta por ID inválido não revela existência de outro tenant.
10. Estados da interface e navegação funcionam por teclado e nas três larguras; demonstração não executa operação real.
11. Lint, tipos, testes SQL/domínio, build e E2E passam; homologação hospedada do catálogo gera evidência separada, sem regravar `H1_RESULTADOS.json`.
12. README, changelog, ADR, arquitetura e relatório de entrega refletem o que foi executado e as pendências reais.

## Decisão necessária

O aceite de 30/09 confirmou este escopo, os campos de variantes, a matriz de papéis, preços por loja e imagem privada. A loja participante ainda precisa ser identificada antes da validação operacional com o comerciante; isso não pode ser inferido das lojas fictícias do seed. Fiscal/maquininha permanece levantamento para pacote futuro.

O parecer H1 pode liberar a especificação deste pacote sem autorizar publicação. A implementação foi autorizada após o aceite desta proposta e o registro do ADR-0010 no checkout isolado. HTTPS/cookies, login anônimo, backups e produção separada continuam sujeitos às condições da revisão H1.
