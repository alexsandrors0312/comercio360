"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { searchMarketingProducts } from "@/app/actions/marketing";
import type {
  MarketingObjective,
  MarketingProduct,
  MarketingProductSearchData,
  MarketingRichCampaign,
  MarketingRichData,
  MarketingScope,
} from "../../validation/marketing";
import { useManualMutation } from "../manual/mutation";
import { useMarketingContentMutation } from "./mutation";
import { calendarDays, inputDateTime, localDateTimeToIso, monthTitle, plannedDay, plannedTime, shiftMonth } from "./calendar";
import styles from "./marketing.module.css";

type Status = MarketingRichCampaign["status"];
type Channel = MarketingRichCampaign["channel"];
type RichMutation = ReturnType<typeof useMarketingContentMutation>;
type ManualMutation = ReturnType<typeof useManualMutation>;

const statusLabel: Record<Status, string> = {
  draft: "Rascunho", scheduled: "Agendada", completed: "Realizada", cancelled: "Cancelada",
};
const channelLabel: Record<Channel, string> = {
  store: "Loja", whatsapp: "WhatsApp", instagram: "Instagram", other: "Outro",
};
const objectiveLabel = {
  promotion: "Divulgação de produtos", new_arrival: "Novidades",
  clearance: "Giro de estoque", institutional: "Institucional",
} as const;
const weekdayLabel = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function toIso(value: FormDataEntryValue | null) {
  return localDateTimeToIso(String(value ?? ""));
}

function money(value: string | null) {
  if (value === null) return "Preço indisponível";
  return (Number(value) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function coverUrl(scope: MarketingScope, productId: string) {
  const params = new URLSearchParams({ organizationId: scope.organizationId, storeId: scope.storeId });
  return `/api/marketing/covers/${encodeURIComponent(productId)}?${params}`;
}

function StatusPill({ status }: { status: Status }) {
  return <span className={`${styles.pill} ${styles[status]}`}>{statusLabel[status]}</span>;
}

function MutationNotice({ manual, rich }: { manual: ManualMutation; rich: RichMutation }) {
  const needsNotice = manual.storageError || rich.storageError || manual.message || rich.message || manual.attempt || rich.attempt;
  if (!needsNotice) return null;
  return <section className={styles.notice} aria-label="Resultado das operações" aria-live="polite">
    {(manual.storageError || rich.storageError) && <p role="alert">Armazenamento da aba indisponível. Escritas bloqueadas para preservar o reenvio seguro.</p>}
    {manual.message && <p role="status">{manual.message}</p>}
    {rich.message && <p role="status">{rich.message}</p>}
    {manual.attempt && <div className={styles.noticeActions}>
      <p>Há uma alteração de campanha sem resposta confirmada nesta aba.</p>
      <button type="button" disabled={manual.pending || manual.storageError} onClick={() => manual.send(manual.attempt, true)}>Reenviar mesma tentativa</button>
      <button type="button" disabled={manual.pending} onClick={manual.discard}>Descartar tentativa local</button>
    </div>}
    {rich.attempt && <div className={styles.noticeActions}>
      <p>O conteúdo pode ter sido salvo. Confira o registro antes de descartar a tentativa.</p>
      <button type="button" disabled={rich.pending || rich.storageError} onClick={() => rich.send(rich.attempt, true)}>Reenviar mesmo conteúdo</button>
      <button type="button" disabled={rich.pending} onClick={rich.discard}>Descartar tentativa local</button>
    </div>}
  </section>;
}

function CreateCampaign({ month, manual, scope }: { month: string; manual: ManualMutation; scope: MarketingScope }) {
  const [plannedAt, setPlannedAt] = useState(`${month}-01T10:00`);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    manual.send({ module: "marketing", scope,
      key: crypto.randomUUID(), operation: "create", payload: {
        title: form.get("title"), channel: form.get("channel"), plannedAt: toIso(form.get("plannedAt")),
      } });
  }
  return <section className={styles.card} aria-labelledby="marketing-create-title">
    <div className={styles.cardHeading}><div><p className={styles.kicker}>NOVA CAMPANHA</p><h2 id="marketing-create-title">Planejar na loja</h2></div></div>
    <form className={styles.form} onSubmit={create}>
      <label>Título<input name="title" required minLength={3} maxLength={120} placeholder="Ex.: Novidades da semana" /></label>
      <div className={styles.twoFields}>
        <label>Canal planejado<select name="channel" defaultValue="store">
          <option value="store">Loja</option><option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option><option value="other">Outro</option>
        </select></label>
        <label>Data e hora<input type="datetime-local" name="plannedAt" required value={plannedAt} onChange={event => setPlannedAt(event.target.value)} /></label>
      </div>
      <p className={styles.hint}>A campanha começa como rascunho. A data não dispara mensagens nem publicações.</p>
      <button type="submit" disabled={manual.disabled}>Criar rascunho</button>
    </form>
  </section>;
}

function CampaignCard({ campaign, selected, onSelect }: {
  campaign: MarketingRichCampaign; selected: boolean; onSelect: () => void;
}) {
  return <button type="button" className={`${styles.campaignCard} ${selected ? styles.selectedCard : ""}`}
    onClick={onSelect} aria-pressed={selected} aria-label={`${campaign.title}, ${channelLabel[campaign.channel]}, ${statusLabel[campaign.status]}, ${plannedTime(campaign.plannedAt)}`}>
    <span className={styles.cardTop}><span className={`${styles.channelDot} ${styles[campaign.channel]}`} aria-hidden="true" />{channelLabel[campaign.channel]}<StatusPill status={campaign.status} /></span>
    <strong>{campaign.title}</strong>
    <span className={styles.cardMeta}>{plannedTime(campaign.plannedAt)} · {campaign.products.length} {campaign.products.length === 1 ? "produto" : "produtos"}</span>
  </button>;
}

function CalendarView({ month, campaigns, selectedId, onSelect }: {
  month: string; campaigns: MarketingRichCampaign[]; selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const days = calendarDays(month);
  const byDay = new Map<string, MarketingRichCampaign[]>();
  for (const campaign of campaigns) {
    const key = plannedDay(campaign.plannedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), campaign]);
  }
  return <div className={styles.calendarScroll} role="region" aria-label={`Calendário de ${monthTitle(month)}`} tabIndex={0}>
    <div className={styles.calendarGrid}>
      {weekdayLabel.map(label => <div className={styles.weekday} key={label}>{label}</div>)}
      {days.map(day => <section className={`${styles.day} ${day.inMonth ? "" : styles.outsideMonth}`} key={day.key}
        aria-label={`${day.day} de ${monthTitle(day.key.slice(0, 7))}`}>
        <span className={styles.dayNumber}>{day.day}</span>
        {(byDay.get(day.key) ?? []).map(campaign => <button type="button" key={campaign.id}
          className={`${styles.dayCampaign} ${styles[campaign.channel]} ${selectedId === campaign.id ? styles.selectedDayCampaign : ""}`}
          onClick={() => onSelect(campaign.id)} aria-pressed={selectedId === campaign.id}
          title={`${campaign.title} · ${statusLabel[campaign.status]}`}>
          <span>{campaign.title}</span><small>{statusLabel[campaign.status]}</small>
        </button>)}
      </section>)}
    </div>
  </div>;
}

function Preview({ campaign, scope, objective, body, products }: {
  campaign: MarketingRichCampaign; scope: MarketingScope; objective: MarketingObjective;
  body: string; products: MarketingProduct[];
}) {
  return <section className={styles.preview} aria-label="Prévia da campanha">
    <div className={styles.previewHeader}><span>PRÉVIA · {channelLabel[campaign.channel]}</span><span>{objectiveLabel[objective]}</span></div>
    <h3>{campaign.title}</h3>
    <p className={styles.previewBody}>{body.trim() || "Escreva o texto da campanha para ver a prévia."}</p>
    {products.length > 0 && <div className={styles.previewProducts}>
      {products.map(product => <div className={styles.previewProduct} key={product.variantId}>
        <div className={styles.productPhoto}>
          {product.hasCover ? <Image unoptimized src={coverUrl(scope, product.productId)} alt={`Capa de ${product.name}`} width={240} height={240} />
            : <span>Sem capa</span>}
        </div>
        <strong>{product.name}</strong><small>{product.sku}{product.color ? ` · ${product.color}` : ""}{product.size ? ` · ${product.size}` : ""}</small>
        <span className={styles.price}>{money(product.priceCents)}</span>
        <small>Saldo consultado: {product.quantity}</small>
      </div>)}
    </div>}
    <p className={styles.previewFoot}>Prévia interna. Confira preços e disponibilidade antes de divulgar.</p>
  </section>;
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

async function exportPng(campaign: MarketingRichCampaign, scope: MarketingScope, body: string, products: MarketingProduct[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível");
  context.fillStyle = "#f5f8f3"; context.fillRect(0, 0, 1080, 1350);
  context.fillStyle = "#123f34"; context.fillRect(0, 0, 1080, 155);
  context.fillStyle = "#ffffff"; context.font = "bold 32px sans-serif";
  context.fillText("COMÉRCIO 360 · CAMPANHA DA LOJA", 56, 86);
  context.fillStyle = "#17352c"; context.font = "bold 58px sans-serif";
  drawText(context, campaign.title, 56, 230, 950, 65, 2);
  context.fillStyle = "#40584d"; context.font = "30px sans-serif";
  const excerpt = body.trim().slice(0, 170);
  drawText(context, excerpt, 56, 350, 955, 42, 3);
  const cardW = products.length <= 2 ? 450 : 296;
  const columns = products.length <= 2 ? 2 : 3;
  const cardH = products.length <= 3 ? 550 : 365;
  const top = products.length <= 3 ? 515 : 490;
  for (const [index, product] of products.entries()) {
    const x = 56 + (index % columns) * (cardW + 36);
    const y = top + Math.floor(index / columns) * (cardH + 26);
    context.fillStyle = "#ffffff"; context.fillRect(x, y, cardW, cardH);
    const photoH = products.length <= 3 ? 320 : 195;
    if (product.hasCover) {
      const response = await fetch(coverUrl(scope, product.productId), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Capa indisponível: ${product.name}`);
      const bitmap = await createImageBitmap(await response.blob());
      const scale = Math.max(cardW / bitmap.width, photoH / bitmap.height);
      const sw = cardW / scale, sh = photoH / scale;
      context.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, x, y, cardW, photoH);
      bitmap.close();
    } else {
      context.fillStyle = "#e5ede7"; context.fillRect(x, y, cardW, photoH);
      context.fillStyle = "#54685d"; context.font = "22px sans-serif";
      context.fillText("Sem foto cadastrada", x + 22, y + photoH / 2);
    }
    context.fillStyle = "#17352c"; context.font = "bold 27px sans-serif";
    drawText(context, product.name, x + 18, y + photoH + 42, cardW - 36, 34, 2);
    context.fillStyle = "#22654d"; context.font = "bold 34px sans-serif";
    context.fillText(money(product.priceCents), x + 18, y + cardH - 28);
  }
  context.fillStyle = "#425d50"; context.font = "23px sans-serif";
  context.fillText("Preços e saldos consultados no sistema. Confirme antes de divulgar.", 56, 1315);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Falha ao gerar PNG")), "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `campanha-${campaign.id.slice(0, 8)}.png`;
    link.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "", lines = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > width && line) {
      context.fillText(line, x, y + lines * lineHeight); lines++;
      if (lines >= maxLines) return;
      line = word;
    } else line = next;
  }
  if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
}

function CampaignEditor({ campaign, scope, initialProducts, manual, rich, onClose }: {
  campaign: MarketingRichCampaign; scope: MarketingScope; initialProducts: MarketingProductSearchData;
  manual: ManualMutation; rich: RichMutation; onClose: () => void;
}) {
  const terminal = campaign.status === "completed" || campaign.status === "cancelled";
  const [objective, setObjective] = useState<MarketingObjective>(campaign.objective);
  const [body, setBody] = useState(campaign.contentBody);
  const [chosen, setChosen] = useState<MarketingProduct[]>(campaign.products);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState(initialProducts);
  const [searchNotice, setSearchNotice] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [searchPending, startSearch] = useTransition();
  const [exportPending, setExportPending] = useState(false);

  function search(reset: boolean) {
    startSearch(async () => {
      const offset = reset ? 0 : candidates.items.length;
      const result = await searchMarketingProducts({ scope, query, limit: 30, offset });
      if (result.status !== "success") { setSearchNotice(result.message); return; }
      setCandidates(reset ? result.data : {
        items: [...candidates.items, ...result.data.items], total: result.data.total,
      });
      setSearchNotice(result.data.items.length ? "" : "Nenhum produto encontrado.");
    });
  }

  function saveRich(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    rich.send({ scope, campaignId: campaign.id, expectedRevision: campaign.revision,
      objective, contentBody: body, variantIds: chosen.map(item => item.variantId), key: crypto.randomUUID() });
  }

  function updateBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    manual.send({ module: "marketing", scope, key: crypto.randomUUID(), operation: "update", payload: {
      id: campaign.id, revision: campaign.revision, title: form.get("title"),
      channel: form.get("channel"), plannedAt: toIso(form.get("plannedAt")),
    } });
  }

  function transition(status: "scheduled" | "completed" | "cancelled") {
    manual.send({ module: "marketing", scope, key: crypto.randomUUID(), operation: "transition",
      payload: { id: campaign.id, revision: campaign.revision, status } });
  }

  const canWrite = !terminal && !manual.disabled && !rich.disabled;
  const selectedIds = new Set(chosen.map(item => item.variantId));
  const missingPrice = chosen.some(item => item.priceCents === null);
  return <aside className={styles.editor} aria-labelledby="marketing-editor-title">
    <div className={styles.editorHeader}><div><p className={styles.kicker}>EDITOR DE CAMPANHA</p>
      <h2 id="marketing-editor-title" tabIndex={-1}>{campaign.title}</h2></div>
      <button type="button" className={styles.ghostButton} onClick={onClose} aria-label="Fechar editor">Fechar</button>
    </div>
    <div className={styles.editorMeta}>{channelLabel[campaign.channel]} · {plannedTime(campaign.plannedAt)} <StatusPill status={campaign.status} /></div>
    {terminal && <p className={styles.hint}>Campanha encerrada. Os dados ficam disponíveis para consulta.</p>}
    {!terminal && <details className={styles.details}><summary>Editar título, canal e data</summary>
      <form className={styles.form} onSubmit={updateBase}>
        <label>Título<input name="title" required minLength={3} maxLength={120} defaultValue={campaign.title} /></label>
        <label>Canal<select name="channel" defaultValue={campaign.channel}><option value="store">Loja</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="other">Outro</option></select></label>
        <label>Data e hora<input type="datetime-local" name="plannedAt" required defaultValue={inputDateTime(campaign.plannedAt)} /></label>
        <button type="submit" disabled={!canWrite}>Atualizar planejamento</button>
      </form>
    </details>}
    {!terminal && <div className={styles.transitions} aria-label="Alterar estado da campanha">
      {campaign.status === "draft" ? <button type="button" disabled={!canWrite} onClick={() => transition("scheduled")}>Agendar</button>
        : <button type="button" disabled={!canWrite} onClick={() => transition("completed")}>Marcar realizada</button>}
      <button type="button" className={styles.secondaryButton} disabled={!canWrite} onClick={() => transition("cancelled")}>Cancelar</button>
    </div>}
    <form className={styles.form} onSubmit={saveRich}>
      <div className={styles.sectionTitle}><h3>Conteúdo</h3><span>Manual</span></div>
      <label>Objetivo<select value={objective} onChange={event => setObjective(event.target.value as MarketingObjective)} disabled={terminal}>
        {Object.entries(objectiveLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>Texto da campanha<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={2000}
        rows={6} disabled={terminal} placeholder="Escreva a mensagem que será revisada e usada manualmente." /></label>
      <small className={styles.counter}>{body.length}/2000 caracteres</small>
      {!terminal && <div className={styles.productPicker}>
        <div className={styles.sectionTitle}><h3>Produtos vinculados</h3><span>{chosen.length}/6</span></div>
        <p className={styles.hint}>Preço e saldo pertencem à loja selecionada. Vincular não altera o PDV nem reserva estoque.</p>
        {chosen.length > 0 && <ul className={styles.chosenList}>{chosen.map(product => <li key={product.variantId}>
          <span><strong>{product.name}</strong><small>{product.sku} · {money(product.priceCents)} · saldo {product.quantity}</small></span>
          <button type="button" className={styles.ghostButton} disabled={!canWrite} onClick={() => setChosen(items => items.filter(item => item.variantId !== product.variantId))}
            aria-label={`Remover ${product.name}, SKU ${product.sku}`}>Remover</button>
        </li>)}</ul>}
        <div className={styles.searchRow}><label>Buscar produto ou SKU<input value={query} onChange={event => setQuery(event.target.value)} maxLength={200} /></label>
          <button type="button" className={styles.secondaryButton} disabled={searchPending} onClick={() => search(true)}>Buscar</button></div>
        {searchNotice && <p role="status">{searchNotice}</p>}
        <ul className={styles.candidateList}>{candidates.items.map(product => <li key={product.variantId}>
          <span><strong>{product.name}</strong><small>{product.sku}{product.color ? ` · ${product.color}` : ""}{product.size ? ` · ${product.size}` : ""} · {money(product.priceCents)} · saldo {product.quantity}</small></span>
          <button type="button" disabled={!canWrite || chosen.length >= 6 || selectedIds.has(product.variantId)}
            onClick={() => setChosen(items => [...items, product])} aria-label={`Adicionar ${product.name}, SKU ${product.sku}`}>
            {selectedIds.has(product.variantId) ? "Vinculado" : "Adicionar"}</button>
        </li>)}</ul>
        {candidates.items.length < candidates.total && <button type="button" className={styles.ghostButton} disabled={searchPending} onClick={() => search(false)}>Carregar mais produtos</button>}
      </div>}
      {!terminal && <button type="submit" disabled={!canWrite}>Salvar conteúdo e produtos</button>}
    </form>
    <Preview campaign={campaign} scope={scope} objective={objective} body={body} products={chosen} />
    <div className={styles.outputActions}>
      <button type="button" className={styles.secondaryButton} disabled={!body.trim()} onClick={() => {
        void copyText(body).then(() => setExportNotice("Texto copiado."), () => setExportNotice("Não foi possível copiar o texto."));
      }}>Copiar texto</button>
      <button type="button" disabled={exportPending || chosen.length === 0 || missingPrice} onClick={async () => {
        setExportPending(true);
        setExportNotice("");
        try { await exportPng(campaign, scope, body, chosen); setExportNotice("Encarte PNG gerado. Confira preços e saldo antes de divulgar."); }
        catch { setExportNotice("Não foi possível gerar o encarte. Confira as capas e tente novamente."); }
        finally { setExportPending(false); }
      }}>Baixar encarte PNG</button>
    </div>
    {missingPrice && <p className={styles.warning} role="alert">Há produto sem preço nesta loja. Atualize a campanha antes de gerar o encarte.</p>}
    {exportNotice && <p role="status">{exportNotice}</p>}
    <p className={styles.hint}>Nenhuma mensagem é enviada e nenhuma publicação é feita pelo sistema.</p>
  </aside>;
}

export function MarketingWorkspace013({ data, products, scope, userId, storeName, month }: {
  data: MarketingRichData; products: MarketingProductSearchData; scope: MarketingScope;
  userId: string; storeName: string; month: string;
}) {
  const router = useRouter();
  const manual = useManualMutation("marketing", userId, `${scope.organizationId}:${scope.storeId}`);
  const rich = useMarketingContentMutation(userId, scope.organizationId, scope.storeId);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [status, setStatus] = useState<Status | "all">("all");
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selected = data.campaigns.find(item => item.id === selectedId);
  const visible = useMemo(() => data.campaigns.filter(item =>
    (status === "all" || item.status === status) && (channel === "all" || item.channel === channel)),
  [data.campaigns, status, channel]);

  function choose(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function goMonth(next: string) { router.push(`/app/marketing?mes=${next}`); }

  return <div className={styles.workspace}>
    <header className={styles.pageHeader}>
      <p className={styles.kicker}>OPERAÇÃO · {storeName}</p>
      <h1>Calendário de marketing</h1>
      <p>Planeje campanhas, reúna produtos do catálogo e prepare materiais para uso manual.</p>
      <p className={styles.headerBoundary}>Nenhuma mensagem é enviada e nenhuma publicação é feita pelo sistema.</p>
    </header>
    <MutationNotice manual={manual} rich={rich} />
    <div className={styles.layout}>
      <div className={styles.main}>
        <CreateCampaign key={month} month={month} manual={manual} scope={scope} />
        <section className={styles.card} aria-labelledby="marketing-calendar-title">
          <div className={styles.calendarHeading}>
            <div><p className={styles.kicker}>PLANEJAMENTO</p><h2 id="marketing-calendar-title">Calendário de campanhas</h2></div>
            <div className={styles.monthControls}>
              <button type="button" className={styles.ghostButton} onClick={() => goMonth(shiftMonth(month, -1))} aria-label="Mês anterior">←</button>
              <strong aria-live="polite">{monthTitle(month)}</strong>
              <button type="button" className={styles.ghostButton} onClick={() => goMonth(shiftMonth(month, 1))} aria-label="Próximo mês">→</button>
            </div>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.viewSwitch} aria-label="Modo de visualização">
              <button type="button" onClick={() => setView("calendar")} aria-pressed={view === "calendar"}>Calendário</button>
              <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"}>Lista</button>
            </div>
            <label>Estado<select value={status} onChange={event => setStatus(event.target.value as Status | "all")}>
              <option value="all">Todos</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Canal<select value={channel} onChange={event => setChannel(event.target.value as Channel | "all")}>
              <option value="all">Todos</option>{Object.entries(channelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
          {data.hasMore && <p className={styles.warning} role="status">Este calendário mostra somente as primeiras 200 campanhas do período. As demais não estão disponíveis nesta visualização.</p>}
          {visible.length === 0 ? <p className={styles.empty}>Nenhuma campanha para estes filtros neste período.</p>
            : view === "calendar" ? <CalendarView month={month} campaigns={visible} selectedId={selectedId} onSelect={choose} />
              : <ul className={styles.list}>{visible.map(item => <li key={item.id}><CampaignCard campaign={item} selected={selectedId === item.id} onSelect={() => choose(item.id)} /></li>)}</ul>}
        </section>
      </div>
      <div className={styles.side}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.srOnly}>Detalhes da campanha</h2>
        {selected ? <CampaignEditor key={`${selected.id}:${selected.revision}`} campaign={selected} scope={scope} initialProducts={products}
          manual={manual} rich={rich} onClose={() => setSelectedId(null)} />
          : <section className={`${styles.card} ${styles.selectPrompt}`}><p className={styles.kicker}>PRÓXIMO PASSO</p>
            <h2>Escolha uma campanha</h2><p>Selecione um card no calendário ou na lista para editar conteúdo, vincular produtos e preparar o encarte.</p></section>}
      </div>
    </div>
  </div>;
}
