import { requireIdentity } from "@/lib/identity/server";
import { SettingsEntry } from "@/packages/ui/settings/entry";
export default async function Invitations() {
  const { user } = await requireIdentity();
  return <SettingsEntry key={user.id} kind="accept" userId={user.id} />;
}
