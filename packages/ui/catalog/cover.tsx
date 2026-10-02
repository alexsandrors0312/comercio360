"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CatalogScope } from "@/lib/catalog/server";
import styles from "@/app/app/produtos/catalog.module.css";

type ApiResult = { status?: string; message?: string; revision?: string };
type Feedback = { kind: "success" | "error" | "conflict"; message: string };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function imageUrl(scope: CatalogScope, productId: string, revision: string) {
  const params = new URLSearchParams({
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    revision,
  });
  return (
    "/api/catalog/images/" +
    encodeURIComponent(productId) +
    "?" +
    params.toString()
  );
}
async function parseResult(response: Response): Promise<ApiResult> {
  try {
    const result: unknown = await response.json();
    return result && typeof result === "object" ? (result as ApiResult) : {};
  } catch {
    return {};
  }
}

export function CatalogCover({
  scope,
  productId,
  productName,
  revision,
  hasCover,
  canWrite,
  active,
}: {
  scope: CatalogScope;
  productId: string;
  productName: string;
  revision: string;
  hasCover: boolean;
  canWrite: boolean;
  active: boolean;
}) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [coverPresent, setCoverPresent] = useState(hasCover);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function announce(next: Feedback) {
    setFeedback(next);
    requestAnimationFrame(() => feedbackRef.current?.focus());
  }

  function choose(file: File | null) {
    setFeedback(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES || !ACCEPTED_TYPES.includes(file.type)) {
      announce({
        kind: "error",
        message: "Escolha JPEG, PNG ou WebP de até 5 MB.",
      });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || pending) return;
    const body = new FormData();
    body.set("file", selectedFile);
    body.set("organizationId", scope.organizationId);
    body.set("storeId", scope.storeId);
    body.set("expectedRevision", currentRevision);
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(
        "/api/catalog/images/" + encodeURIComponent(productId),
        {
          method: "POST",
          body,
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const result = await parseResult(response);
      if (response.status === 409) {
        announce({
          kind: "conflict",
          message:
            result.message || "O produto mudou. Recarregue e tente novamente.",
        });
      } else if (
        !response.ok ||
        result.status !== "success" ||
        !result.revision
      ) {
        announce({
          kind: "error",
          message:
            result.message ||
            "Não foi possível enviar a capa. Tente novamente.",
        });
      } else {
        setCoverPresent(true);
        setCurrentRevision(result.revision);
        setImageFailed(false);
        setSelectedFile(null);
        setPreviewUrl(null);
        if (inputRef.current) inputRef.current.value = "";
        announce({ kind: "success", message: "Capa salva para este produto." });
        router.refresh();
      }
    } catch {
      announce({
        kind: "error",
        message: "Falha de conexão ao enviar a capa. Tente novamente.",
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(
        "/api/catalog/images/" + encodeURIComponent(productId),
        {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: scope.organizationId,
            storeId: scope.storeId,
            expectedRevision: currentRevision,
          }),
        },
      );
      const result = await parseResult(response);
      if (response.status === 409) {
        announce({
          kind: "conflict",
          message:
            result.message || "O produto mudou. Recarregue e tente novamente.",
        });
      } else if (
        !response.ok ||
        result.status !== "success" ||
        !result.revision
      ) {
        announce({
          kind: "error",
          message:
            result.message ||
            "Não foi possível remover a capa. Tente novamente.",
        });
      } else {
        setCoverPresent(false);
        setCurrentRevision(result.revision);
        setConfirmRemove(false);
        announce({
          kind: "success",
          message: "Capa removida. O histórico do produto foi preservado.",
        });
        router.refresh();
      }
    } catch {
      announce({
        kind: "error",
        message: "Falha de conexão ao remover a capa. Tente novamente.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.coverPanel} aria-labelledby="cover-title">
      <div className={styles.sectionHead}>
        <h3 id="cover-title">Capa do produto</h3>
        <span className={styles.count}>
          {coverPresent ? "Capa privada" : "Sem capa"}
        </span>
      </div>
      {coverPresent && !imageFailed ? (
        <Image
          className={styles.coverImage}
          unoptimized
          src={imageUrl(scope, productId, currentRevision)}
          width={480}
          height={320}
          alt={"Capa do produto " + productName}
          onError={() => setImageFailed(true)}
        />
      ) : coverPresent ? (
        <p className={styles.help} role="status">
          Não foi possível carregar a capa. Recarregue a página para tentar
          novamente.
        </p>
      ) : (
        <p className={styles.help}>Este produto ainda não tem capa.</p>
      )}
      <div
        ref={feedbackRef}
        tabIndex={-1}
        role={
          feedback?.kind === "error" || feedback?.kind === "conflict"
            ? "alert"
            : "status"
        }
        className={
          feedback
            ? feedback.kind === "success"
              ? styles.success
              : styles.errorNotice
            : styles.noticeSlot
        }
        aria-live="polite"
      >
        {feedback?.message}
        {feedback?.kind === "conflict" && (
          <button type="button" onClick={() => window.location.reload()}>
            Recarregar dados
          </button>
        )}
      </div>
      {canWrite && active && (
        <>
          <form onSubmit={upload} className={styles.coverForm}>
            <label className={styles.field}>
              <span>{coverPresent ? "Substituir capa" : "Enviar capa"}</span>
              <input
                ref={inputRef}
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  choose(event.currentTarget.files?.[0] ?? null)
                }
                disabled={pending}
                aria-describedby="cover-hint"
              />
              <small id="cover-hint">
                JPEG, PNG ou WebP, até 5 MB. A imagem será validada e armazenada
                de forma privada.
              </small>
            </label>
            {previewUrl && (
              <div className={styles.coverPreview}>
                <strong>Prévia da imagem selecionada</strong>
                <Image
                  className={styles.coverImage}
                  unoptimized
                  src={previewUrl}
                  width={480}
                  height={320}
                  alt={"Prévia da nova capa para " + productName}
                />
              </div>
            )}
            <button
              className={styles.secondary}
              disabled={pending || !selectedFile}
            >
              {pending
                ? "Enviando…"
                : coverPresent
                  ? "Salvar nova capa"
                  : "Salvar capa"}
            </button>
          </form>
          {coverPresent && (
            <div className={styles.removeCover}>
              <button
                type="button"
                className={styles.danger}
                onClick={() => setConfirmRemove(!confirmRemove)}
                aria-expanded={confirmRemove}
                disabled={pending}
              >
                Remover capa
              </button>
              {confirmRemove && (
                <div className={styles.confirm}>
                  <p>Remover a capa não apaga o histórico do produto.</p>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={pending}
                    onClick={() => void remove()}
                  >
                    {pending ? "Removendo…" : "Confirmar remoção"}
                  </button>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setConfirmRemove(false)}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
