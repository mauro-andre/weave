import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import * as btn from "../styles/button.css.js";
import * as css from "./ConfirmModal.css.js";

/**
 * Modal de confirmação reutilizável para ações destrutivas. Fecha no Esc / clique
 * fora; o botão de confirmar fica em vermelho quando `danger`.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ComponentChildren;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class={css.overlay} onClick={onCancel}>
      <div class={css.modal} onClick={(e) => e.stopPropagation()}>
        <h2 class={css.title}>{title}</h2>
        <p class={css.message}>{message}</p>
        <div class={css.footer}>
          <button type="button" class={btn.ghost} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" class={danger ? btn.danger : btn.primary} disabled={busy} onClick={onConfirm}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
