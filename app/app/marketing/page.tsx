import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { MarketingAccessError, readMarketingProducts, readMarketingRich } from "@/lib/marketing/server";
import { MarketingWorkspace013 } from "@/packages/ui/marketing/workspace";
import { calendarDays, localDateTimeToIso } from "@/packages/ui/marketing/calendar";

function currentMonth() {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  return `${year}-${month}`;
}

function selectedMonth(raw: string | string[] | undefined) {
  if (typeof raw !== "string" || !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(raw))
    return currentMonth();
  return raw;
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string | string[] }>;
}) {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  const month = selectedMonth((await searchParams).mes);
  const days = calendarDays(month);
  const lastDay = days[days.length - 1].key;
  const nextDay = new Date(Date.parse(`${lastDay}T00:00:00Z`) + 86_400_000)
    .toISOString().slice(0, 10);
  // Query precisely the dates shown in the calendar, using its São Paulo timezone.
  const from = localDateTimeToIso(`${days[0].key}T00:00`);
  const until = localDateTimeToIso(`${nextDay}T00:00`);
  let data: Awaited<ReturnType<typeof readMarketingRich>> | null = null;
  let products: Awaited<ReturnType<typeof readMarketingProducts>> | null = null;
  let loadError: MarketingAccessError | null = null;
  try {
    [data, products] = await Promise.all([
      readMarketingRich(scope, from, until),
      readMarketingProducts({ scope, query: "", limit: 30, offset: 0 }),
    ]);
  } catch (error) {
    if (!(error instanceof MarketingAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data || !products) return <section role="alert"><h1>Marketing</h1><p>{loadError?.message}</p>
    {loadError?.kind !== "denied" && <Link href="/app/marketing">Tentar novamente</Link>}</section>;
  return <MarketingWorkspace013 key={access.user.id + scope.organizationId + scope.storeId}
    data={data} products={products} scope={scope} userId={access.user.id}
    storeName={access.active.name} month={month} />;
}
