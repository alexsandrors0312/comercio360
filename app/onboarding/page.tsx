import { requireIdentity } from "@/lib/identity/server";
import { SettingsEntry } from "@/packages/ui/settings/entry";
export default async function Onboarding() {
  const { user } = await requireIdentity();
  return <SettingsEntry key={user.id} kind="onboard" userId={user.id} />;
}
