# ADR-0010 — Catálogo multiempresa, preços por loja e capa privada

Data: 30/09/2026. Estado: **aceita para implementação do Pacote 002**. O responsável aceitou integralmente a [proposta do Catálogo](../PACOTE_002_CATALOGO_PROPOSTA.md) nesta conversa. Esta decisão autoriza o desenvolvimento no checkout isolado `codex/catalogo-002`; não autoriza publicação, migração hospedada, seed administrativo ou uso de dados reais.

## Contexto e alcance

A [revisão H1](../REVISAO_ARQUITETURAL_H1.md) aprovou a fundação com condições. `organizations` é a raiz do tenant, o vínculo ativo define papel e `user_store_access` concede acesso explícito à loja ativa. Cookie de contexto é preferência, nunca permissão. O Pacote 002 acrescenta categorias, produtos, variantes, preços por loja, pesquisa e uma capa privada opcional, preservando essas regras. Estoque, venda, fiscal, descontos, fornecedores e integrações ficam fora do pacote.

A proposta aceita prevalece para requisitos de produto e critérios de aceite. Este ADR fecha os mecanismos técnicos que seus agentes compartilham. Alterar campos, matriz de papéis, preço por loja ou política de imagem exige nova decisão do responsável e revisão deste ADR.

## Decisão

### Dados e integridade

Criar migração incremental nova, sem editar as duas migrações H1. As tabelas `product_categories`, `products`, `product_variants`, `product_prices` e `product_images` terão `organization_id` obrigatório, UUID próprio e `unique (organization_id, id)` para FKs compostas. Categoria, produto, variante, loja e imagem só podem se relacionar dentro da mesma organização. Chaves estruturais (`id`, `organization_id` e IDs dos pais/loja) são imutáveis em UPDATE também sob DML administrativo comum. Exclusão definitiva não integra o fluxo exposto; desativação conserva registros, preço, imagem e auditoria.

Categoria é comum à organização, sem hierarquia. Seu nome normalizado é único na organização, inclusive entre inativas. Produto pode não ter categoria; uma categoria inativa permanece ligada aos produtos existentes, mas não pode receber associação nova. Produto sem atributos de variação ainda tem uma variante com SKU. SKU normalizado é único na organização, inclusive entre inativos; código de barras é texto para preservar zeros e também é único quando presente. A combinação produto/cor/tamanho trata ausências como iguais. Normalização e limites aceitos na proposta serão especificados em funções puras e conferidos novamente por constraints/índices SQL; a rejeição definitiva ocorre no banco.

Preço é uma linha por variante e loja da mesma organização, em BRL `numeric(12,2)` não negativo. A parte inteira da entrada textual tem até dez dígitos brutos, inclusive zeros à esquerda, e a parte decimal até dois. Entrada e saída monetárias usam texto decimal; ausência de linha representa “Sem preço”, nunca zero. A leitura de preço exige acesso à loja da linha, inclusive em pesquisa, detalhe e joins. Ordenação de busca/paginação é estável, com desempate por ID.

### Autorização e contratos de escrita

`catalog.read` vale somente para `owner`, `manager`, `cashier`, `stockist` e `buyer` com vínculo ativo e pelo menos uma loja ativa explicitamente autorizada na organização. `marketing`, `logistics` e `driver` não recebem leitura neste pacote. `catalog.create`, `catalog.update`, `catalog.deactivate` e alteração de imagem exigem `owner` ou `manager` com loja ativa autorizada; ações de preço exigem acesso à loja específica. O papel não concede bypass de loja. Revogação de vínculo, loja ou papel vale na próxima requisição.

Aplicar RLS nas cinco tabelas, `anon` sem grants e `authenticated` com apenas SELECT filtrado; não conceder DML direto. Leituras por produto/categoria/variante usam helper restrito que combina papel e existência de loja autorizada; preços usam também `private.can_access_store(organization_id, store_id)`. Caminhos de imagem e referências não devem ser revelados fora desse escopo. Escritas usam RPCs específicas com `security definer`, `search_path` fixo, `auth.uid()` e autorização revalidada dentro da transação. Cada RPC recebe valores de negócio tipados, nunca `actor_user_id`, `organization_id` confiado ao cliente sem conferência, SQL dinâmico, payload de auditoria livre ou chave administrativa. Server Actions e rotas autenticadas usam a sessão/chave pública e traduzem erros sem revelar a existência de outro tenant.

O contrato de cada RPC registrará entrada, saída, erro, escopo de loja/tenant, atomicidade, idempotência, versão concorrente e efeito de auditoria antes de seu consumo pela aplicação. Criar produto com variante inicial é uma operação atômica. Mutação de preço é operação separada e transacional. As operações mínimas e seus parâmetros constam do anexo normativo abaixo. Alterar sua semântica exige revisão deste ADR.

### Concorrência, idempotência e auditoria

Edições recebem a versão observada e fazem comparação e troca no banco; versão diferente produz conflito sem sobrescrever a mudança alheia. O servidor não decide concorrência apenas pela hora do cliente. Criação de produto com variante inicial recebe chave idempotente vinculada ao usuário e à organização, persistida com unicidade e resultado recuperável; requisições simultâneas ou repetidas não duplicam o cadastro. Uma chave reaproveitada com conteúdo diferente é conflito.

Criação, edição, preço, desativação e vínculo de imagem inserem `audit_events` na mesma transação da mudança relacional. Falha de auditoria desfaz a escrita. Ator vem de `auth.uid()`, organização/loja são conferidas, `old_value`/`new_value` mantêm o mesmo tenant e não expõem estado de outra organização. A auditoria append-only da fundação permanece. Nenhuma RPC amplia `set_active_store`.

### Capa privada

Usar bucket privado exclusivo do catálogo, caminho opaco sob organização/produto e uma capa ativa por produto. Antes de vincular, validar formato real JPEG/PNG/WebP, tamanho até 5 MB, dimensões e metadados; SVG e conteúdo inválido são recusados. A implementação usa `sharp` 0.35.4 como dependência direta do servidor para decodificar JPEG/PNG/WebP, limitar pixels, corrigir orientação e reencodar sem metadados; a dependência foi verificada com Next 16.3.8 nesta branch. O processamento rejeita entrada/saída acima de 5 MB e dimensões acima de 10.000 px ou 25 milhões de pixels. O formato é detectado pelo decodificador, não pelo MIME declarado. Acesso a objeto/URL temporária exige autorização atual, e políticas de `storage.objects` ficam limitadas ao bucket e caminho do módulo. Nenhum URL público permanente é emitido.

Storage e SQL não formam uma transação única: o servidor valida e reencoda o arquivo, reserva um caminho imutável, sobe os bytes reencodados, atesta conteúdo/escopo com HMAC de chave compartilhada com o banco, troca a referência com controle de versão e auditoria, e enfileira o objeto antigo para limpeza. Falha antes da troca mantém capa anterior; falha na limpeza gera órfão rastreável para rotina restrita, sem apagar auditoria ou tornar o objeto público. O multipart inteiro é limitado a 6 MB mesmo sem `Content-Length`. O objeto reservado não possui política de SELECT nem URL assinada; a leitura só é concedida quando vira capa ativa. Testar upload inválido, autorização, conflito, falha de vínculo e substituição. Não aplicar política global de Storage.

A migração de atestação cria a tabela de chave vazia. Antes da homologação de capa, o operador deve provisionar a mesma chave aleatória de 32 bytes na tabela privada e em `CATALOG_IMAGE_ATTESTATION_KEY` do runtime por canal seguro; segredo nenhum pertence à migração ou ao repositório. O script `scripts/catalog-image-cleanup.mjs` usa credencial administrativa somente fora do Next, exige flag e confirmação independente da URL, e processa objetos elegíveis após duas horas. Seu agendamento e execução hospedada são responsabilidades operacionais ainda não ensaiadas.

### Interface, testes e operação

A aba Produtos deixa o estado “Em construção” apenas quando lista, busca, filtros, detalhe, formulário, categorias e estados reais estiverem integrados. Exibir preço da loja selecionada e explicar que o cadastro é comum à organização. A demonstração pública continua com mocks, sem acesso a catálogo ou bucket reais. Teclado, foco, erros e larguras de 360/768/1440 px integram o aceite.

Testes locais de domínio, PGlite/Auth simulado e navegador verificam regressão; homologação hospedada em ambiente descartável é evidência separada e não altera `H1_RESULTADOS.json`. Migração e seed remotos exigem revisão, ambiente identificado e operação própria. Publicação e dados reais seguem condicionados a HTTPS/cookie Secure, login anônimo, backup/restauração, separação de ambientes e loja piloto identificada.

## Alternativas e consequências

Não duplicar produto por loja: o catálogo é da organização e somente preço é da loja. Não confiar em ocultação visual, cookie ou Server Action como única barreira: RLS e RPC impõem autorização no banco. Não aceitar exclusão física ou rollback que elimine histórico: correções usam migração nova. Não servir a capa em bucket público. O custo dessa decisão é uma camada transacional e de Storage mais detalhada, necessária para isolamento, concorrência e auditoria verificáveis.

## Sequência de implementação

1. Domínio/Validação define normalização, preço decimal, entradas e casos de fronteira; Dados revisa a compatibilidade dos índices/constraints.
2. Infra/Dados cria migração, RLS, RPCs, auditoria e testes SQL sem tocar o banco hospedado.
3. Aplicação implementa leituras e mutações autorizadas contra os contratos estabilizados.
4. Frontend integra fluxos reais; capa privada passa por recorte coordenado de Dados e Aplicação.
5. QA executa critérios no ambiente adequado; Segurança/Arquitetura revisa isolamento e integridade independentemente. O orquestrador integra e registra `pass`, `fail` e `not_run` sem reescrever evidências anteriores.

Um arquivo tem um dono por tarefa. Contratos compartilhados, navegação, migração e documentos de continuidade ficam sob integração do orquestrador. Todos os agentes seguem [CONTRATOS_HARNESS](../ai/CONTRATOS_HARNESS.md), `AGENTS.md` e `context.md`.

## Anexo normativo — fronteiras de implementação

**Normalização.** Categoria tem 1 a 120 caracteres após normalização, limite técnico compatível com a coluna SQL. Nomes preservam acentos para exibição. A chave de categoria usa minúsculas após aparar e colapsar espaços; SKU é aparado e comparado sem distinguir caixa; código de barras é aparado e comparado como texto exato, preservando zeros. Cor/tamanho são aparados, vazio vira ausência, e a combinação por produto compara sem distinguir caixa, tratando duas ausências como iguais. Limites da proposta aplicam-se após normalização. Constraints/índices SQL decidem conflitos finais também sob escrita administrativa.

**Revisão e disputa.** Categoria, produto, variante e preço têm revision bigint iniciado em 1. Cada edição recebe revisão esperada, compara e incrementa atomicamente. Mutação de variante, preço ou capa também incrementa a revisão do produto, para que desativação ou troca concorrente não se perca. A leitura e associação a categoria ativa bloqueiam sua linha na transação; desativação espera essa operação. Associação já concluída permanece, mas uma nova após desativação falha. Guardas SQL preservam a regra sob DML administrativo comum.

**RPCs mínimas.** UUIDs de organização/loja enviados pelo cliente são verificados contra sessão, papel e acesso ativo dentro da transação. Não há parâmetros de ator, evento de auditoria ou chave administrativa. Retornos trazem ID e revisão; erros de existência e autorização não revelam registros de outro tenant. Loja ancora mutações do catálogo comum e é obrigatória para preço.

| Operação | Entrada de negócio | Efeito |
| --- | --- | --- |
| catalog_create_category | organização, loja, nome | cria e audita |
| catalog_update_category | organização, loja, categoria, revisão, nome, ativo | edita/desativa com CAS |
| catalog_create_product | organização, loja, nome, descrição, categoria opcional, SKU inicial, cor/tamanho/código opcionais, chave idempotente | cria produto e variante atomicamente |
| catalog_update_product | organização, loja, produto, revisão, nome, descrição, categoria opcional, ativo | edita/desativa com CAS |
| catalog_create_variant | organização, loja, produto, SKU, cor/tamanho/código opcionais | cria se produto ativo |
| catalog_update_variant | organização, loja, variante, revisão, SKU, cor/tamanho/código opcionais, ativo | edita/desativa com CAS |
| catalog_set_price | organização, loja do preço, variante, revisão esperada ou ausência, valor decimal | cria/edita preço com CAS |
| catalog_set_cover | organização, loja, produto, revisão, objeto validado ou ausência | troca referência com CAS |

A chave idempotente é UUID da tentativa e fica em tabela com unicidade por organização, ator da sessão e chave; o registro guarda payload canônico e resultado. Mesma chave/payload simultânea espera o vencedor e devolve o mesmo resultado; payload divergente gera conflito. Falha aborta registro e criação juntos.

**Auditoria.** Triggers cobrem DML comum além das RPCs; preço registra store_id da própria linha. Falha de auditoria desfaz o DML. A política de SELECT de audit_events deve ser restringida para eventos de Catálogo: exige papel catalog.read e loja ativa autorizada; eventos de preço exigem acesso à loja do evento. A regra antiga que permite ao próprio ator ler snapshots sem esse papel não se aplica aos eventos de Catálogo. Eventos de imagem guardam IDs/metadados necessários, nunca URL assinada, token ou caminho interno. Eventos históricos H1 permanecem preservados.

**Storage.** product_images mantém uma linha de capa ativa por produto. Uma tabela técnica catalog_image_objects registra cada objeto com organização, produto, ator, caminho opaco, estado (reserved, uploaded, active, cleanup_pending, deleted) e horários. A reserva é criada por operação autorizada e vinculada ao usuário; upload passa por endpoint autenticado com sessão pública, limite de 5 MB, validação real de conteúdo/dimensão e remoção de metadados antes do vínculo. Nunca usar chave administrativa no runtime web. Política de storage.objects limita INSERT ao objeto reservado pelo ator e proíbe leitura pública; objeto temporário não pode ser lido por outros usuários nem receber URL de consulta. Capa ativa só é lida após catalog.read e acesso a loja ativa. URL temporária é emitida após autorização atual e vale até cinco minutos. Troca de referência, estado dos objetos e auditoria são transacionais em SQL; a capa anterior permanece ativa até confirmação. Após a troca, o objeto antigo fica cleanup_pending. Falha de vínculo deixa novo objeto no ledger para limpeza. A rotina restrita seleciona apenas cleanup_pending com carência, trava a linha, confirma que não há referência ativa, marca remoção em andamento e só então remove do Storage; retry trata objeto já ausente. Objetos reserved/uploaded recentes não são removidos durante upload em curso. Política de Storage e limpeza ficam limitadas ao bucket/caminho do módulo.
