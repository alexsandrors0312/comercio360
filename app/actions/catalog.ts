"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeCatalog,
  CatalogAccessError,
  type CatalogScope,
} from "../../lib/catalog/server";
import {
  catalogCategoryInputSchema,
  catalogCategoryUpdateInputSchema,
  catalogProductCreateInputSchema,
  catalogProductUpdateInputSchema,
  catalogVariantInputSchema,
  catalogVariantUpdateInputSchema,
  catalogPriceInputSchema,
} from "../../packages/validation/catalog";

export type CatalogMutationResult =
  | { status: "success"; message: string; id: string; revision: string }
  | {
      status: "invalid" | "denied" | "conflict" | "duplicate" | "unavailable";
      message: string;
    };

function failure(
  status: Exclude<CatalogMutationResult["status"], "success">,
): CatalogMutationResult {
  const messages = {
    invalid: "Confira os campos informados e tente novamente.",
    denied: "Você não tem acesso para alterar este catálogo.",
    conflict:
      "Este cadastro mudou desde a abertura. Recarregue e tente novamente.",
    duplicate: "Já existe um cadastro com estes dados.",
    unavailable: "Não foi possível salvar agora. Tente novamente.",
  };
  return { status, message: messages[status] };
}

function databaseFailure(code: string): CatalogMutationResult {
  if (code === "42501" || code === "P0002") return failure("denied");
  if (code === "PT409") return failure("conflict");
  if (code === "23505") return failure("duplicate");
  if (["22023", "23502", "23503", "23514", "22P02"].includes(code))
    return failure("invalid");
  return failure("unavailable");
}

async function mutate<T extends z.ZodType>(
  scope: CatalogScope,
  input: z.input<T>,
  schema: T,
  rpcName: string,
  parameters: (value: z.output<T>) => Record<string, unknown>,
): Promise<CatalogMutationResult> {
  try {
    const access = await authorizeCatalog(scope, "write");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return failure("invalid");
    const { data, error } = await access.supabase.rpc(rpcName, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...parameters(parsed.data),
    });
    if (error) return databaseFailure(error.code);
    const row = Array.isArray(data) ? data[0] : data;
    if (
      !row ||
      typeof row.id !== "string" ||
      (typeof row.revision !== "number" && typeof row.revision !== "string")
    ) {
      return failure("unavailable");
    }
    revalidatePath("/app/produtos");
    return {
      status: "success",
      message: "Cadastro salvo.",
      id: row.id,
      revision: String(row.revision),
    };
  } catch (error) {
    if (error instanceof CatalogAccessError) {
      return failure(
        error.kind === "invalid"
          ? "invalid"
          : error.kind === "denied"
            ? "denied"
            : "unavailable",
      );
    }
    return failure("unavailable");
  }
}

export async function createCatalogCategory(
  scope: CatalogScope,
  input: z.input<typeof catalogCategoryInputSchema>,
): Promise<CatalogMutationResult> {
  return mutate(
    scope,
    input,
    catalogCategoryInputSchema,
    "catalog_create_category",
    (value) => ({ p_name: value.name }),
  );
}

export async function updateCatalogCategory(
  scope: CatalogScope,
  categoryId: string,
  input: z.input<typeof catalogCategoryUpdateInputSchema>,
): Promise<CatalogMutationResult> {
  if (!z.uuid().safeParse(categoryId).success) return failure("invalid");
  return mutate(
    scope,
    input,
    catalogCategoryUpdateInputSchema,
    "catalog_update_category",
    (value) => ({
      p_category_id: categoryId,
      p_expected_revision: value.expectedRevision,
      p_name: value.name,
      p_active: value.active,
    }),
  );
}

export async function createCatalogProduct(
  scope: CatalogScope,
  input: z.input<typeof catalogProductCreateInputSchema>,
): Promise<CatalogMutationResult> {
  return mutate(
    scope,
    input,
    catalogProductCreateInputSchema,
    "catalog_create_product",
    (value) => ({
      p_name: value.name,
      p_description: value.description,
      p_category_id: value.categoryId,
      p_sku: value.initialVariant.sku,
      p_color: value.initialVariant.color,
      p_size: value.initialVariant.size,
      p_barcode: value.initialVariant.barcode,
      p_idempotency_key: value.idempotencyKey,
    }),
  );
}

export async function updateCatalogProduct(
  scope: CatalogScope,
  productId: string,
  input: z.input<typeof catalogProductUpdateInputSchema>,
): Promise<CatalogMutationResult> {
  if (!z.uuid().safeParse(productId).success) return failure("invalid");
  return mutate(
    scope,
    input,
    catalogProductUpdateInputSchema,
    "catalog_update_product",
    (value) => ({
      p_product_id: productId,
      p_expected_revision: value.expectedRevision,
      p_name: value.name,
      p_description: value.description,
      p_category_id: value.categoryId,
      p_active: value.active,
    }),
  );
}

export async function createCatalogVariant(
  scope: CatalogScope,
  productId: string,
  input: z.input<typeof catalogVariantInputSchema>,
): Promise<CatalogMutationResult> {
  if (!z.uuid().safeParse(productId).success) return failure("invalid");
  return mutate(
    scope,
    input,
    catalogVariantInputSchema,
    "catalog_create_variant",
    (value) => ({
      p_product_id: productId,
      p_sku: value.sku,
      p_color: value.color,
      p_size: value.size,
      p_barcode: value.barcode,
    }),
  );
}

export async function updateCatalogVariant(
  scope: CatalogScope,
  variantId: string,
  input: z.input<typeof catalogVariantUpdateInputSchema>,
): Promise<CatalogMutationResult> {
  if (!z.uuid().safeParse(variantId).success) return failure("invalid");
  return mutate(
    scope,
    input,
    catalogVariantUpdateInputSchema,
    "catalog_update_variant",
    (value) => ({
      p_variant_id: variantId,
      p_expected_revision: value.expectedRevision,
      p_sku: value.sku,
      p_color: value.color,
      p_size: value.size,
      p_barcode: value.barcode,
      p_active: value.active,
    }),
  );
}

export async function setCatalogPrice(
  scope: CatalogScope,
  variantId: string,
  input: z.input<typeof catalogPriceInputSchema>,
): Promise<CatalogMutationResult> {
  if (!z.uuid().safeParse(variantId).success) return failure("invalid");
  return mutate(
    scope,
    input,
    catalogPriceInputSchema,
    "catalog_set_price",
    (value) => ({
      p_variant_id: variantId,
      p_expected_revision: value.expectedRevision,
      p_amount: value.value,
    }),
  );
}
