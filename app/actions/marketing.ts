"use server";

import { revalidatePath } from "next/cache";
import {
  executeMarketingSave,
  MarketingAccessError,
  readMarketingProducts,
  type MarketingSaveResult,
} from "@/lib/marketing/server";
import type { MarketingProductSearchData } from "@/packages/validation/marketing";

export async function saveMarketingContent(input: unknown): Promise<MarketingSaveResult> {
  const result = await executeMarketingSave(input);
  if (result.status === "success") revalidatePath("/app/marketing");
  return result;
}

export type MarketingSearchResult =
  | { status: "success"; data: MarketingProductSearchData }
  | { status: "invalid" | "denied" | "conflict" | "unknown"; message: string };

export async function searchMarketingProducts(input: unknown): Promise<MarketingSearchResult> {
  try {
    return { status: "success", data: await readMarketingProducts(input) };
  } catch (error) {
    const failure = error instanceof MarketingAccessError ? error : new MarketingAccessError("unknown");
    return { status: failure.kind, message: failure.message };
  }
}
