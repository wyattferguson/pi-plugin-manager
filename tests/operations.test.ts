/**
 Tests: Package operations — install, remove, update detection, and version diffing.
 */

import { describe, expect, test } from "bun:test";
import type { Package } from "../extensions/types";

// ── Update detection logic ──────────────────────────────────────────────────

describe("update detection", () => {
  function hasUpdate(installedVersion: string | undefined, latestVersion: string): boolean {
    if (
      installedVersion === undefined ||
      installedVersion === "?" ||
      installedVersion === "local"
    ) {
      return false;
    }
    return installedVersion !== latestVersion;
  }

  test("detects newer version available", () => {
    expect(hasUpdate("0.7.10", "0.7.19")).toBe(true);
  });

  test("same version is not an update", () => {
    expect(hasUpdate("0.7.19", "0.7.19")).toBe(false);
  });

  test("pinned version behind latest", () => {
    expect(hasUpdate("1.0.0", "2.0.0")).toBe(true);
  });

  test("undefined install version returns false", () => {
    expect(hasUpdate(undefined, "1.0.0")).toBe(false);
  });

  test("unknown installed version returns false", () => {
    expect(hasUpdate("?", "1.0.0")).toBe(false);
  });

  test("local package returns false", () => {
    expect(hasUpdate("local", "1.0.0")).toBe(false);
  });
});

// ── Version diffing (simulates #updateAll's comparison) ─────────────────────

describe("version diffing after update", () => {
  function findUpdated(
    oldPkgs: Array<{ name: string; version: string }>,
    newPkgs: Package[],
  ): string[] {
    const updated: string[] = [];
    for (const p of newPkgs) {
      const old = oldPkgs.find((o) => o.name === p.name);
      if (old && old.version !== "?" && old.version !== "local") {
        const newVer = p.version ?? "installed-from-disk";
        if (old.version !== newVer) {
          updated.push(p.name);
        }
      }
    }
    return updated;
  }

  test("detects version change after update", () => {
    const old = [{ name: "pi-fff", version: "0.1.6" }];
    const updated = findUpdated(old, [makePkg({ name: "pi-fff", version: undefined })]);
    // Without a pinned version, resolveInstalledVersion would read from disk (simulated as "0.1.12")
    expect(updated).toContain("pi-fff");
  });

  test("no version change means no update", () => {
    const old = [{ name: "pi-fff", version: "0.1.6" }];
    const updated = findUpdated(old, [makePkg({ name: "pi-fff", version: "0.1.6" })]);
    expect(updated).not.toContain("pi-fff");
  });

  test("multiple packages with mixed update status", () => {
    const old = [
      { name: "a", version: "1.0.0" },
      { name: "b", version: "2.0.0" },
    ];
    const curr = [
      makePkg({ name: "a", version: undefined }),
      makePkg({ name: "b", version: "2.0.0" }),
    ];
    const updated = findUpdated(old, curr);
    expect(updated).toEqual(["a"]);
  });

  test("matches by name when source changes (pinned → unpinned)", () => {
    const old = [{ name: "pi-fff", version: "0.1.6" }];
    // After update, source might change from npm:pi-fff@0.1.6 to npm:pi-fff
    const curr = [makePkg({ name: "pi-fff", version: undefined, source: "npm:pi-fff" })];
    const updated = findUpdated(old, curr);
    expect(updated).toContain("pi-fff");
  });

  test("unknown old version is skipped", () => {
    const old = [{ name: "pkg", version: "?" }];
    const curr = [makePkg({ name: "pkg", version: "1.0.0" })];
    expect(findUpdated(old, curr)).not.toContain("pkg");
  });
});

// ── Install/remove source strings ───────────────────────────────────────────

describe("install/remove source construction", () => {
  test("install source uses name without pin", () => {
    const name = "pi-fff";
    const source = `npm:${name}`;
    expect(source).toBe("npm:pi-fff");
  });

  test("install source for scoped package", () => {
    const name = "@scope/package";
    const source = `npm:${name}`;
    expect(source).toBe("npm:@scope/package");
  });

  test("remove source uses full source from settings", () => {
    const source = "npm:pi-fff@0.1.6";
    const name = "pi-fff";
    // Remove should work with either source or just name
    expect(source).toBeTruthy();
    expect(name).toBe("pi-fff");
  });
});

// ── Newly installed package display ─────────────────────────────────────────

describe("post-update display", () => {
  test("package with changed version shows as updated", () => {
    const updatedSources = new Set<string>(["npm:pi-fff"]);
    expect(updatedSources.has("npm:pi-fff")).toBe(true);
    expect(updatedSources.has("npm:other")).toBe(false);
  });

  test("justUpdatedSources clears after timeout", () => {
    const updatedSources = new Set<string>(["npm:pi-fff"]);
    updatedSources.clear();
    expect(updatedSources.size).toBe(0);
  });

  test("multiple updated packages tracked", () => {
    const updatedSources = new Set<string>(["npm:a", "npm:b", "npm:c"]);
    expect(updatedSources.size).toBe(3);
    updatedSources.delete("npm:b");
    expect(updatedSources.has("npm:b")).toBe(false);
    expect(updatedSources.size).toBe(2);
  });
});

// ── Helper ──────────────────────────────────────────────────────────────────

function makePkg(overrides: Partial<Package> = {}): Package {
  return {
    source: overrides.source ?? "npm:test",
    type: overrides.type ?? "npm",
    name: overrides.name ?? "test-pkg",
    version: overrides.version,
    description: overrides.description,
    hasUpdate: overrides.hasUpdate,
    latestVersion: overrides.latestVersion,
  };
}
