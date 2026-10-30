import { Modal } from "../components/Modal";
import { Icon } from "../design/icons";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { GrabberSheet } from "./sheets/GrabberSheet";
import { SchedulerSheet } from "./sheets/SchedulerSheet";
import { SettingsSheet } from "./sheets/SettingsSheet";
import { WhatsNewSheet } from "./sheets/WhatsNewSheet";

/** Large in-window surfaces: Settings, Scheduler, Site grabber, What's new. */
export function Sheets() {
  const sheet = useUi((s) => s.sheet);
  const close = useUi((s) => s.closeSheet);
  const key = sheet ? `${sheet.kind}:${sheet.kind === "settings" ? sheet.section : sheet.kind === "scheduler" ? sheet.queueId : sheet.kind === "grabber" ? sheet.projectId : ""}` : "none";
  return (
    <>
      <Modal open={sheet?.kind === "settings"} onClose={close} variant="sheet" width={1040} height={720} title={t("Settings")} icon={<Icon name="settings" size={18} className="text-accent" />} className="sheet--settings">
        {sheet?.kind === "settings" && <SettingsSheet key={key} section={sheet.section} />}
      </Modal>
      <Modal open={sheet?.kind === "scheduler"} onClose={close} variant="sheet" width={880} height={700} title={t("Scheduler")} icon={<Icon name="scheduler" size={18} className="text-accent" />}>
        {sheet?.kind === "scheduler" && <SchedulerSheet key={key} initial={sheet.queueId} />}
      </Modal>
      <Modal open={sheet?.kind === "grabber"} onClose={close} variant="sheet" width={900} height={700} title={t("Site grabber")} icon={<Icon name="grabber" size={18} className="text-accent" />}>
        {sheet?.kind === "grabber" && <GrabberSheet key={key} projectId={sheet.projectId} />}
      </Modal>
      <Modal open={sheet?.kind === "whatsnew"} onClose={close} variant="sheet" width={760} height={720} title={t("What's new")} icon={<Icon name="star" size={18} className="text-accent" />}>
        {sheet?.kind === "whatsnew" && <WhatsNewSheet />}
      </Modal>
    </>
  );
}
