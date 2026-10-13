"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { settingsAction } from "@/app/actions/settings";
import {
  settingsCommandSchema,
  type SettingsCommand,
} from "../../validation/settings";
import {
  clearSettingsAttempt,
  loadSettingsAttempt,
  saveSettingsAttempt,
  settingsAttemptKey,
} from "./attempt";
export function useSettingsMutation(
  userId: string,
  scope: string,
  destination?: string,
) {
  const router = useRouter();
  const key = settingsAttemptKey(userId, scope);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<SettingsCommand | null>(null);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const locked = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const recovered = loadSettingsAttempt(sessionStorage, key);
        uncertain.current = recovered !== null;
        setAttempt(recovered);
        setReady(true);
      } catch {
        setStorageError(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  function send(input: unknown, retry = false) {
    if (!ready || storageError || locked.current || (attempt && !retry)) return;
    const parsed = settingsCommandSchema.safeParse(input);
    if (!parsed.success) {
      setMessage("Confira os campos obrigatórios, nomes, acessos e revisões.");
      return;
    }
    const value = parsed.data;
    try {
      saveSettingsAttempt(sessionStorage, key, value);
    } catch {
      setStorageError(true);
      return;
    }
    setAttempt(value);
    setMessage("");
    locked.current = true;
    start(async () => {
      try {
        const result = await settingsAction(value);
        if (result.status === "success") {
          clearSettingsAttempt(sessionStorage, key);
          uncertain.current = false;
          setAttempt(null);
          setMessage("Alteração confirmada.");
          if (value.kind === "manage" && value.mutation.operation === "invite")
            setCode(value.mutation.payload.code);
          if (destination) router.push(destination);
          else router.refresh();
        } else {
          setMessage(result.message);
          const keep =
            result.status === "unknown" ||
            (result.status === "denied" && uncertain.current);
          if (keep) uncertain.current = true;
          else {
            clearSettingsAttempt(sessionStorage, key);
            uncertain.current = false;
            setAttempt(null);
          }
        }
      } catch {
        uncertain.current = true;
        setMessage("Resposta não confirmada. Reenvie a mesma tentativa.");
      } finally {
        locked.current = false;
      }
    });
  }
  function discard() {
    if (
      pending ||
      !window.confirm(
        "Descartar apenas a tentativa desta aba? Isso não desfaz uma alteração já registrada. Confira os registros antes de criar outra.",
      )
    )
      return;
    try {
      clearSettingsAttempt(sessionStorage, key);
      uncertain.current = false;
      setAttempt(null);
      setMessage("Tentativa local descartada. Confira os registros.");
      router.refresh();
    } catch {
      setStorageError(true);
    }
  }
  return {
    ready,
    storageError,
    pending,
    attempt,
    message,
    code,
    send,
    discard,
    clearCode: () => setCode(""),
    disabled: !ready || storageError || pending || !!attempt,
  };
}
