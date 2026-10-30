import { useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileTile, ProgressBar } from "../components/Visuals";
import { WindowFrame } from "../components/WindowFrame";
import { Icon } from "../design/icons";
import { api, inTauri } from "../lib/api";
import { formatDuration, formatSpeed } from "../lib/format";
import { t } from "../lib/i18n";
import { formatPct, progressOf, statusView } from "../lib/present";
import { isActive, useApp } from "../lib/store";
import { attempt } from "../lib/ui";

/** Always-on-top glass strip with the active downloads; click opens the main window. */
export default function MiniWindow() {
  const ids = useApp(useShallow((s) => Object.values(s.items).filter((i) => !i.trashed && (isActive(s.progress[i.id]?.status ?? i.status) || i.status === "queued")).sort((a, b) => a.position - b.position).map((i) => i.id)));
  const speed = useApp((s) => Object.values(s.progress).reduce((sum, p) => sum + (p.speed || 0), 0));
  const show = () => void attempt(api.showMain());
  useFitHeight(Math.min(ids.length, 6));
  return (
    <WindowFrame
      kind="mini"
      className="mini blur-xl"
      title={
        <span className="mini__title">
          <Icon name="arrow-down" size={12} strokeWidth={2.4} className="text-accent" />
          <b className="tnum">{formatSpeed(speed) === "—" ? "0 B/s" : formatSpeed(speed)}</b>
          <span className="text-tertiary">· {t("{count} in progress", { count: ids.length })}</span>
        </span>
      }
      onClose={() => void attempt(api.toggleMini())}
    >
      <div className="mini__list">
        {ids.length ? ids.slice(0, 6).map((id) => <MiniRow key={id} id={id} onOpen={show} />) : (
          <button type="button" className="mini__idle" onClick={show}>
            <Icon name="status-completed" size={16} className="text-success" /> {t("Nothing downloading — open Prism")}
          </button>
        )}
      </div>
    </WindowFrame>
  );
}

function MiniRow({ id, onOpen }: { id: string; onOpen: () => void }) {
  const item = useApp((s) => s.items[id]);
  const progress = useApp((s) => s.progress[id]);
  if (!item) return null;
  const p = progressOf(item, progress);
  const sv = statusView(item, progress);
  return (
    <button type="button" className="mini__row" onClick={onOpen} data-tip={sv.detail}>
      <span className="mini__r1">
        <FileTile item={item} size={20} thumbWidth={28} />
        <span className="ellipsis">{item.fileName}</span>
        <b className="tnum">{formatPct(p.pct)}</b>
      </span>
      <ProgressBar value={p.fraction} state={sv.bar} size="thin" label={t("{name} progress", { name: item.fileName })} />
      <span className="mini__r2 tnum">
        {progress?.speed ? `${formatSpeed(progress.speed)} · ${t("{time} left", { time: formatDuration(progress.etaSecs) })}` : sv.label}
      </span>
    </button>
  );
}

/** Shrink/grow the window to its content, keeping the bottom edge in place (it sits above the taskbar). */
function useFitHeight(rows: number) {
  useLayoutEffect(() => {
    if (!inTauri) return;
    // The frame fills the window, so measure its parts instead of the frame itself.
    const title = document.querySelector<HTMLElement>(".mini .wtitle");
    const list = document.querySelector<HTMLElement>(".mini__list");
    if (!title || !list) return;
    const listStyle = getComputedStyle(list);
    const height = Math.ceil(title.offsetHeight + list.scrollHeight + parseFloat(listStyle.marginTop) + parseFloat(listStyle.marginBottom) + 2);
    void (async () => {
      const { getCurrentWindow, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const [scale, pos, size] = await Promise.all([win.scaleFactor(), win.outerPosition(), win.outerSize()]);
      const target = Math.round(height * scale);
      if (Math.abs(target - size.height) < 2) return;
      await win.setSize(new LogicalSize(size.width / scale, height));
      await win.setPosition(new PhysicalPosition(pos.x, pos.y + size.height - target));
    })().catch(() => undefined);
  }, [rows]);
}
