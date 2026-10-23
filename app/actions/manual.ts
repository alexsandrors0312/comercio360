"use server";
import { executeManual } from "@/lib/manual/server";
export async function manualAction(input: unknown) {
  return executeManual(input);
}
