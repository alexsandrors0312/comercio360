// Fictional presentation fixtures. Never imported by domain or database adapters.
export const demoOrganizations = [
  { id: "demo-a", name: "Ateliê Aurora" },
  { id: "demo-b", name: "Casa Horizonte" },
];
export const demoStores = [
  { id: "demo-a1", organization_id: "demo-a", name: "Loja Centro" },
  { id: "demo-a2", organization_id: "demo-a", name: "Loja Jardim" },
  { id: "demo-b1", organization_id: "demo-b", name: "Loja Vila Nova" },
];
export const metrics = [
  {
    label: "Vendas de hoje",
    value: "R$ 4.860,00",
    detail: "18 vendas realizadas",
    trend: "+12,8%",
    icon: "sales",
  },
  {
    label: "Ticket médio",
    value: "R$ 270,00",
    detail: "Por venda no período",
    trend: "+6,2%",
    icon: "ticket",
  },
  {
    label: "Pedidos em aberto",
    value: "07",
    detail: "3 aguardando separação",
    trend: "Acompanhar",
    icon: "orders",
  },
  {
    label: "Estoque em atenção",
    value: "12",
    detail: "4 produtos sem estoque",
    trend: "Revisar",
    icon: "stock",
  },
];
export const attention = [
  {
    title: "4 produtos estão sem estoque",
    detail: "Confira a reposição de itens com maior saída.",
    label: "Estoque",
    slug: "estoque",
    tone: "red",
  },
  {
    title: "3 pedidos aguardam separação",
    detail: "Organize os próximos atendimentos da loja.",
    label: "Pedidos",
    slug: "pedidos",
    tone: "amber",
  },
  {
    title: "2 compras aguardam recebimento",
    detail: "Verifique a previsão com os fornecedores.",
    label: "Compras",
    slug: "compras",
    tone: "blue",
  },
];
export const recentOrders = [
  {
    id: "#1048",
    customer: "Cliente exemplo 01",
    channel: "Balcão",
    amount: "R$ 389,90",
    state: "Concluído",
  },
  {
    id: "#1047",
    customer: "Cliente exemplo 02",
    channel: "WhatsApp",
    amount: "R$ 219,00",
    state: "Em separação",
  },
  {
    id: "#1046",
    customer: "Cliente exemplo 03",
    channel: "Balcão",
    amount: "R$ 159,90",
    state: "Concluído",
  },
  {
    id: "#1045",
    customer: "Cliente exemplo 04",
    channel: "Site",
    amount: "R$ 479,00",
    state: "Aguardando",
  },
];
export const bars = [24, 38, 31, 55, 72, 43, 89, 67, 49, 94, 78, 58];
