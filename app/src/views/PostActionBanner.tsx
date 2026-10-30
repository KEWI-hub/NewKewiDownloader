import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "../design/icons";
import { api } from "../lib/api";
import { t, tk, tr } from "../lib/i18n";
import { useApp } from "../lib/store";
import { attempt } from "../lib/ui";

/** The countdown line per action; `{secs}` is the seconds left. */
const TEXT: Record<string, [IconName, string]> = {
  exit: ["close", tk("Prism will exit in {secs} s")],
  sleep: ["sleep", tk("The computer will sleep in {secs} s")],
  hibernate: ["sleep", tk("The computer will hibernate in {secs} s")],
  shutdown: ["power", tk("The computer will shut down in {secs} s")],
  lock: ["lock", tk("The screen will lock in {secs} s")],
  sound: ["sound", tk("Playing the queue sound in {secs} s")],
  command: ["external", tk("Running the finish command in {secs} s")],
};

/** Countdown before a queue's "when finished" action, with Cancel. */
export function PostActionBanner() {
  const pending = useApp((s) => s.postAction);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() > pending.deadline + 1500) useApp.setState({ postAction: null });
    }, 250);
    return () => window.clearInterval(timer);
  }, [pending]);
  const [icon, text] = (pending && TEXT[pending.action]) || ["info", tk("Queue finished in {secs} s")];
  const secs = pending ? Math.max(0, Math.ceil((pending.deadline - now) / 1000)) : 0;
  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="post-banner glass-strong"
          role="alertdialog"
          aria-live="assertive"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
        >
          <span className="post-banner__icon">
            <Icon name={icon} size={18} />
          </span>
          <div>
            <b>{tr(text, { secs: <span className="tnum">{secs}</span> })}</b>
            <div className="t-small text-tertiary">{t("All queued downloads have finished.")}</div>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            autoFocus
            onClick={() => {
              void attempt(api.cancelPostAction(), t("Could not cancel"));
              useApp.setState({ postAction: null });
            }}
          >
            {t("Cancel")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
