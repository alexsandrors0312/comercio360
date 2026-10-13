import "server-only";
import { redirect } from "next/navigation";
import { createClient, isConfigured } from "../supabase/server";
export async function requireIdentity() {
  if (!isConfigured()) redirect("/login?reason=configuration");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { user: data.user, supabase };
}
