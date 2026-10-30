// Pure list-selection logic (click / Ctrl / Shift / keyboard), shared by the table.

export interface SelectionState {
  selection: string[];
  anchor: string | null;
}

export interface ClickModifiers {
  ctrl?: boolean;
  shift?: boolean;
}

/** Selection after clicking `id` in the ordered list `order`. */
export function clickSelect(order: string[], state: SelectionState, id: string, mods: ClickModifiers = {}): SelectionState {
  if (mods.shift && state.anchor && order.includes(state.anchor)) {
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = order.slice(lo, hi + 1);
    const selection = mods.ctrl ? Array.from(new Set([...state.selection, ...range])) : range;
    return { selection, anchor: state.anchor };
  }
  if (mods.ctrl) {
    const has = state.selection.includes(id);
    return { selection: has ? state.selection.filter((s) => s !== id) : [...state.selection, id], anchor: id };
  }
  return { selection: [id], anchor: id };
}

export type MoveKey = "up" | "down" | "home" | "end" | "pageUp" | "pageDown";

/** Keyboard navigation. `page` = rows per page. Shift extends from the anchor. */
export function moveSelect(order: string[], state: SelectionState, key: MoveKey, shift = false, page = 10): SelectionState {
  if (!order.length) return { selection: [], anchor: null };
  const focus = state.selection.length ? state.selection[state.selection.length - 1] : null;
  const cur = focus ? order.indexOf(focus) : -1;
  let next: number;
  switch (key) {
    case "up":
      next = cur <= 0 ? 0 : cur - 1;
      break;
    case "down":
      next = cur < 0 ? 0 : Math.min(order.length - 1, cur + 1);
      break;
    case "home":
      next = 0;
      break;
    case "end":
      next = order.length - 1;
      break;
    case "pageUp":
      next = Math.max(0, cur - page);
      break;
    case "pageDown":
      next = Math.min(order.length - 1, Math.max(0, cur) + page);
      break;
  }
  const id = order[next];
  if (shift) {
    const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : id;
    const a = order.indexOf(anchor);
    const [lo, hi] = a < next ? [a, next] : [next, a];
    const range = order.slice(lo, hi + 1);
    // keep the moving end last so the next keypress continues from it
    return { selection: [...range.filter((x) => x !== id), id], anchor };
  }
  return { selection: [id], anchor: id };
}
