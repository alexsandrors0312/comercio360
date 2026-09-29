import { z } from "zod";
export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export const contextSchema = z.object({
  organizationId: z.uuid(),
  storeId: z.uuid(),
});
