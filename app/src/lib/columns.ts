// Download table column model. Visibility is persisted in settings.appearance.visibleColumns,
// widths (a per-viewer convenience) in localStorage.

import { tk } from "./i18n";
import type { SortKey } from "./store";

export type ColumnKey =
  | "name"
  | "size"
  | "status"
  | "progress"
  | "speed"
  | "eta"
  | "lastTry"
  | "added"
  | "saveDir"
  | "category"
  | "description";

export interface ColumnDef {
  key: ColumnKey;
  /** Marked for translation: show it with `t(label)`. */
  label: string;
  width: number;
  min: number;
  align?: "end";
  sort?: SortKey;
}

export const COLUMNS: ColumnDef[] = [
  { key: "name", label: tk("Name"), width: 0, min: 160, sort: "name" },
  { key: "size", label: tk("Size"), width: 84, min: 64, align: "end", sort: "size" },
  { key: "status", label: tk("Status"), width: 150, min: 96, sort: "status" },
  { key: "progress", label: tk("Progress"), width: 210, min: 120, sort: "progress" },
  { key: "speed", label: tk("Speed"), width: 92, min: 70, align: "end", sort: "speed" },
  { key: "eta", label: tk("Time left"), width: 84, min: 64, align: "end", sort: "eta" },
  { key: "lastTry", label: tk("Last try"), width: 132, min: 80, align: "end", sort: "lastTry" },
  { key: "added", label: tk("Added"), width: 132, min: 80, align: "end", sort: "added" },
  { key: "saveDir", label: tk("Folder"), width: 200, min: 100, sort: "dir" },
  { key: "category", label: tk("Category"), width: 108, min: 80, sort: "category" },
  { key: "description", label: tk("Description"), width: 200, min: 100 },
];

export const COLUMN_KEYS = COLUMNS.map((c) => c.key);

/** Visible columns in canonical order; the name column is always shown. */
export function resolveColumns(visible: string[] | undefined): ColumnDef[] {
  const set = new Set(visible?.length ? visible : ["name", "size", "status", "progress", "speed", "eta", "added"]);
  set.add("name");
  return COLUMNS.filter((c) => set.has(c.key));
}

export function toggleColumn(visible: string[], key: ColumnKey): string[] {
  if (key === "name") return visible;
  const set = new Set(visible);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return COLUMN_KEYS.filter((k) => set.has(k) || k === "name");
}

/** CSS grid template: leading checkbox, columns (name flexes), trailing actions. */
export function gridTemplate(cols: ColumnDef[], widths: Partial<Record<ColumnKey, number>>): string {
  const parts = cols.map((c) => {
    if (c.key === "name") return `minmax(${widths.name ?? c.min}px, 1fr)`;
    return `${Math.max(c.min, widths[c.key] ?? c.width)}px`;
  });
  return `36px ${parts.join(" ")} 40px`;
}

/** Minimum width of the whole row, so narrow windows scroll horizontally instead of squashing. */
export function minRowWidth(cols: ColumnDef[], widths: Partial<Record<ColumnKey, number>>): number {
  return 36 + 40 + 24 + cols.reduce((sum, c) => sum + (c.key === "name" ? (widths.name ?? c.min) : Math.max(c.min, widths[c.key] ?? c.width)), 0);
}
