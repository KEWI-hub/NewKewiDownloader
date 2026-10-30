import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../design/icons";
import { t } from "../lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  width?: number;
  height?: number | string;
  footer?: ReactNode;
  children: ReactNode;
  /** "sheet" = large tool surface (settings, scheduler, grabber); "dialog" = small form. */
  variant?: "dialog" | "sheet";
  className?: string;
  /** Element to focus first (defaults to the first focusable field). */
  initialFocus?: string;
}

/** In-window modal: glass panel over a scrim, Esc / scrim click closes, focus is contained. */
export function Modal({ open, onClose, title, icon, width = 480, height, footer, children, variant = "dialog", className, initialFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const el = ref.current;
      // Dialogs focus their first field; large sheets (settings, scheduler, grabber) focus the
      // panel itself so no text cursor blinks in an unrelated field.
      const selector = initialFocus ?? (variant === "dialog" ? "input:not([type=hidden]), textarea, select, [data-autofocus]" : "[data-autofocus]");
      const first = el?.querySelector<HTMLElement>(selector) ?? el;
      first?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      prev?.focus?.();
    };
  }, [open, initialFocus, variant]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Tab" && ref.current) {
      const nodes = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            tabIndex={-1}
            onKeyDown={onKey}
            className={`modal modal--${variant} glass-strong ${className ?? ""}`}
            style={{ width, height }}
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {title !== undefined && (
              <header className="modal__header">
                {icon}
                <h2 className="modal__title">{title}</h2>
                <button type="button" className="tb-btn modal__close" aria-label={t("Close")} data-tip={t("Close")} data-kbd="Esc" onClick={onClose}>
                  <Icon name="close" size={16} strokeWidth={1.6} />
                </button>
              </header>
            )}
            <div className="modal__body">{children}</div>
            {footer && <footer className="dialog__footer">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
