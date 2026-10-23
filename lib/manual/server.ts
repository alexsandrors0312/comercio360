import "server-only";
import { createClient, isConfigured } from "../supabase/server";
import {
  manualCommandSchema, financeDataSchema, deliveryDataSchema, marketingDataSchema,
  type ManualCommand,
} from "../../packages/validation/manual";

export class ManualAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "conflict" | "unknown") {
    super(kind === "invalid" ? "Confira os campos informados."
      : kind === "denied" ? "Você não tem acesso a este módulo na loja selecionada."
        : kind === "conflict" ? "O registro mudou ou conflita com outra operação. Atualize a página."
          : "Não foi possível confirmar o resultado. Reenvie a mesma tentativa.");
  }
}
function classify(error: { code?: string }) {
  return new ManualAccessError(error.code === "42501" ? "denied"
    : ["PT409", "23505"].includes(error.code ?? "") ? "conflict"
      : ["22023", "22P02", "23514", "23502"].includes(error.code ?? "") ? "invalid" : "unknown");
}
async function identity() {
  if (!isConfigured()) throw new ManualAccessError("unknown");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new ManualAccessError("denied");
  return client;
}
export type ManualScope = { organizationId: string; storeId: string };
async function read(module: "finance" | "deliveries" | "marketing", scope: ManualScope) {
  try {
    const client = await identity();
    const rpc = module === "finance" ? "finance_read" : module === "deliveries" ? "deliveries_read" : "marketing_read";
    const { data, error } = await client.rpc(rpc, { p_org: scope.organizationId, p_store: scope.storeId });
    if (error) throw classify(error);
    return data;
  } catch (error) {
    throw error instanceof ManualAccessError ? error : new ManualAccessError("unknown");
  }
}
export async function readFinance(scope: ManualScope) {
  try { return financeDataSchema.parse(await read("finance", scope)); }
  catch (error) { throw error instanceof ManualAccessError ? error : new ManualAccessError("unknown"); }
}
export async function readDeliveries(scope: ManualScope) {
  try { return deliveryDataSchema.parse(await read("deliveries", scope)); }
  catch (error) { throw error instanceof ManualAccessError ? error : new ManualAccessError("unknown"); }
}
export async function readMarketing(scope: ManualScope) {
  try { return marketingDataSchema.parse(await read("marketing", scope)); }
  catch (error) { throw error instanceof ManualAccessError ? error : new ManualAccessError("unknown"); }
}

export type ManualActionResult =
  | { status: "success"; result: { id: string; status: string; revision?: string } }
  | { status: "invalid" | "denied" | "conflict" | "unknown"; message: string };
export async function executeManual(input: unknown): Promise<ManualActionResult> {
  const parsed = manualCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", message: new ManualAccessError("invalid").message };
  const command: ManualCommand = parsed.data;
  try {
    const client = await identity();
    const base = { p_org: command.scope.organizationId, p_store: command.scope.storeId };
    let response;
    if (command.module === "finance") {
      if (command.operation === "record") response = await client.rpc("finance_record", {
        ...base, p_sale: command.payload.saleId, p_amount: command.payload.amountCents,
        p_method: command.payload.method, p_note: command.payload.note, p_key: command.key,
      });
      else if (command.operation === "reverse") response = await client.rpc("finance_reverse", {
        ...base, p_receipt: command.payload.receiptId, p_reason: command.payload.reason, p_key: command.key,
      });
      else response = await client.rpc("finance_cash", {
        ...base, p_direction: command.payload.direction, p_amount: command.payload.amountCents,
        p_note: command.payload.note, p_key: command.key,
      });
    } else if (command.module === "deliveries") {
      response = await client.rpc("deliveries_mutate", {
        ...base, p_operation: command.operation, p_payload: command.payload, p_key: command.key,
      });
    } else {
      response = await client.rpc("marketing_mutate", {
        ...base, p_operation: command.operation, p_payload: command.payload, p_key: command.key,
      });
    }
    if (response.error) throw classify(response.error);
    const result = response.data;
    if (!result || typeof result.id !== "string" || typeof result.status !== "string")
      throw new ManualAccessError("unknown");
    return { status: "success", result };
  } catch (error) {
    const failure = error instanceof ManualAccessError ? error : new ManualAccessError("unknown");
    return { status: failure.kind, message: failure.message };
  }
}
