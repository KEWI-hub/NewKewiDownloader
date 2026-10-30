// Form controls built on the reference classes in design/components.css.

import { type ReactNode, useEffect, useId, useState } from "react";
import { Icon, type IconName } from "../design/icons";
import { formatBytes, parseRate } from "../lib/format";
import { t } from "../lib/i18n";
import { openMenuAt } from "./MenuHost";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  children,
  indeterminate,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  children?: ReactNode;
  indeterminate?: boolean;
}) {
  const box = (
    <button
      type="button"
      role="checkbox"
      className="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={children ? undefined : label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      {indeterminate ? <Icon name="minus" size={12} strokeWidth={2.5} /> : checked ? <Icon name="check" size={12} strokeWidth={2.5} /> : null}
    </button>
  );
  if (!children) return box;
  return (
    <label className="check" onClick={() => onChange(!checked)}>
      {box}
      <span>{children}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  size?: "sm";
  label: string;
}) {
  return (
    <div className={`segmented${size ? " segmented--sm" : ""}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          className="segmented__item"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="segmented__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface SelectOption<T> {
  value: T;
  label: string;
  icon?: IconName;
  hint?: string;
}

/** Custom select (menu-based, matches the glass menus; keyboard: Enter/Space/ArrowDown opens). */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  icon,
  label,
  className,
  width,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  icon?: IconName;
  label: string;
  className?: string;
  width?: number;
}) {
  const cur = options.find((o) => o.value === value);
  const open = (el: HTMLElement) =>
    openMenuAt(
      el,
      options.map((o) => ({ label: o.hint ? `${o.label} — ${o.hint}` : o.label, checked: o.value === value, onSelect: () => onChange(o.value) })),
    );
  return (
    <button
      type="button"
      className={`input select ${className ?? ""}`}
      style={width ? { width } : undefined}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          open(e.currentTarget);
        }
      }}
    >
      {(cur?.icon ?? icon) && <Icon name={(cur?.icon ?? icon)!} size={15} />}
      <span className="input__value">{cur?.label ?? String(value)}</span>
      <Icon name="chevrons-up-down" size={14} />
    </button>
  );
}

export function TextField({
  value,
  onChange,
  onCommit,
  placeholder,
  icon,
  mono,
  type = "text",
  label,
  invalid,
  autoFocus,
  onEnter,
  trailing,
}: {
  value: string;
  onChange?: (v: string) => void;
  /** Called on blur / Enter — use for settings that save on commit. */
  onCommit?: (v: string) => void;
  placeholder?: string;
  icon?: IconName;
  mono?: boolean;
  type?: "text" | "password" | "url" | "number";
  label: string;
  invalid?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  trailing?: ReactNode;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <label className={`input${invalid ? " input--invalid" : ""}`}>
      {icon && <Icon name={icon} size={15} />}
      <input
        type={type}
        value={local}
        aria-label={label}
        placeholder={placeholder}
        className={mono ? "t-mono" : undefined}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={() => onCommit && local !== value && onCommit(local)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommit?.(local);
            onEnter?.();
          }
        }}
      />
      {trailing}
    </label>
  );
}

export function NumberField({
  value,
  onCommit,
  min = 0,
  max = 1_000_000,
  label,
  suffix,
  width = 120,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  suffix?: string;
  width?: number;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(local) || 0)));
    setLocal(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <label className="input" style={{ width }}>
      <input
        inputMode="numeric"
        aria-label={label}
        value={local}
        onChange={(e) => setLocal(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = Math.min(max, Math.max(min, (Number(local) || 0) + (e.key === "ArrowUp" ? 1 : -1)));
            setLocal(String(n));
            onCommit(n);
          }
        }}
      />
      {suffix && <span className="input__suffix">{suffix}</span>}
    </label>
  );
}

export function Stepper({ value, onChange, min = 1, max = 99, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={t("Decrease {label}", { label })} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={13} strokeWidth={2} />
      </button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label={t("Increase {label}", { label })} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Icon name="plus" size={13} strokeWidth={2} />
      </button>
    </span>
  );
}

/** Speed input: accepts "5M", "800k", "2.5 MB/s"; 0 / empty = unlimited. */
export function RateField({ value, onCommit, label, width = 130 }: { value: number; onCommit: (bps: number) => void; label: string; width?: number }) {
  const show = (v: number) => (v > 0 ? `${formatBytes(v)}/s` : "");
  const [local, setLocal] = useState(show(value));
  useEffect(() => setLocal(show(value)), [value]);
  const commit = () => {
    const bps = local.trim() ? parseRate(local) : 0;
    setLocal(show(bps));
    if (bps !== value) onCommit(bps);
  };
  return (
    <label className="input" style={{ width }}>
      <Icon name="speed-limiter" size={14} />
      <input aria-label={label} value={local} placeholder={t("Unlimited")} onChange={(e) => setLocal(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

/** Editable list (one entry per line or comma-separated). */
export function ListField({ value, onCommit, label, placeholder, rows = 3 }: { value: string[]; onCommit: (v: string[]) => void; label: string; placeholder?: string; rows?: number }) {
  const [local, setLocal] = useState(value.join(", "));
  useEffect(() => setLocal(value.join(", ")), [value]);
  return (
    <textarea
      className="textarea"
      aria-label={label}
      rows={rows}
      placeholder={placeholder}
      value={local}
      spellCheck={false}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const list = local.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        if (list.join(",") !== value.join(",")) onCommit(list);
      }}
    />
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--pct" as string]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Label + hint + control in a settings-style row. */
export function Row({ title, hint, children, align }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; align?: "start" }) {
  const id = useId();
  return (
    <div className={`srow${align ? " srow--start" : ""}`} aria-labelledby={id}>
      <div className="srow__txt">
        <div className="srow__t1" id={id}>
          {title}
        </div>
        {hint && <div className="srow__t2">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Field with label above (dialogs). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function TextArea({ value, onChange, label, placeholder, rows = 2 }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; rows?: number }) {
  return <textarea className="textarea" aria-label={label} rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}
