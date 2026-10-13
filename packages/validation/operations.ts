import { z } from "zod";

export const operationsReportSchema = z.object({
  type: z.enum(["sales", "stock"]).default("sales"),
  status: z.enum(["all", "confirmed", "cancelled"]).default("all"),
  query: z.string().trim().max(200).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
