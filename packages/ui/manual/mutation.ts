"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualAction } from "@/app/actions/manual";
import { manualCommandSchema, type ManualCommand } from "../../validation/manual";

export function useManualMutation(module: string, userId: string, scopeKey: string) {
  const router = useRouter();
  const storageKey = `c360:manual:v1:${module}:${userId}:${scopeKey}`;
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<ManualCommand | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const locked = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const recovered = raw ? manualCommandSchema.parse(JSON.parse(raw)) : null;
        uncertain.current = recovered !== null;
        setAttempt(recovered);
        setReady(true);
      } catch { setStorageError(true); }
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);
  function clear() {
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw new Error("Storage unavailable");
    setAttempt(null);
    uncertain.current = false;
  }
  function send(input: unknown, retry = false) {
    if (!ready || storageError || locked.current || (attempt && !retry)) return;
    const parsed = manualCommandSchema.safeParse(input);
    if (!parsed.success) { setMessage("Confira os campos obrigatórios e valores."); return; }
    const value = parsed.data;
    try {
      const serialized = JSON.stringify(value);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error("Storage unavailable");
    } catch { setStorageError(true); return; }
    setAttempt(value);
    setMessage("");
    locked.current = true;
    start(async () => {
      try {
        const result = await manualAction(value);
        if (result.status === "success") {
          clear();
          setMessage("Operação confirmada.");
          router.refresh();
        } else {
          setMessage(result.message);
          if (result.status === "unknown" || (result.status === "denied" && uncertain.current))
            uncertain.current = true;
          else clear();
        }
      } catch {
        uncertain.current = true;
        setMessage("Resposta não confirmada. Reenvie a mesma tentativa.");
      } finally { locked.current = false; }
    });
  }
  function discard() {
    if (pending || !window.confirm("Descartar apenas a tentativa nesta aba? Confira os registros antes de criar outra.")) return;
    try { clear(); setMessage("Tentativa local descartada. Confira os registros."); router.refresh(); }
    catch { setStorageError(true); }
  }
  return { ready, storageError, attempt, message, pending, send, discard,
    disabled: !ready || storageError || pending || !!attempt };
}
