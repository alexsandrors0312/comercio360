"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeInventory,
  InventoryAccessError,
} from "../../lib/inventory/server";
import { inventoryMovementInputSchema } from "../../packages/validation/inventory";
import type {
  InventoryScope,
  InventoryMovementInput,
  InventoryMutationResult,
} from "../../packages/domain/inventory-contracts";

type Failure = Exclude<InventoryMutationResult["status"], "success">;
const messages: Record<Failure, string> = {
  invalid: "Confira a quantidade e informe um motivo de 3 a 240 caracteres.",
  denied: "Você não tem acesso para movimentar o estoque desta loja.",
  conflict:
    "O saldo mudou ou esta operação já foi usada com outros dados. Recarregue e confira antes de tentar novamente.",
  insufficient:
    "Saldo insuficiente para esta saída. Confira a quantidade disponível.",
  unavailable:
    "Não foi possível confirmar a movimentação. Tente novamente com os mesmos dados.",
};
function failure(status: Failure): InventoryMutationResult {
  return { status, message: messages[status] };
}
const mutationRow = z.object({
  id: z.uuid(),
  revision: z
    .union([
      z.string().regex(/^[1-9]\d{0,18}$/),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ])
    .transform(String)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  quantity: z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform(Number)
    .pipe(z.number().int().min(0).max(2147483647)),
});

export async function recordInventoryMovement(
  scope: InventoryScope,
  input: InventoryMovementInput,
): Promise<InventoryMutationResult> {
  try {
    const access = await authorizeInventory(scope, "write");
    const parsed = inventoryMovementInputSchema.safeParse(input);
    if (!parsed.success) return failure("invalid");
    const value = parsed.data;
    const { data, error } = await access.supabase.rpc("inventory_move", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_variant_id: value.variantId,
      p_kind: value.kind,
      p_quantity: value.quantity,
      p_reason: value.reason,
      p_expected_revision: value.expectedRevision,
      p_idempotency_key: value.idempotencyKey,
    });
    if (error) {
      if (error.code === "42501" || error.code === "P0002")
        return failure("denied");
      if (error.code === "PT409") return failure("conflict");
      if (error.code === "PT422") return failure("insufficient");
      if (["22023", "23514", "23503", "22P02", "22003"].includes(error.code))
        return failure("invalid");
      return failure("unavailable");
    }
    const rows = z.array(mutationRow).length(1).safeParse(data);
    if (!rows.success) return failure("unavailable");
    revalidatePath("/app/estoque");
    return {
      status: "success",
      message: "Movimentação registrada.",
      ...rows.data[0],
    };
  } catch (error) {
    return failure(
      error instanceof InventoryAccessError ? error.kind : "unavailable",
    );
  }
}
