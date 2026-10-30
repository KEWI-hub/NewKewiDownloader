import { describe, expect, it } from "vitest";
import { versionNewer } from "./version";

describe("versionNewer (what's new after an update)", () => {
  it("compares versions part by part", () => {
    expect(versionNewer("1.1.0", "1.0.9")).toBe(true);
    expect(versionNewer("1.10.0", "1.9.2")).toBe(true);
    expect(versionNewer("2.0.0", "1.99.99")).toBe(true);
    expect(versionNewer("1.0.9", "1.1.0")).toBe(false);
    expect(versionNewer("1.1.0", "1.1.0")).toBe(false);
  });
  it("treats a missing part as 0 and ignores pre-release labels", () => {
    expect(versionNewer("1.1", "1.1.0")).toBe(false);
    expect(versionNewer("1.1.1", "1.1")).toBe(true);
    expect(versionNewer("1.1.0", "1.1.0-dev")).toBe(false);
    expect(versionNewer("1.1.0", "")).toBe(true);
  });
});
