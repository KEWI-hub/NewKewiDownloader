import { describe, expect, it } from "vitest";

// Vitest stubs CSS imports, so read the stylesheets from disk (the app has no Node typings).
declare const process: { getBuiltinModule(id: "node:fs"): { readFileSync(path: URL, encoding: "utf8"): string } };
const read = (rel: string) => process.getBuiltinModule("node:fs").readFileSync(new URL(rel, import.meta.url), "utf8");
const tokens = read("./tokens.css");
const shell = read("../styles/shell.css");

const z = (name: string): number => {
  const m = new RegExp(`--z-${name}:\\s*(\\d+)`).exec(tokens);
  if (!m) throw new Error(`--z-${name} is not defined`);
  return Number(m[1]);
};

describe("z-index layers", () => {
  it("puts menus, selects and tooltips above the modals they open from", () => {
    // Menus and tooltips are portaled to <body> next to the modal scrim, so only z-index orders them.
    for (const layer of ["dropdown", "popover", "tooltip"]) {
      expect(z(layer)).toBeGreaterThan(z("modal"));
      expect(z(layer)).toBeGreaterThan(z("modal-backdrop"));
    }
  });

  it("keeps modals above the window chrome and toasts above modals", () => {
    expect(z("modal-backdrop")).toBeGreaterThan(z("sidebar"));
    expect(z("modal-backdrop")).toBeGreaterThan(z("chrome"));
    expect(z("toast")).toBeGreaterThan(z("tooltip"));
  });

  it("uses the layer tokens for the floating menu, tooltip and modal scrim", () => {
    expect(shell).toMatch(/\.menu--floating\s*\{[^}]*z-index:\s*var\(--z-dropdown\)/);
    expect(shell).toMatch(/\.tooltip--floating\s*\{[^}]*z-index:\s*var\(--z-tooltip\)/);
    expect(shell).toMatch(/\.modal-scrim\s*\{[^}]*z-index:\s*var\(--z-modal-backdrop\)/);
  });
});
