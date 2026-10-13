import { z } from "zod";
import { SETTINGS_ROLES } from "../domain/settings-contracts";
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const revision = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const role = z.enum(SETTINGS_ROLES);
const stores = z
  .array(z.uuid())
  .max(100)
  .transform((v) => [...new Set(v)].sort());
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const settingsScopeSchema = z.strictObject({
  organizationId: z.uuid(),
  storeId: z.uuid(),
});
export const onboardingSchema = z.strictObject({
  name,
  storeName: name,
  displayName: name,
});
export const acceptanceSchema = z.strictObject({
  code: z.uuid().transform((v) => v.toLowerCase()),
  displayName: name,
});
export const signupSchema = z.strictObject({
  email,
  password: z.string().min(12).max(128),
});
export const settingsMutationSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("rename_organization"),
    payload: z.strictObject({ name, revision }),
  }),
  z.strictObject({
    operation: z.literal("create_store"),
    payload: z.strictObject({ name }),
  }),
  z.strictObject({
    operation: z.literal("update_store"),
    payload: z.strictObject({
      id: z.uuid(),
      name,
      active: z.boolean(),
      revision,
    }),
  }),
  z.strictObject({
    operation: z.literal("update_member"),
    payload: z.strictObject({
      id: z.uuid(),
      role,
      active: z.boolean(),
      storeIds: stores,
      revision,
    }),
  }),
  z.strictObject({
    operation: z.literal("invite"),
    payload: z.strictObject({
      email,
      role,
      storeIds: stores.pipe(z.array(z.uuid()).min(1)),
      code: z.uuid().transform((v) => v.toLowerCase()),
    }),
  }),
  z.strictObject({
    operation: z.literal("revoke_invite"),
    payload: z.strictObject({ id: z.uuid(), revision }),
  }),
]);
export const settingsCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("onboard"),
    payload: onboardingSchema,
    key: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("accept"),
    payload: acceptanceSchema,
    key: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("manage"),
    scope: settingsScopeSchema,
    mutation: settingsMutationSchema,
    key: z.uuid(),
  }),
]);
export type SettingsCommand = z.output<typeof settingsCommandSchema>;
const storeRow = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  revision,
});
export const settingsDataSchema = z.object({
  organization: z.object({ id: z.uuid(), name: z.string(), revision }),
  stores: z.array(storeRow).max(100),
  members: z
    .array(
      z.object({
        id: z.uuid(),
        userId: z.uuid(),
        name: z.string(),
        role,
        active: z.boolean(),
        revision,
        storeIds: z.array(z.uuid()),
      }),
    )
    .max(200),
  invitations: z
    .array(
      z.object({
        id: z.uuid(),
        email: z.string(),
        role,
        status: z.enum(["pending", "accepted", "revoked"]),
        revision,
        expiresAt: z.string(),
        storeIds: z.array(z.uuid()),
      }),
    )
    .max(100),
});
export const settingsResultSchema = z.object({
  id: z.uuid(),
  revision,
  organizationId: z.uuid().optional(),
  storeId: z.uuid().optional(),
});
export const settingsContextResultSchema = settingsResultSchema.extend({
  organizationId: z.uuid(),
  storeId: z.uuid(),
});
