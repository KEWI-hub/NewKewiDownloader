// Context menu for one or more downloads (right-click, "…" button).

import { actions } from "../lib/actions";
import { t } from "../lib/i18n";
import { canPause, canResume, displayName } from "../lib/present";
import { useApp } from "../lib/store";
import { type MenuEntry, useUi } from "../lib/ui";

export function itemMenu(ids: string[]): MenuEntry[] {
  const st = useApp.getState();
  const list = ids.map((id) => st.items[id]).filter(Boolean);
  if (!list.length) return [];
  const one = list.length === 1 ? list[0] : null;
  const ui = useUi.getState();
  const trash = list.every((i) => i.trashed);

  if (trash) {
    return [
      { label: t("Restore"), icon: "retry", onSelect: () => actions.restore(ids) },
      { separator: true },
      { label: t("Delete permanently…"), icon: "delete", danger: true, kbd: "Del", onSelect: () => ui.openDialog({ kind: "delete", ids, trash: true }) },
    ];
  }

  const done = one?.status === "completed";
  const inQueue = list.some((i) => i.queueId);
  const queueEntries: MenuEntry[] = [
    ...st.queues.map((q) => ({
      label: displayName(q.name),
      checked: list.every((i) => i.queueId === q.id),
      onSelect: () => actions.moveToQueue(ids, q.id),
    })),
    { separator: true },
    { label: t("Remove from queue"), disabled: !inQueue, onSelect: () => actions.moveToQueue(ids, null) },
  ];

  return [
    { label: t("Open"), icon: "open-file", kbd: "Enter", disabled: !done, onSelect: () => one && actions.open(one.id) },
    { label: t("Show in folder"), icon: "folder-open", disabled: !one, onSelect: () => one && actions.reveal(one.id) },
    { separator: true },
    { label: t("Resume"), icon: "resume", disabled: !list.some((i) => canResume(i.status) || i.status === "queued"), onSelect: () => actions.resume(ids) },
    { label: t("Pause"), icon: "pause", kbd: "Space", disabled: !list.some((i) => canPause(i.status)), onSelect: () => actions.pause(ids) },
    { label: t("Redownload"), icon: "retry", disabled: !one, onSelect: () => one && actions.redownload(one.id) },
    { label: t("Refresh download address…"), icon: "refresh-url", disabled: !one || done, onSelect: () => one && ui.openDialog({ kind: "refreshUrl", id: one.id }) },
    { label: t("Speed limit…"), icon: "speed-limiter", onSelect: () => ui.openDialog({ kind: "speedLimit", ids }) },
    { separator: true },
    { label: t("Move to queue"), icon: "queue", submenu: queueEntries },
    { label: t("Move up in queue"), icon: "chevron-up", disabled: !inQueue, onSelect: () => actions.moveInQueue(ids, -1) },
    { label: t("Move down in queue"), icon: "chevron-down", disabled: !inQueue, onSelect: () => actions.moveInQueue(ids, 1) },
    { separator: true },
    { label: ids.length > 1 ? t("Copy links") : t("Copy link"), icon: "copy", kbd: "Ctrl C", onSelect: () => void actions.copyLinks(ids) },
    { label: t("Details"), icon: "activity", disabled: !one, onSelect: () => one && actions.details(one.id) },
    { label: t("Properties…"), icon: "properties", kbd: "F2", disabled: !one, onSelect: () => one && ui.openDialog({ kind: "properties", id: one.id }) },
    { separator: true },
    { label: t("Delete"), icon: "delete", kbd: "Del", danger: true, onSelect: () => actions.requestDelete(ids) },
    { label: t("Delete with files…"), icon: "delete-completed", danger: true, onSelect: () => actions.requestDelete(ids, true) },
  ];
}
