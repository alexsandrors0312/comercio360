"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeCustomers,
  CustomerAccessError,
  customerRevision,
  listCustomers,
} from "../../lib/customers/server";
import {
  customerSaveSchema,
  customerSearchSchema,
  customerListSchema,
} from "../../packages/validation/customers";
import type {
  CustomerPage,
  CustomerScope,
  SaveCustomerInput,
  CustomerSaveResult,
  CustomerSearchResult,
} from "../../packages/domain/customers-contracts";

export type CustomerDirectoryResult =
  | { status: "success"; page: CustomerPage }
  | { status: "invalid" | "denied" | "unavailable"; message: string };

type Failure = Exclude<CustomerSaveResult["status"], "success">;
const messages: Record<Failure, string> = {
  invalid: "Confira o nome, telefone e e-mail informados.",
  denied: "Você não tem permissão para salvar clientes nesta loja.",
  conflict:
    "O cliente mudou ou esta chave já foi usada com outros dados. Atualize e revise antes de tentar novamente.",
  unavailable:
    "Não foi possível confirmar o resultado. Confirme o envio anterior com os mesmos dados para evitar duplicidade.",
};
const failure = (status: Failure): CustomerSaveResult => ({
  status,
  message: messages[status],
});
const resultSchema = z
  .array(z.object({ id: z.uuid(), revision: customerRevision }))
  .length(1);

export async function saveCustomer(
  scope: CustomerScope,
  input: SaveCustomerInput,
): Promise<CustomerSaveResult> {
  try {
    const parsed = customerSaveSchema.safeParse(input);
    if (!parsed.success) return failure("invalid");
    const value = parsed.data;
    const access = await authorizeCustomers(
      scope,
      value.customerId === null ? "create" : "edit",
    );
    const { data, error } = await access.supabase.rpc("customers_save", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_customer_id: value.customerId,
      p_expected_revision: value.expectedRevision,
      p_name: value.name,
      p_phone: value.phone,
      p_email: value.email,
      p_active: value.active,
      p_idempotency_key: value.idempotencyKey,
    });
    if (error) {
      if (error.code === "42501") return failure("denied");
      if (error.code === "PT409") return failure("conflict");
      if (["22023", "23514", "23503", "22P02", "22003"].includes(error.code))
        return failure("invalid");
      return failure("unavailable");
    }
    const rows = resultSchema.safeParse(data);
    if (!rows.success) return failure("unavailable");
    revalidatePath("/app/clientes");
    revalidatePath("/app/pdv");
    return {
      status: "success",
      message: "Cliente salvo.",
      ...rows.data[0],
    };
  } catch (error) {
    return failure(
      error instanceof CustomerAccessError ? error.kind : "unavailable",
    );
  }
}

export async function findCustomers(
  scope: CustomerScope,
  query: string,
): Promise<CustomerSearchResult> {
  try {
    await authorizeCustomers(scope);
    const parsed = customerSearchSchema.safeParse({ query });
    if (!parsed.success)
      return {
        status: "invalid",
        message: "Busque por nome, telefone ou e-mail com até 200 caracteres.",
      };
    const customers = await listCustomers(scope, {
      query: parsed.data.query,
      status: "active",
      pageSize: 100,
    });
    return { status: "success", items: customers.items };
  } catch (error) {
    return {
      status: error instanceof CustomerAccessError ? error.kind : "unavailable",
      message: "Não foi possível buscar clientes desta empresa.",
    };
  }
}

export async function searchCustomerDirectory(
  scope: CustomerScope,
  filters: { query: string; status: "all" | "active" | "inactive"; page: number; pageSize?: number },
): Promise<CustomerDirectoryResult> {
  try {
    await authorizeCustomers(scope);
    const parsed = customerListSchema.safeParse(filters);
    if (!parsed.success)
      return { status: "invalid", message: "Confira a busca e a página informadas." };
    const page = await listCustomers(scope, parsed.data);
    return { status: "success", page };
  } catch (error) {
    return {
      status: error instanceof CustomerAccessError ? error.kind : "unavailable",
      message: "Não foi possível buscar clientes desta empresa.",
    };
  }
}
