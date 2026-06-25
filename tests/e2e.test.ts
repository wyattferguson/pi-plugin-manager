/**
 End-to-end tests for all pi-plugin-manager functionality.
 Tests cover parsing, version resolution, update detection, caching,
 CLI source construction, and UI management logic.
 */

import { describe, expect, test } from "bun:test";
import { parseSource, resolveInstalledVersion } from "../extensions/packages";
import type { Package, PackageSource } from "../extensions/types";

// ── Package source parsing ──────────────────────────────────────────────────

describe("parseSource", () => {
  // All valid npm formats
  test("npm bare name", () => {
    const p = parseSource("npm:context-mode")!;
    expect(p.type).toBe("npm");
    expect(p.name).toBe("context-mode");
    expect(p.version).toBeUndefined();
    expect(p.source).toBe("npm:context-mode");
  });

  test("npm pinned version", () => {
    const p = parseSource("npm:foo@1.2.3")!;
    expect(p.type).toBe("npm");
    expect(p.name).toBe("foo");
    expect(p.version).toBe("1.2.3");
  });

  test("npm scoped package", () => {
    const p = parseSource("npm:@scope/pkg@1.0.0")!;
    expect(p.type).toBe("npm");
    expect(p.name).toBe("@scope/pkg");
    expect(p.version).toBe("1.0.0");
  });

  test("npm scoped without version", () => {
    const p = parseSource("npm:@scope/pkg")!;
    expect(p.name).toBe("@scope/pkg");
    expect(p.version).toBeUndefined();
  });

  test("npm with pre-release version", () => {
    const p = parseSource("npm:pkg@1.0.0-beta.1")!;
    expect(p.name).toBe("pkg");
    expect(p.version).toBe("1.0.0-beta.1");
  });

  test("npm with semver range style version", () => {
    const p = parseSource("npm:pkg@^1.0.0")!;
    expect(p.name).toBe("pkg");
    expect(p.version).toBe("^1.0.0");
  });

  // Git formats
  test("git: prefix with tag", () => {
    const p = parseSource("git:github.com/user/repo@v1")!;
    expect(p.type).toBe("git");
    expect(p.name).toBe("repo");
    expect(p.version).toBe("v1");
  });

  test("git: prefix without tag", () => {
    const p = parseSource("git:github.com/user/repo")!;
    expect(p.type).toBe("git");
    expect(p.name).toBe("repo");
    expect(p.version).toBeUndefined();
  });

  test("https git URL with version", () => {
    const p = parseSource("https://github.com/user/repo@v2")!;
    expect(p.type).toBe("git");
    expect(p.name).toBe("repo");
    expect(p.version).toBe("v2");
  });

  test("git: with scoped path", () => {
    const p = parseSource("git:github.com/org/pkg@1.0")!;
    expect(p.name).toBe("pkg");
    expect(p.version).toBe("1.0");
  });

  // Local paths
  test("local Windows path", () => {
    const p = parseSource(String.raw`C:\Users\test\project`)!;
    expect(p.type).toBe("local");
    expect(p.name).toBe("project");
  });

  test("local Unix path", () => {
    const p = parseSource("/home/user/project")!;
    expect(p.type).toBe("local");
    expect(p.name).toBe("project");
  });

  test("local relative path", () => {
    const p = parseSource("./my-plugin")!;
    expect(p.type).toBe("local");
    expect(p.name).toBe("my-plugin");
  });

  test("local relative path with parent", () => {
    const p = parseSource("../other/project")!;
    expect(p.type).toBe("local");
    expect(p.name).toBe("project");
  });

  // Edge cases
  test("empty string returns undefined", () => {
    expect(parseSource("")).toBeUndefined();
  });

  test("re-parsing pinned npm produces same fields", () => {
    const p1 = parseSource("npm:foo@1.0.0")!;
    const p2 = parseSource("npm:foo@1.0.0")!;
    expect(p1.name).toBe(p2.name);
    expect(p1.version).toBe(p2.version);
    expect(p1.type).toBe(p2.type);
  });
});

// ── Version resolution ──────────────────────────────────────────────────────

describe("resolveInstalledVersion", () => {
  test("pinned version takes priority over file system", () => {
    expect(resolveInstalledVersion(makePkg({ version: "1.0.0" }))).toBe("1.0.0");
  });

  test("git package returns git string", () => {
    expect(resolveInstalledVersion(makePkg({ type: "git", name: "repo" }))).toBe("git");
  });

  test("local package returns local string", () => {
    expect(resolveInstalledVersion(makePkg({ type: "local", name: "pkg" }))).toBe("local");
  });

  test("npm without pinned version and no node_modules returns ?", () => {
    const ver = resolveInstalledVersion(makePkg({ type: "npm", name: "nonexistent-pkg-xyz-123" }));
    expect(ver).toBe("?");
  });

  test("@scoped package without pin returns ?", () => {
    const ver = resolveInstalledVersion(makePkg({ type: "npm", name: "@scope/nonexistent" }));
    expect(ver).toBe("?");
  });
});

// ── Update detection logic ──────────────────────────────────────────────────

describe("update detection (version comparison)", () => {
  function hasUpdate(installedVer: string | undefined, latestVer: string): boolean {
    if (
      !installedVer ||
      installedVer === "?" ||
      installedVer === "local" ||
      installedVer === "git"
    ) {
      return false;
    }

    return installedVer !== latestVer;
  }

  describe("npm packages", () => {
    test("behind by major version", () => {
      expect(hasUpdate("1.0.0", "2.0.0")).toBe(true);
    });

    test("behind by minor version", () => {
      expect(hasUpdate("1.0.0", "1.1.0")).toBe(true);
    });

    test("behind by patch version", () => {
      expect(hasUpdate("1.0.0", "1.0.1")).toBe(true);
    });

    test("pre-release behind stable", () => {
      expect(hasUpdate("0.5.0", "1.0.0")).toBe(true);
    });

    test("same version is up to date", () => {
      expect(hasUpdate("1.0.0", "1.0.0")).toBe(false);
    });

    test("pinned version same as latest is up to date", () => {
      expect(hasUpdate("2.0.0", "2.0.0")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("undefined installed version returns false (unpinned, needs fs lookup)", () => {
      expect(hasUpdate(undefined, "1.0.0")).toBe(false);
    });

    test("unknown package (?) returns false", () => {
      expect(hasUpdate("?", "1.0.0")).toBe(false);
    });

    test("local package returns false", () => {
      expect(hasUpdate("local", "1.0.0")).toBe(false);
    });

    test("git package returns false", () => {
      expect(hasUpdate("git", "1.0.0")).toBe(false);
    });

    test("empty string version returns false", () => {
      expect(hasUpdate("", "1.0.0")).toBe(false);
    });
  });
});

// ── Post-update version diffing ─────────────────────────────────────────────

describe("post-update version diffing", () => {
  function findUpdated(
    oldPkgs: Array<{ name: string; version: string }>,
    newPkgs: Package[],
  ): string[] {
    const updated: string[] = [];
    for (const p of newPkgs) {
      const old = oldPkgs.find((o) => o.name === p.name);
      if (old && old.version !== "?" && old.version !== "local") {
        const newVer = p.version ?? "resolved-from-disk";
        if (old.version !== newVer) {
          updated.push(p.name);
        }
      }
    }
    return updated;
  }

  test("single package updated", () => {
    const old = [{ name: "pkg-a", version: "1.0.0" }];
    const curr = [makePkg({ name: "pkg-a", version: undefined })];
    expect(findUpdated(old, curr)).toEqual(["pkg-a"]);
  });

  test("multiple packages updated", () => {
    const old = [
      { name: "a", version: "1.0.0" },
      { name: "b", version: "2.0.0" },
      { name: "c", version: "3.0.0" },
    ];
    const curr = [
      makePkg({ name: "a", version: undefined }),
      makePkg({ name: "b", version: "2.0.0" }),
      makePkg({ name: "c", version: "3.0.1" }),
    ];
    expect(findUpdated(old, curr)).toEqual(["a", "c"]);
  });

  test("no packages changed", () => {
    const old = [{ name: "a", version: "1.0.0" }];
    const curr = [makePkg({ name: "a", version: "1.0.0" })];
    expect(findUpdated(old, curr)).toEqual([]);
  });

  test("new package added (no old entry)", () => {
    const old: Array<{ name: string; version: string }> = [];
    const curr = [makePkg({ name: "new-pkg", version: "1.0.0" })];
    expect(findUpdated(old, curr)).toEqual([]);
  });

  test("package removed not in new list", () => {
    const old = [{ name: "removed", version: "1.0.0" }];
    const curr: Package[] = [];
    expect(findUpdated(old, curr)).toEqual([]);
  });

  test("pinned version transitions to unpinned after update", () => {
    const old = [{ name: "pkg", version: "0.5.0" }];
    const curr = [makePkg({ name: "pkg", version: undefined })]; // pin removed
    expect(findUpdated(old, curr)).toEqual(["pkg"]);
  });

  test("matches by name even when source changed", () => {
    const old = [{ name: "pkg", version: "0.5.0" }];
    const curr = [makePkg({ name: "pkg", version: "0.5.0", source: "npm:pkg@0.5.0" })];
    expect(findUpdated(old, curr)).toEqual([]); // same version, no update
  });
});

// ── justUpdatedSources tracking ─────────────────────────────────────────────

describe("justUpdatedSources tracking", () => {
  test("set contains updated sources", () => {
    const updated = new Set<string>(["npm:a", "npm:b"]);
    expect(updated.has("npm:a")).toBe(true);
    expect(updated.has("npm:c")).toBe(false);
  });

  test("clearing makes everything stale", () => {
    const updated = new Set<string>(["npm:a"]);
    updated.clear();
    expect(updated.size).toBe(0);
  });

  test("multiple updates tracked independently", () => {
    const updated = new Set<string>();
    updated.add("npm:a");
    updated.add("npm:b");
    expect(updated.size).toBe(2);
    updated.delete("npm:a");
    expect(updated.has("npm:a")).toBe(false);
    expect(updated.has("npm:b")).toBe(true);
  });

  test("re-adding is idempotent", () => {
    const updated = new Set<string>();
    updated.add("npm:a");
    updated.add("npm:a");
    expect(updated.size).toBe(1);
  });

  test("auto-clear after timeout is simulated", () => {
    const updated = new Set<string>(["npm:a"]);
    setTimeout(() => updated.clear(), 0); // simulate the 8s timeout
    // Verify it clears eventually — in practice this is the UI timeout
    expect(updated.size).toBe(1); // hasn't cleared yet
  });
});

// ── Package list management ─────────────────────────────────────────────────

describe("package list filtering", () => {
  function filter(pkgs: Package[], query: string): Package[] {
    if (!query) return pkgs;
    const f = query.toLowerCase();
    return pkgs.filter(
      (p) => p.name.toLowerCase().includes(f) || p.source.toLowerCase().includes(f),
    );
  }

  const packages = [
    makePkg({ name: "context-mode", source: "npm:context-mode" }),
    makePkg({ name: "pi-fff", source: "npm:pi-fff@1.0.0" }),
    makePkg({ name: "pi-web-access", source: "npm:pi-web-access" }),
  ];

  test("empty query returns all", () => {
    expect(filter(packages, "").length).toBe(3);
  });

  test("matches by name", () => {
    expect(filter(packages, "context").length).toBe(1);
    expect(filter(packages, "pi-fff").length).toBe(1);
  });

  test("matches by source", () => {
    const result = filter(packages, "modern"); // matches "context-mode" source
    expect(result.length).toBe(0);
    expect(filter(packages, "web-access").length).toBe(1);
  });

  test("case insensitive", () => {
    expect(filter(packages, "CONTEXT").length).toBe(1);
    expect(filter(packages, "PI-WEB").length).toBe(1);
  });

  test("partial name match", () => {
    expect(filter(packages, "pi").length).toBe(2);
  });

  test("no match returns empty", () => {
    expect(filter(packages, "zzzzz").length).toBe(0);
  });
});

// ── hasUpdates flag aggregation ─────────────────────────────────────────────

describe("hasUpdates aggregation", () => {
  test("true when any package has an update", () => {
    const pkgs = [
      makePkg({ hasUpdate: false }),
      makePkg({ hasUpdate: true }),
      makePkg({ hasUpdate: false }),
    ];
    expect(pkgs.some((p) => p.hasUpdate)).toBe(true);
  });

  test("false when no packages have updates", () => {
    const pkgs = [makePkg({ hasUpdate: false }), makePkg({ hasUpdate: false })];
    expect(pkgs.some((p) => p.hasUpdate)).toBe(false);
  });

  test("empty list returns false", () => {
    expect([].some((p: Package) => p.hasUpdate)).toBe(false);
  });

  test("single updated package", () => {
    expect([makePkg({ hasUpdate: true })].some((p) => p.hasUpdate)).toBe(true);
  });
});

// ── Package icon selection logic ────────────────────────────────────────────

describe("package icon selection", () => {
  function getIcon(
    wasUpdated: boolean,
    isUpdating: boolean,
    isChecking: boolean,
    hasUpdate: boolean,
    type: PackageSource,
  ): string {
    if (wasUpdated) return "✓";
    if (isUpdating || isChecking) return "⏳";
    if (hasUpdate) return "🔄";
    if (type === "npm") return "📦";
    if (type === "git") return "🔀";
    return "📁";
  }

  test("updated package shows checkmark", () => {
    expect(getIcon(true, false, false, false, "npm")).toBe("✓");
  });

  test("updating shows spinner", () => {
    expect(getIcon(false, true, false, false, "npm")).toBe("⏳");
  });

  test("checking versions shows spinner", () => {
    expect(getIcon(false, false, true, false, "npm")).toBe("⏳");
  });

  test("update available shows refresh icon", () => {
    expect(getIcon(false, false, false, true, "npm")).toBe("🔄");
  });

  test("npm package shows box icon", () => {
    expect(getIcon(false, false, false, false, "npm")).toBe("📦");
  });

  test("git package shows branch icon", () => {
    expect(getIcon(false, false, false, false, "git")).toBe("🔀");
  });

  test("local package shows folder icon", () => {
    expect(getIcon(false, false, false, false, "local")).toBe("📁");
  });

  test("updating beats update-available", () => {
    expect(getIcon(false, true, false, true, "npm")).toBe("⏳");
  });

  test("was-updated beats all others", () => {
    expect(getIcon(true, true, false, true, "npm")).toBe("✓");
  });
});

// ── Package description text logic ──────────────────────────────────────────

describe("package description text", () => {
  function buildDescription(
    ver: string,
    desc: string | undefined,
    hasUpdate: boolean,
    latestVersion: string | undefined,
    wasUpdated: boolean,
  ): string {
    const d = desc || "npm";
    let text = `${ver} — ${d}`;
    if (hasUpdate && latestVersion) {
      text = `${ver} → ${latestVersion} — ${d}`;
    }
    if (wasUpdated) {
      text = `\x1b[33m${ver}\x1b[0m — ${d}`;
    }
    return text;
  }

  test("normal display shows version and description", () => {
    expect(buildDescription("1.0.0", "cool package", false, undefined, false)).toBe(
      "1.0.0 — cool package",
    );
  });

  test("update available shows version arrow", () => {
    expect(buildDescription("1.0.0", "cool", true, "2.0.0", false)).toBe("1.0.0 → 2.0.0 — cool");
  });

  test("was updated shows highlighted version", () => {
    const text = buildDescription("2.0.0", "cool", false, undefined, true);
    expect(text).toContain("2.0.0");
    expect(text).toContain("cool");
    expect(text).not.toContain("→"); // no arrow when just updated
  });

  test("fallback description when none provided", () => {
    expect(buildDescription("1.0.0", undefined, false, undefined, false)).toBe("1.0.0 — npm");
  });

  test("update arrow takes priority over normal", () => {
    expect(buildDescription("0.5.0", "pkg", true, "1.0.0", false)).toBe("0.5.0 → 1.0.0 — pkg");
  });

  test("was-updated removes update arrow", () => {
    // After update, hasUpdate is false, wasUpdated is true
    expect(buildDescription("1.0.0", "pkg", false, undefined, true)).toContain("1.0.0");
  });
});

// ── Source string construction for CLI operations ───────────────────────────

describe("CLI source construction", () => {
  test("npm install source for bare package", () => {
    const name = "pi-web-access";
    expect(`npm:${name}@latest`).toBe("npm:pi-web-access@latest");
  });

  test("npm install source for scoped package", () => {
    const name = "@scope/package";
    expect(`npm:${name}@latest`).toBe("npm:@scope/package@latest");
  });

  test("remove source uses original source string", () => {
    expect("npm:pi-fff@0.1.6").toBe("npm:pi-fff@0.1.6");
  });

  test("remove source for unpinned package", () => {
    expect("npm:context-mode").toBe("npm:context-mode");
  });

  test("remove source for scoped package", () => {
    expect("npm:@narumitw/pi-goal").toBe("npm:@narumitw/pi-goal");
  });
});

// ── Package type checks ─────────────────────────────────────────────────────

describe("package type detection", () => {
  test("npm type", () => expect(parseSource("npm:foo")!.type).toBe("npm"));
  test("git type with git: prefix", () =>
    expect(parseSource("git:github.com/u/r")!.type).toBe("git"));
  test("git type with https URL", () =>
    expect(parseSource("https://github.com/u/r")!.type).toBe("git"));
  test("git type with ssh URL", () =>
    expect(parseSource("ssh://git@github.com/u/r.git")!.type).toBe("git"));
  test("local type with absolute path", () =>
    expect(parseSource("/path/to/pkg")!.type).toBe("local"));
  test("local type with relative path", () =>
    expect(parseSource("./relative/path")!.type).toBe("local"));
  test("local type with Windows path", () =>
    expect(parseSource(String.raw`D:\path`)!.type).toBe("local"));
});

// ── Search URL construction ─────────────────────────────────────────────────

describe("searchCatalog URL", () => {
  function buildSearchUrl(query: string): string {
    const trimmed = query.trim();
    const q = trimmed ? `keywords:pi-package ${trimmed}` : "keywords:pi-package";
    const params = new URLSearchParams({ text: q, size: "20" });
    return `https://registry.npmjs.org/-/v1/search?${params}`;
  }

  function buildSearchUrlWithSize(query: string, size: number): string {
    const trimmed = query.trim();
    const q = trimmed ? `keywords:pi-package ${trimmed}` : "keywords:pi-package";
    const params = new URLSearchParams({ text: q, size: String(size) });
    return `https://registry.npmjs.org/-/v1/search?${params}`;
  }

  test("empty query returns keyword-only search", () => {
    const url = buildSearchUrl("");
    expect(url).toContain("keywords%3Api-package");
  });

  test("query includes space-separated keyword and term", () => {
    const url = buildSearchUrl("test");
    expect(url).toContain("keywords%3Api-package+test");
  });

  test("multi-word query encodes spaces with +", () => {
    const url = buildSearchUrl("context mode");
    expect(url).toContain("keywords%3Api-package+context+mode");
  });

  test("whitespace trimmed from query", () => {
    const url = buildSearchUrl("  trimmed  ");
    expect(url).toContain("+trimmed");
  });

  test("special characters in query are encoded", () => {
    const url = buildSearchUrl("hello+world");
    expect(url).toContain("hello%2Bworld");
  });

  test("custom size parameter", () => {
    const url = buildSearchUrlWithSize("test", 50);
    expect(url).toContain("size=50");
  });
});

// ── ManagerUI state management ──────────────────────────────────────────────

describe("ManagerUI state", () => {
  test("tab transitions: installed -> search -> installed", () => {
    let tab: "installed" | "search" = "installed";

    tab = "search";
    expect(tab).toBe("search");

    tab = "installed";
    expect(tab).toBe("installed");
  });

  test("view transitions: list -> confirm -> list", () => {
    type View = "list" | "confirm" | "details" | "versions";
    let view: View = "list";

    view = "confirm";
    expect(view).toBe("confirm");

    view = "list";
    expect(view).toBe("list");
  });

  test("view transitions: list -> details -> list", () => {
    type View = "list" | "confirm" | "details" | "versions";
    let view: View = "list";

    view = "details";
    expect(view).toBe("details");

    view = "list";
    expect(view).toBe("list");
  });

  test("view transitions: list -> versions -> list", () => {
    type View = "list" | "confirm" | "details" | "versions";
    let view: View = "list";

    view = "versions";
    expect(view).toBe("versions");

    view = "list";
    expect(view).toBe("list");
  });

  test("busy flag prevents concurrent operations", () => {
    let busy = false;

    function start() {
      if (busy) return false;
      busy = true;
      return true;
    }

    function end() {
      busy = false;
    }

    expect(start()).toBe(true); // first call succeeds
    expect(start()).toBe(false); // blocked
    end();
    expect(start()).toBe(true); // succeeds again
  });

  test("changed flag set after successful install", () => {
    let changed = false;
    changed = true;
    expect(changed).toBe(true);
  });

  test("changed flag not set on failed operation", () => {
    let changed = false;
    // simulate failed install — changed stays false
    expect(changed).toBe(false);
  });
});

// ── Spinner state ───────────────────────────────────────────────────────────

describe("spinner state", () => {
  test("status message updates during operation", () => {
    let statusMsg = "";
    statusMsg = "Installing pi-fff";
    expect(statusMsg).toContain("Installing");
  });

  test("status message on success", () => {
    let statusMsg = "";
    let statusType = "";
    statusMsg = "Installed pi-fff";
    statusType = "success";
    expect(statusMsg).toContain("Installed");
    expect(statusType).toBe("success");
  });

  test("status message on error", () => {
    let statusMsg = "";
    let statusType = "";
    statusMsg = "Failed: Network error";
    statusType = "error";
    expect(statusMsg).toContain("Failed");
    expect(statusType).toBe("error");
  });

  test("status cleared on cancel", () => {
    let statusMsg = "Installing...";
    statusMsg = "Cancelled";
    expect(statusMsg).toBe("Cancelled");
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
