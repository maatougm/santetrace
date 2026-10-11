"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from "react";
import type { DialogProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./Dialog.module.css";

export interface DialogExtraProps extends DialogProps {
  /** Accessible name of the close button. Default "Fermer". */
  closeLabel?: string;
  /** Set false to keep the dialog open on backdrop click (e.g. unsaved reason). Default true. */
  closeOnBackdrop?: boolean;
  className?: string;
}

/**
 * Controlled modal on the native <dialog> (showModal): focus trap, Esc and
 * backdrop close, focus returns to the opener, title wired to aria-labelledby.
 *
 * Initial focus goes to the first focusable element in the body/footer (the
 * close button is last in DOM order), so put the primary field first.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "Fermer",
  closeOnBackdrop = true,
  className,
}: DialogExtraProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Bumped when the browser closes the dialog natively; re-syncs if the parent keeps it open.
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keep the native dialog in step with `open`.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (openerRef.current === null) {
        const active = document.activeElement;
        openerRef.current = active instanceof HTMLElement ? active : null;
      }
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, syncTick]);

  // Scroll lock, independent of the sync above so effect re-runs never drop it.
  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  // Return focus to the opener whenever the dialog closes.
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected) {
      opener.focus();
    }
  }, [open]);

  // Esc: keep React in control of `open`.
  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCloseRef.current();
  }

  // Native close (repeat Esc, <form method="dialog">) while React still says open:
  // ask the parent, then re-sync so a vetoed close re-opens the modal.
  function handleClose() {
    if (!open) return;
    onCloseRef.current();
    setSyncTick((tick) => tick + 1);
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  }

  // Only a press that starts AND ends on the backdrop closes (not a text-selection drag).
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    const endedOnBackdrop = event.target === event.currentTarget;
    if (closeOnBackdrop && endedOnBackdrop && pressStartedOnBackdrop.current) {
      onCloseRef.current();
    }
    pressStartedOnBackdrop.current = false;
  }

  return (
    <dialog
      ref={dialogRef}
      className={cx(styles.dialog, styles[size], className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {open ? (
        <div className={styles.panel}>
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          {children !== undefined && children !== null ? <div className={styles.body}>{children}</div> : null}
          {footer ? <div className={styles.footer}>{footer}</div> : null}
          <button
            type="button"
            className={styles.close}
            onClick={() => onCloseRef.current()}
            aria-label={closeLabel}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
