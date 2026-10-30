import type { IntegrationStatus } from "./api";

/**
 * Settings › Browser integration offers Repair when no extension has connected, the browser
 * runs an older one, or any installed browser's helper registration is missing or belongs to
 * another Prism copy (its row says "Needs repair") — also while another browser is connected.
 */
export function needsRepair(status: IntegrationStatus | null): boolean {
  if (!status?.extensionConnected || status.extensionOutdated) return true;
  return status.browsers.some((b) => b.installed && b.supported !== false && !(b.registered && b.pointsToThisHost));
}
