"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMarketingContent } from "@/app/actions/marketing";
import {
  marketingSaveCommandSchema,
  type MarketingSaveCommand,
} from "../../validation/marketing";

export function useMarketingContentMutation(userId: string, organizationId: string, storeId: string) {
  const router = useRouter();
  const storageKey = `c360:marketing-rich:v1:${userId}:${organizationId}:${storeId}`;
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<MarketingSaveCommand | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const locked = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        setAttempt(raw ? marketingSaveCommandSchema.parse(JSON.parse(raw)) : null);
        setReady(true);
      } catch { setStorageError(true); }
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);

  function clear() {
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw new Error("Armazenamento indisponível");
    setAttempt(null);
  }

  function send(input: unknown, retry = false) {
    if (!ready || storageError || locked.current || (attempt && !retry)) return;
    const parsed = marketingSaveCommandSchema.safeParse(input);
    if (!parsed.success) { setMessage("Confira o texto e escolha até seis produtos diferentes."); return; }
    const value = parsed.data;
    try {
      const serialized = JSON.stringify(value);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error("Armazenamento indisponível");
    } catch { setStorageError(true); return; }
    setAttempt(value);
    setMessage("");
    locked.current = true;
    start(async () => {
      try {
        const result = await saveMarketingContent(value);
        if (result.status === "success") {
          clear();
          setMessage("Conteúdo da campanha salvo.");
          router.refresh();
        } else {
          setMessage(result.message);
          if (result.status !== "unknown") clear();
          if (result.status === "conflict") router.refresh();
        }
      } catch {
        setMessage("Resposta não confirmada. Reenvie a mesma tentativa.");
      } finally { locked.current = false; }
    });
  }

  function discard() {
    if (pending || !window.confirm("Descartar apenas esta tentativa da aba? Confira a campanha antes de salvar novamente.")) return;
    try {
      clear();
      setMessage("Tentativa local descartada. Confira a campanha atual.");
      router.refresh();
    } catch { setStorageError(true); }
  }

  return {
    ready, storageError, attempt, message, pending, send, discard,
    disabled: !ready || storageError || pending || !!attempt,
  };
}
