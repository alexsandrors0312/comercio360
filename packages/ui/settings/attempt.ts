import {
  settingsCommandSchema,
  type SettingsCommand,
} from "../../validation/settings";
export function settingsAttemptKey(userId: string, scope: string) {
  return `c360:settings:v1:${userId}:${scope}`;
}
export function loadSettingsAttempt(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  return raw === null ? null : settingsCommandSchema.parse(JSON.parse(raw));
}
export function saveSettingsAttempt(
  storage: Storage,
  key: string,
  command: SettingsCommand,
) {
  const value = JSON.stringify(settingsCommandSchema.parse(command));
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("Storage unavailable");
}
export function clearSettingsAttempt(storage: Storage, key: string) {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Storage unavailable");
}
