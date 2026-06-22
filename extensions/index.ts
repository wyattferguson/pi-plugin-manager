import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type SelectItem,
  SelectList,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

interface Pkg {
  source: string;
  type: "npm" | "git" | "local";
  name: string;
  version?: string;
  hasUpdate?: boolean;
  latestVersion?: string;
}

interface SearchResult {
  name: string;
  description: string;
  version: string;
  npmPackage: string;
}

interface Theme {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

// ── Settings ────────────────────────────────────────────────────────────────

const AGENT_DIR = join(homedir(), ".pi", "agent");
const GLOBAL_SETTINGS = join(AGENT_DIR, "settings.json");

function getSettingsPath(): string {
  const proj = join(process.cwd(), ".pi", "settings.json");
  if (existsSync(proj)) return proj;
  return GLOBAL_SETTINGS;
}

function loadPackages(): Pkg[] {
  const sp = getSettingsPath();
  if (!existsSync(sp)) return [];
  let raw: unknown[];
  try {
    raw = JSON.parse(readFileSync(sp, "utf8")).packages ?? [];
  } catch {
    return [];
  }
  const result: Pkg[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") result.push(parseSource(entry));
    else if (typeof entry === "object" && entry !== null && "source" in entry) {
      result.push(parseSource((entry as { source: string }).source));
    }
  }
  return result.filter((p): p is Pkg => p !== null);
}

function parseSource(raw: string): Pkg | null {
  if (!raw) return null;
  if (raw.startsWith("npm:")) {
    const rest = raw.slice(4);
    const atIdx = rest.lastIndexOf("@");
    const name = atIdx > 0 ? rest.slice(0, atIdx) : rest;
    const version = atIdx > 0 ? rest.slice(atIdx + 1) : undefined;
    return { source: raw, type: "npm", name, version };
  }
  if (raw.startsWith("git:") || /^(https?|ssh|git):\/\//.test(raw)) {
    let url = raw.startsWith("git:") ? raw.slice(4) : raw;
    const atIdx = url.lastIndexOf("@");
    const ver = atIdx > 0 ? url.slice(atIdx + 1) : undefined;
    if (ver) url = url.slice(0, atIdx);
    const name =
      url
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") ?? url;
    return { source: raw, type: "git", name, version: ver };
  }
  const name = raw.split(/[/\\]/).pop() ?? raw;
  return { source: raw, type: "local", name };
}

// ── Version checks ──────────────────────────────────────────────────────────

async function checkNpmUpdates(pkgs: Pkg[]): Promise<void> {
  const results = await Promise.allSettled(
    pkgs
      .filter((p) => p.type === "npm")
      .map(async (p) => {
        const resp = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(p.name)}/latest`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!resp.ok) return;
        const data = (await resp.json()) as { version: string };
        p.latestVersion = data.version;
        p.hasUpdate = p.version !== undefined && p.version !== data.version;
      }),
  );
  void results;
}

async function checkGitUpdates(pkgs: Pkg[]): Promise<void> {
  for (const p of pkgs.filter((p) => p.type === "git")) {
    try {
      const url = extractGitUrl(p.source);
      const output = execSync(`git ls-remote --tags "${url}"`, {
        encoding: "utf8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const tags = output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => (line.split("\t")[1] ?? "").replace("refs/tags/", ""))
        .filter((t) => /^v?\d/.test(t))
        .sort();
      const latest = tags[tags.length - 1];
      if (latest && p.version && latest !== p.version) {
        p.latestVersion = latest;
        p.hasUpdate = true;
      }
    } catch {
      // git not available or network issue
    }
  }
}

function extractGitUrl(source: string): string {
  let url = source;
  if (url.startsWith("git:")) url = url.slice(4);
  const atIdx = url.lastIndexOf("@");
  if (atIdx > 0 && (url.startsWith("http") || url.includes(":"))) {
    const after = url.slice(atIdx + 1);
    if (/^v?\d/.test(after) || after.length === 40) {
      url = url.slice(0, atIdx);
    }
  }
  return url;
}

// ── Package catalog search ──────────────────────────────────────────────────

async function searchCatalog(
  query: string,
  size = 20,
): Promise<SearchResult[]> {
  const q = query.trim()
    ? `keywords:pi-package+${encodeURIComponent(query)}`
    : "keywords:pi-package";
  const url = `https://registry.npmjs.org/-/v1/search?text=${q}&size=${size}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      objects: Array<{
        package: { name: string; version: string; description?: string };
      }>;
    };
    return data.objects.map((o) => ({
      name: o.package.name,
      description: o.package.description ?? "",
      version: o.package.version,
      npmPackage: o.package.name,
    }));
  } catch {
    return [];
  }
}

// ── Package operations ──────────────────────────────────────────────────────

function installPackage(source: string): string {
  return execSync(`pi install ${source}`, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function removePackage(source: string): string {
  return execSync(`pi remove ${source}`, {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function updateAllExtensions(): string {
  return execSync("pi update --extensions", {
    encoding: "utf8",
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ── TUI Component ───────────────────────────────────────────────────────────

type Tab = "installed" | "search";

class ManagerUI {
  private tab: Tab = "installed";
  private installedPkgs: Pkg[] = [];
  private searchResults: SearchResult[] = [];
  private searchQuery = "";
  private searchLoading = false;
  private statusMsg = "";
  private statusType: "info" | "error" | "success" = "info";

  private installedList: SelectList | null = null;
  private searchList: SelectList | null = null;

  private cachedWidth?: number;
  private cachedLines?: string[];
  private theme!: Theme;

  public onDone?: () => void;

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  private fg(color: string, text: string): string {
    return this.theme.fg(color, text);
  }
  private bg(color: string, text: string): string {
    return this.theme.bg(color, text);
  }
  private bold(text: string): string {
    return this.theme.bold(text);
  }

  private themeSelectListFunctions() {
    return {
      selectedPrefix: (t: string) => this.fg("accent", t),
      selectedText: (t: string) => this.fg("accent", t),
      description: (t: string) => this.fg("muted", t),
      scrollInfo: (t: string) => this.fg("dim", t),
      noMatch: (t: string) => this.fg("warning", t),
    };
  }

  constructor(pkgs: Pkg[]) {
    this.installedPkgs = pkgs;
    this.statusMsg = `${pkgs.length} packages installed`;
    this.statusType = "info";
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.onDone?.();
      return;
    }

    if (this.tab === "installed") {
      if (matchesKey(data, "tab") || data === "\t") {
        this.tab = "search";
        this.invalidate();
        return;
      }
      if (data === "u" || data === "U") {
        void this.updateAll();
        return;
      }
      if (matchesKey(data, "enter")) {
        void this.onRemove();
        return;
      }
      if (data === "d" || data === "D" || matchesKey(data, "delete")) {
        void this.onRemove();
        return;
      }
      this.installedList?.handleInput(data);
      this.invalidate();
    } else {
      if (matchesKey(data, "tab") || data === "\t") {
        this.tab = "installed";
        this.invalidate();
        return;
      }
      if (matchesKey(data, "enter")) {
        void this.onSearchEnter();
        return;
      }
      if (matchesKey(data, "backspace")) {
        if (this.searchQuery.length > 0) {
          this.searchQuery = this.searchQuery.slice(0, -1);
          this.debounceSearch();
          this.invalidate();
        }
        return;
      }
      if (
        data.length === 1 &&
        data.charCodeAt(0) >= 32 &&
        data.charCodeAt(0) < 127
      ) {
        this.searchQuery += data;
        this.debounceSearch();
        this.invalidate();
        return;
      }
      this.searchList?.handleInput(data);
      this.invalidate();
    }
  }

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private debounceSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      void this.doSearch();
    }, 300);
  }

  private async doSearch(): Promise<void> {
    this.searchLoading = true;
    this.invalidate();
    try {
      this.searchResults = await searchCatalog(this.searchQuery);
      this.searchList = this.buildSearchList();
      this.statusMsg = `${this.searchResults.length} results`;
      this.statusType = "info";
    } catch {
      this.statusMsg = "Search failed";
      this.statusType = "error";
    }
    this.searchLoading = false;
    this.invalidate();
  }

  private async onRemove(): Promise<void> {
    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.installedPkgs[idx];
    if (!pkg) return;

    this.statusMsg = `Removing ${pkg.name}...`;
    this.statusType = "info";
    this.invalidate();

    try {
      removePackage(pkg.source);
      this.installedPkgs = this.installedPkgs.filter(
        (p) => p.source !== pkg.source,
      );
      this.installedList = this.buildInstalledList();
      this.statusMsg = `Removed ${pkg.name}`;
      this.statusType = "success";
    } catch (e) {
      this.statusMsg = `Failed: ${String(e).slice(0, 80)}`;
      this.statusType = "error";
    }
    this.invalidate();
  }

  private async onSearchEnter(): Promise<void> {
    const idx = this.searchList?.selectedIndex ?? 0;
    const result = this.searchResults[idx];
    if (!result) return;

    this.statusMsg = `Installing ${result.name}...`;
    this.statusType = "info";
    this.invalidate();

    try {
      installPackage(`npm:${result.npmPackage}`);
      this.statusMsg = `Installed ${result.name}`;
      this.statusType = "success";
      this.installedPkgs = loadPackages();
      void checkNpmUpdates(this.installedPkgs);
      this.installedList = this.buildInstalledList();
    } catch (e) {
      this.statusMsg = `Failed: ${String(e).slice(0, 80)}`;
      this.statusType = "error";
    }
    this.invalidate();
  }

  private async updateAll(): Promise<void> {
    this.statusMsg = "Updating all packages...";
    this.statusType = "info";
    this.invalidate();

    try {
      updateAllExtensions();
      this.installedPkgs = loadPackages();
      this.installedList = this.buildInstalledList();
      this.statusMsg = "All packages updated";
      this.statusType = "success";
    } catch (e) {
      this.statusMsg = `Update failed: ${String(e).slice(0, 80)}`;
      this.statusType = "error";
    }
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];

    lines.push(this.fg("accent", this.bold(" Pi Manager ")));
    lines.push(this.fg("muted", "─".repeat(Math.min(width, 60))));

    const installedTab =
      this.tab === "installed"
        ? this.bg("selectedBg", this.fg("accent", " Installed "))
        : this.fg("muted", " Installed ");
    const searchTab =
      this.tab === "search"
        ? this.bg("selectedBg", this.fg("accent", " Search "))
        : this.fg("muted", " Search ");
    lines.push(` ${installedTab} ${searchTab}`);
    lines.push("");

    if (this.tab === "installed") {
      lines.push(...this.renderInstalled(width));
    } else {
      lines.push(...this.renderSearch(width));
    }

    lines.push("");
    const statusColor =
      this.statusType === "error"
        ? "error"
        : this.statusType === "success"
          ? "success"
          : "dim";
    lines.push(this.fg(statusColor, ` ${this.statusMsg}`));

    const bindings =
      this.tab === "installed"
        ? this.fg(
            "dim",
            " ↑↓:navigate  enter:remove  u:update all  tab:search  esc:close",
          )
        : this.fg(
            "dim",
            " type:search  ↑↓:navigate  enter:install  tab:installed  esc:close",
          );
    lines.push(bindings);

    this.cachedLines = lines.map((l) => truncateToWidth(l, width));
    this.cachedWidth = width;
    return this.cachedLines!;
  }

  private renderInstalled(width: number): string[] {
    if (this.installedPkgs.length === 0) {
      return [
        this.fg("dim", " No packages installed."),
        "",
        this.fg("dim", " Switch to Search tab to find packages."),
      ];
    }
    if (!this.installedList) this.installedList = this.buildInstalledList();
    return this.installedList.render(width);
  }

  private buildInstalledList(): SelectList {
    const items: SelectItem[] = this.installedPkgs.map((p) => {
      const icon = p.type === "npm" ? "📦" : p.type === "git" ? "🔀" : "📁";
      let desc = p.version ?? "";
      if (p.hasUpdate) {
        desc += `  ⬆ ${p.latestVersion ?? "newer"}`;
      }
      return { value: p.source, label: `${icon} ${p.name}`, description: desc };
    });

    const list = new SelectList(
      items,
      Math.min(items.length + 2, 15),
      this.themeSelectListFunctions(),
    );
    const idx = this.installedList?.selectedIndex ?? 0;
    if (idx < items.length) list.selectedIndex = idx;
    return list;
  }

  private renderSearch(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.fg("accent", ` 🔍 ${this.searchQuery}█`));
    lines.push("");

    if (this.searchLoading) {
      lines.push(this.fg("dim", " Searching..."));
    } else if (this.searchResults.length === 0) {
      if (this.searchQuery) {
        lines.push(this.fg("dim", " No results found."));
      } else {
        lines.push(this.fg("dim", " Type to search Pi packages on npm..."));
        lines.push("");
        void this.doSearch();
      }
    } else if (this.searchList) {
      lines.push(...this.searchList.render(width));
    }
    return lines;
  }

  private buildSearchList(): SelectList {
    const items: SelectItem[] = this.searchResults.map((r) => ({
      value: r.npmPackage,
      label: `📦 ${r.name}`,
      description: `${r.version} — ${r.description.slice(0, 60)}`,
    }));
    const list = new SelectList(
      items,
      Math.min(items.length + 2, 15),
      this.themeSelectListFunctions(),
    );
    if (this.searchList) {
      list.selectedIndex = Math.min(
        this.searchList.selectedIndex,
        items.length - 1,
      );
    }
    return list;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.installedList?.invalidate();
    this.searchList?.invalidate();
  }
}

// ── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("manage", {
    description: "Open the Pi plugin manager",
    handler: async (_args, ctx) => {
      const pkgs = loadPackages();

      // Background update check
      const updatePromise = Promise.all([
        checkNpmUpdates(pkgs),
        checkGitUpdates(pkgs),
      ]);

      const ui = new ManagerUI(pkgs);

      // flag for graceful async close
      let uiDone = false;

      await new Promise<void>((resolve) => {
        const handle = ctx.ui.custom((tui, theme, _kb, done) => {
          ui.setTheme(theme);
          ui.onDone = () => {
            if (!uiDone) {
              uiDone = true;
              handle.close();
              resolve();
            }
          };

          return {
            render: (w: number) => ui.render(w),
            handleInput: (data: string) => {
              ui.handleInput(data);
              tui.requestRender();
            },
            invalidate: () => ui.invalidate(),
          };
        });
      });

      try {
        await updatePromise;
      } catch {
        // update check failed silently
      }
    },
  });
}
