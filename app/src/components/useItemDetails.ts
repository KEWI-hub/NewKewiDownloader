import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ItemDetails } from "../lib/types";

/** Poll `api.itemDetails(id)` while mounted (and while `enabled`). */
export function useItemDetails(id: string | null | undefined, intervalMs = 500, enabled = true): ItemDetails | null {
  const [details, setDetails] = useState<ItemDetails | null>(null);
  useEffect(() => {
    setDetails(null);
    if (!id || !enabled) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const d = await api.itemDetails(id);
        if (alive) setDetails(d);
      } catch {
        /* transient: keep the last snapshot */
      }
      if (alive && document.visibilityState !== "hidden") timer = window.setTimeout(tick, intervalMs);
      else if (alive) timer = window.setTimeout(tick, intervalMs * 4);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, intervalMs, enabled]);
  return details;
}
