import { describe, expect, it } from "vitest";
import type { BrowserIntegration, IntegrationStatus } from "./api";
import { needsRepair } from "./integration";

const row = (browser: string, over: Partial<BrowserIntegration> = {}): BrowserIntegration => ({
  browser,
  installed: true,
  supported: true,
  registered: true,
  pointsToThisHost: true,
  ...over,
});
const status = (browsers: BrowserIntegration[], over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  browsers,
  extensionConnected: true,
  ...over,
});

describe("Repair in Settings › Browser integration", () => {
  it("shows while no extension is connected or it's outdated", () => {
    expect(needsRepair(null)).toBe(true);
    expect(needsRepair(status([row("chrome")], { extensionConnected: false }))).toBe(true);
    expect(needsRepair(status([row("chrome")], { extensionOutdated: true }))).toBe(true);
  });

  it("shows for a browser that needs repair while another one is connected", () => {
    expect(needsRepair(status([row("brave"), row("zen", { registered: false, pointsToThisHost: false })]))).toBe(true);
    expect(needsRepair(status([row("brave"), row("firefox", { pointsToThisHost: false })]))).toBe(true);
  });

  it("stays hidden when every installed browser is ready", () => {
    expect(needsRepair(status([row("chrome"), row("helium", { installed: false, registered: false, pointsToThisHost: false })]))).toBe(false);
    // A Flatpak browser can't be repaired from here.
    expect(needsRepair(status([row("chrome"), row("firefox", { supported: false, registered: false, pointsToThisHost: false })]))).toBe(false);
  });
});
