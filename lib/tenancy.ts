import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, isConfigured } from "./supabase/server";
import {
  selectContext,
  selectableOrganizations,
  type Store,
  type Organization,
  type Membership,
} from "@/packages/domain/tenancy";
// React render/request memoization only: never persist authorization across requests.
export const requireAccess = cache(async function requireAccess() {
  if (!isConfigured()) redirect("/login?reason=configuration");
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const [members, orgs, units] = await Promise.all([
    supabase
      .from("memberships")
      .select("id,organization_id,user_id,role,active")
      .eq("user_id", user.id)
      .eq("active", true),
    supabase.from("organizations").select("id,name"),
    supabase.from("stores").select("id,organization_id,name"),
  ]);
  if (members.error || orgs.error || units.error)
    throw new Error("Não foi possível carregar seus acessos. Tente novamente.");
  const memberships = members.data as Membership[];
  const stores = units.data as Store[];
  const organizations = selectableOrganizations(
    orgs.data as Organization[],
    stores,
  );
  if (!memberships.length || !organizations.length) redirect("/sem-acesso");
  const jar = await cookies();
  const savedOrg = jar.get("c360-org")?.value;
  const savedStore = jar.get("c360-store")?.value;
  // Context cookies are hints, never an authorization source.
  const active =
    selectContext(stores, savedOrg, savedStore) ?? selectContext(stores)!;
  return { supabase, user, organizations, stores, active, memberships };
});
