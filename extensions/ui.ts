/**
 Pi-plugin-manager — Plugin manager TUI for the Pi coding agent harness.

 Provides the `/plugins` command which opens a terminal UI to list, install,
 remove, and update Pi packages. Supports two tabs:
 - Installed: browse/remove installed packages with version info
 - Search: search the npm registry for `pi-package`-tagged packages

 @module pi-plugin-manager/ui
 */

import { type SelectItem, SelectList, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  loadPackages,
  checkNpmUpdates,
  searchCatalog,
  installPackageAsync,
  removePackageAsync,
  resolveInstalledVersion,
  fetchPackageDetails,
  getCachedDescription,
} from "./packages";
import type { Package, SearchResult, PackageDetails } from "./types";
// Matches pi's Theme class shape (fg/bg/bold methods)
interface Theme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

// ── Constants ───────────────────────────────────────────────────────────────

type Tab = "installed" | "search";
type View = "list" | "confirm" | "details";

// ── ManagerUI ───────────────────────────────────────────────────────────────

export class ManagerUI {
  // Core state
  private tab: Tab = "installed";
  private view: View = "list";
  private installedPkgs: Package[] = [];
  private readonly screenHeight: number;
  private filteredPkgs: Package[] = [];
  private searchResults: SearchResult[] = [];
  private searchQuery = "";

  private searchLoading = false;
  private statusMsg = "";
  private statusIcon = "";
  private statusType: "info" | "error" | "success" = "info";
  private busy = false;
  private hasUpdates = false;
  private updatingSource = "";
  private removingSource = "";
  private checkingVersions = true;
  private installingSearchPkg = "";
  private readonly justUpdatedSources = new Set<string>();
  private errorSources = new Map<string, string>();

  // Confirmation state
  private confirmTarget = "";
  private confirmInstallPkg: SearchResult | undefined;

  // Details
  private details: PackageDetails | undefined;
  private detailsLoading = false;
  private detailsSearchPkg: SearchResult | undefined;

  // TUI components
  private installedList: SelectList | undefined;
  private searchList: SelectList | undefined;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Dependencies
  private theme?: Theme;
  private requestRender: () => void;

  public onClose?: () => void;
  /** Whether any install/remove/update was performed this session. */
  changed = false;

  constructor(pkgs: Package[], screenHeight?: number) {
    this.installedPkgs = pkgs;
    this.requestRender = () => {};
    this.hasUpdates = pkgs.some((p) => p.hasUpdate);
    this.statusMsg = `${pkgs.length} packages installed`;
    this.screenHeight = screenHeight ?? 30;
  }

  setRequestRender(fn: () => void): void {
    this.requestRender = fn;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  finishCheckingVersions(): void {
    this.invalidate();
    this.requestRender();
    // Defer clearing so the ⏳ icons are visible briefly
    setTimeout(() => {
      this.checkingVersions = false;
      this.installedList = this.#buildInstalledList();
      this.invalidate();
      this.requestRender();
    }, 600);
  }

  // ── Theme helpers ─────────────────────────────────────────────────────────

  private fg(color: string, text: string): string {
    return this.theme?.fg?.(color, text) ?? text;
  }

  private bg(color: string, text: string): string {
    return this.theme?.bg?.(color, text) ?? text;
  }

  private bold(text: string): string {
    return this.theme?.bold?.(text) ?? text;
  }

  private selectListTheme() {
    return {
      selectedPrefix: (t: string) => this.fg("accent", t),
      selectedText: (t: string) => this.fg("accent", t),
      description: (t: string) => this.fg("muted", t),
      scrollInfo: (t: string) => this.fg("dim", t),
      noMatch: (t: string) => this.fg("warning", t),
    };
  }

  private close(): void {
    this.onClose?.();
  }

  // ── Input dispatch ────────────────────────────────────────────────────────

  handleInput(data: string): void {
    try {
      this.#dispatchInput(data);
    } catch {
      /* */
    }
  }

  #dispatchInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.view !== "list") {
        this.view = "list";
        this.invalidate();
        return;
      }

      this.close();
      return;
    }

    if (this.view === "confirm") {
      this.#handleConfirmInput(data);
      return;
    }

    if (this.view === "details") {
      // Enter on search details installs the package
      if (this.tab === "search" && this.detailsSearchPkg && matchesKey(data, "enter")) {
        this.view = "list";
        const pkg = this.detailsSearchPkg;
        this.detailsSearchPkg = undefined;
        void this.#doInstall(pkg);
        return;
      }

      // R/del/enter on details view triggers remove if viewing installed package
      if (
        this.tab === "installed" &&
        (matchesKey(data, "r") ||
          data === "R" ||
          matchesKey(data, "enter") ||
          matchesKey(data, "delete") ||
          data === "d" ||
          data === "D")
      ) {
        this.view = "list";
        this.#confirmRemove();
        return;
      }

      this.view = "list";
      this.detailsSearchPkg = undefined;
      this.invalidate();
      this.requestRender();
      return;
    }

    if (this.tab === "installed") {
      this.#handleInstalledInput(data);
    } else {
      this.#handleSearchInput(data);
    }
  }

  // ── Installed tab input ───────────────────────────────────────────────────

  #handleInstalledInput(data: string): void {
    // Global keys
    if (data === "u" || data === "U") {
      void this.#updateAll();
      return;
    }

    if (matchesKey(data, "tab") || data === "\t") {
      this.tab = "search";
      if (this.searchResults.length === 0 && !this.searchQuery) {
        void this.#doSearch();
      }

      this.invalidate();
      return;
    }

    // Remove
    if (
      matchesKey(data, "enter") ||
      data === "r" ||
      data === "R" ||
      data === "d" ||
      data === "D" ||
      matchesKey(data, "delete")
    ) {
      this.#confirmRemove();
      return;
    }

    // Details
    if (data === "i" || data === "I") {
      void this.#showDetails();
      return;
    }

    // Page up/down
    if (matchesKey(data, "pageUp")) {
      this.#pageUp("installed");
      return;
    }

    if (matchesKey(data, "pageDown")) {
      this.#pageDown("installed");
      return;
    }

    this.installedList?.handleInput(data);
    this.invalidate();
    this.requestRender();
  }

  // ── Search tab input ──────────────────────────────────────────────────────

  #handleSearchInput(data: string): void {
    if (matchesKey(data, "tab") || data === "\t") {
      this.tab = "installed";
      this.invalidate();
      return;
    }

    if (matchesKey(data, "enter")) {
      // Enter on a search result opens details, not install
      void this.#showSearchDetails();
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.#debounceSearch();
        this.invalidate();
      }

      return;
    }

    // 'd' opens details when browsing results (not typing)
    // Typing a printable char
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
      this.searchQuery += data;
      this.#debounceSearch();
      this.invalidate();
      return;
    }

    // Page up/down
    if (matchesKey(data, "pageUp")) {
      this.#pageUp("search");
      return;
    }

    if (matchesKey(data, "pageDown")) {
      this.#pageDown("search");
      return;
    }

    this.searchList?.handleInput(data);
    this.invalidate();
  }

  // ── Confirmation dialog ───────────────────────────────────────────────────

  #handleConfirmInput(data: string): void {
    if (data === "y" || data === "Y" || matchesKey(data, "enter")) {
      void this.#executeConfirm();
      return;
    }

    if (data === "n" || data === "N" || matchesKey(data, "escape")) {
      this.view = "list";
      this.confirmInstallPkg = undefined;
      this.statusMsg = "Cancelled";
      this.statusType = "info";
      this.invalidate();
    }
  }

  #selectedIndex(list: SelectList | undefined): number {
    if (!list) return 0;
    return (list as unknown as { selectedIndex: number }).selectedIndex;
  }

  #confirmRemove(): void {
    const idx = this.#selectedIndex(this.installedList);
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.confirmTarget = pkg.name;
    this.view = "confirm";
    this.invalidate();
  }

  async #executeConfirm(): Promise<void> {
    this.view = "list";

    if (this.confirmInstallPkg) {
      const result = this.confirmInstallPkg;
      this.confirmInstallPkg = undefined;
      await this.#doInstall(result);
      return;
    }

    if (this.confirmTarget) {
      await this.#removeSelected();
    }
  }

  // ── Version picker ────────────────────────────────────────────────────────

  // ── Package details ───────────────────────────────────────────────────────

  async #showDetails(): Promise<void> {
    const idx = this.#selectedIndex(this.installedList);
    const pkg = this.filteredPkgs[idx];
    if (pkg?.type !== "npm") {
      return;
    }

    void this.#fetchAndShowDetails(pkg.name);
  }

  async #showSearchDetails(): Promise<void> {
    const idx = this.#selectedIndex(this.searchList);
    const result = this.searchResults[idx];
    if (!result) {
      return;
    }

    this.detailsSearchPkg = result;
    void this.#fetchAndShowDetails(result.npmPackage);
  }

  async #fetchAndShowDetails(name: string): Promise<void> {
    this.detailsLoading = true;
    this.view = "details";
    this.invalidate();
    try {
      this.details = await fetchPackageDetails(name);
    } catch {
      this.details = undefined;
    }

    this.detailsLoading = false;
    this.invalidate();
    this.requestRender();
  }

  // ── Search ────────────────────────────────────────────────────────────────

  #searchTimer: ReturnType<typeof setTimeout> | undefined;
  #searchAbort: AbortController | undefined;

  #debounceSearch(): void {
    this.#searchAbort?.abort();
    if (this.#searchTimer) {
      clearTimeout(this.#searchTimer);
    }

    this.#searchTimer = setTimeout(() => {
      void this.#doSearch();
    }, 300);
  }

  async #doSearch(): Promise<void> {
    this.#searchAbort?.abort();
    this.#searchAbort = new AbortController();
    const { signal } = this.#searchAbort;
    this.searchLoading = true;
    this.invalidate();
    try {
      this.searchResults = await searchCatalog(this.searchQuery, 20, signal);
      this.installingSearchPkg = "";
      this.searchList = this.#buildSearchList();
      this.statusMsg = `${this.searchResults.length} results`;
      this.statusType = "info";
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }

      this.statusMsg = "Search failed";
      this.statusType = "error";
    }

    this.searchLoading = false;
    this.invalidate();
    this.requestRender();
  }

  // ── Package operations ────────────────────────────────────────────────────

  /** Start a spinner animation on the notification box. Returns the interval handle. */
  #startSpinner(text: string): ReturnType<typeof setInterval> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    // Show first frame immediately
    this.statusIcon = frames[0];
    this.statusMsg = text;
    this.statusType = "info";
    this.invalidate();
    this.requestRender();
    return setInterval(() => {
      i = (i + 1) % frames.length;
      this.statusIcon = frames[i];
      this.statusType = "info";
      this.invalidate();
      this.requestRender();
    }, 120);
  }

  async #removeSelected(): Promise<void> {
    if (this.busy) {
      return;
    }

    const idx = this.#selectedIndex(this.installedList);
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.busy = true;
    this.removingSource = pkg.source;
    this.installedList = this.#buildInstalledList();
    this.invalidate();
    this.requestRender();
    const spinner = this.#startSpinner(`Removing ${pkg.name}`);

    try {
      await removePackageAsync(pkg.source);
      clearInterval(spinner);
      this.removingSource = "";
      this.installedPkgs = this.installedPkgs.filter((p) => p.source !== pkg.source);
      this.installedList = this.#buildInstalledList();
      this.statusIcon = "✓";
      this.statusMsg = `Removed ${pkg.name}`;
      this.statusType = "success";
      this.changed = true;
    } catch (error) {
      clearInterval(spinner);
      this.removingSource = "";
      this.errorSources.set(pkg.source, String(error).slice(0, 60));
      setTimeout(() => {
        this.errorSources.delete(pkg.source);
        this.invalidate();
        this.requestRender();
      }, 8000);
      this.statusIcon = "✗";
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = "error";
    }

    this.busy = false;
    this.invalidate();
    this.requestRender();
  }

  async #doInstall(result: SearchResult, version?: string): Promise<void> {
    if (this.busy) {
      return;
    }

    const source = version ? `npm:${result.npmPackage}@${version}` : `npm:${result.npmPackage}`;
    this.busy = true;
    this.installingSearchPkg = result.npmPackage;
    this.searchList = this.#buildSearchList();
    this.invalidate();
    this.requestRender();
    const spinner = this.#startSpinner(`Installing ${result.name}`);

    try {
      await installPackageAsync(source);
      clearInterval(spinner);
      this.statusIcon = "✓";
      this.statusMsg = `Installed ${result.name}`;
      this.statusType = "success";
      this.changed = true;
      this.installedPkgs = loadPackages();
      await checkNpmUpdates(this.installedPkgs);
      this.installedList = this.#buildInstalledList();
      this.busy = false;
      // Keep installingSearchPkg so ✓ shows until next search
      this.searchList = this.#buildSearchList();
    } catch (error) {
      clearInterval(spinner);
      this.installingSearchPkg = "";
      this.errorSources.set(result.npmPackage, String(error).slice(0, 60));
      setTimeout(() => {
        this.errorSources.delete(result.npmPackage);
        this.invalidate();
        this.requestRender();
      }, 8000);
      this.statusIcon = "✗";
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = "error";
    }

    this.busy = false;
    this.invalidate();
    this.requestRender();
  }

  async #updateAll(): Promise<void> {
    if (this.busy) {
      return;
    }

    this.busy = true;
    this.updatingSource = "*";
    const oldPkgs = this.installedPkgs.map((p) => ({ ...p, _version: resolveInstalledVersion(p) }));
    const spinner = this.#startSpinner("Updating all packages");

    try {
      // Update each outdated package individually (handles pinned versions)
      const toUpdate = this.installedPkgs.filter((p) => p.hasUpdate && p.type === "npm");
      for (const p of toUpdate) {
        this.statusMsg = `Updating ${p.name}`;
        this.invalidate();
        this.requestRender();
        try {
          await installPackageAsync(`npm:${p.name}@latest`);
        } catch {
          this.errorSources.set(p.source, "Update failed");
          setTimeout(() => {
            this.errorSources.delete(p.source);
            this.invalidate();
            this.requestRender();
          }, 8000);
        }
      }

      clearInterval(spinner);
      this.updatingSource = "";
      this.installedPkgs = loadPackages();
      await checkNpmUpdates(this.installedPkgs);

      // Mark packages that actually changed version
      for (const p of this.installedPkgs) {
        const oldEntry = oldPkgs.find((o) => o.name === p.name);
        if (oldEntry) {
          const newVer = resolveInstalledVersion(p);
          if (
            oldEntry._version !== newVer &&
            oldEntry._version !== "?" &&
            oldEntry._version !== "local"
          ) {
            this.justUpdatedSources.add(p.source);
          }
        }
      }

      // Auto-clear after 8 seconds
      setTimeout(() => {
        this.justUpdatedSources.clear();
        this.invalidate();
        this.requestRender();
      }, 8000);
      this.installedList = this.#buildInstalledList();
      this.statusIcon = "✓";
      this.statusMsg = "All packages updated";
      this.statusType = "success";
      this.changed = true;
    } catch (error) {
      clearInterval(spinner);
      this.updatingSource = "";
      this.statusIcon = "✗";
      this.statusMsg = `Update failed: ${String(error).slice(0, 80)}`;
      this.statusType = "error";
    }

    this.busy = false;
    this.invalidate();
    this.requestRender();
  }

  // ── Page up/down ──────────────────────────────────────────────────────────

  #pageUp(tab: Tab): void {
    const list = tab === "installed" ? this.installedList : this.searchList;
    if (!list) {
      return;
    }

    const max = 20;
    const sl = list as unknown as {
      selectedIndex: number;
      filteredItems: unknown[];
    };
    sl.selectedIndex = Math.max(0, sl.selectedIndex - max);
    this.invalidate();
  }

  #pageDown(tab: Tab): void {
    const list = tab === "installed" ? this.installedList : this.searchList;
    if (!list) {
      return;
    }

    const max = 20;
    const sl = list as unknown as {
      selectedIndex: number;
      filteredItems: unknown[];
    };
    sl.selectedIndex = Math.min(sl.selectedIndex + max, sl.filteredItems.length - 1);
    this.invalidate();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    lines.push(this.fg("muted", "─".repeat(width)));
    lines.push(this.fg("accent", this.bold(" Pi Plugin Manager ")));
    lines.push(this.fg("muted", "─".repeat(width)));

    // Tab bar
    const installedTab =
      this.tab === "installed"
        ? this.bg("selectedBg", this.fg("accent", " Installed "))
        : this.fg("muted", " Installed ");
    const searchTab =
      this.tab === "search"
        ? this.bg("selectedBg", this.fg("accent", " Search "))
        : this.fg("muted", " Search ");
    lines.push(` ${installedTab} ${searchTab}`, "");

    // Content
    switch (this.view) {
      case "confirm": {
        lines.push(...this.#renderConfirm(width));

        break;
      }

      case "details": {
        lines.push(...this.#renderDetails(width));

        break;
      }

      case "list": {
        if (this.tab === "installed") {
          lines.push(...this.#renderInstalled(width));
        } else {
          lines.push(...this.#renderSearch(width));
        }
      }
    }

    lines.push("");

    // Status text
    if (this.view !== "confirm") {
      lines.push(...this.#renderStatus(width));
      lines.push("");
    }

    // Keybinding hints
    const bindings = this.#renderBindings();
    if (bindings) {
      lines.push(bindings);
    }

    lines.push(this.fg("muted", "─".repeat(width)));

    // Pad with empty lines to fill the terminal height
    while (lines.length < this.screenHeight) {
      lines.push("");
    }

    this.cachedLines = lines.map((l) => truncateToWidth(l, width));
    this.cachedWidth = width;
    return this.cachedLines;
  }

  #keyHint(key: string, desc: string, keyColor = "accent"): string {
    return this.fg(keyColor, key) + this.fg("dim", `:${desc}`);
  }

  #renderStatus(width: number): string[] {
    const color =
      this.statusType === "error" ? "error" : this.statusType === "success" ? "success" : "accent";
    const icon = this.statusIcon ? this.fg(color, this.statusIcon) : "";
    const text = this.fg("text", ` ${this.statusMsg}`);
    return [truncateToWidth(icon + text, width, "")];
  }

  #renderBindings(): string {
    if (this.view === "confirm") {
      return [this.#keyHint("y", "yes"), this.#keyHint("n/esc", "cancel")].join("  ");
    }

    if (this.view === "details") {
      if (this.tab === "search" && this.detailsSearchPkg) {
        return [this.#keyHint("enter", "install"), this.#keyHint("esc", "back")].join("  ");
      }

      return this.#keyHint("esc", "back");
    }

    if (this.tab === "installed") {
      const parts = [
        this.#keyHint("↑↓", "navigate"),
        this.#keyHint("enter/r/del", "remove", "warning"),
        this.hasUpdates
          ? this.fg("warning", "u") + this.fg("dim", ":update all")
          : this.#keyHint("u", "update all"),
        this.#keyHint("i", "details"),
        this.#keyHint("tab", "search"),
        this.#keyHint("esc", "close"),
      ];
      return parts.join("  ");
    }

    return [
      this.#keyHint("type", "search"),
      this.#keyHint("↑↓", "navigate"),
      this.#keyHint("enter", "details"),
      this.#keyHint("tab", "installed"),
      this.#keyHint("esc", "close"),
    ].join("  ");
  }

  // ── Confirmation view ─────────────────────────────────────────────────────

  #renderConfirm(_width: number): string[] {
    const target = this.confirmInstallPkg
      ? `install ${this.confirmInstallPkg.name}?`
      : `remove ${this.confirmTarget}?`;
    return [
      "",
      this.fg("warning", this.bold(` ${target}`)),
      "",
      this.fg("dim", " [y] Yes    [n] No"),
    ];
  }

  // ── Details view ──────────────────────────────────────────────────────────

  #renderDetails(_width: number): string[] {
    if (this.detailsLoading) {
      return ["", this.fg("dim", " Loading details...")];
    }

    if (!this.details) {
      return ["", this.fg("dim", " No details available.")];
    }

    const d = this.details;
    const lines: string[] = [];
    lines.push(this.fg("accent", this.bold(` ${d.name}`)));
    lines.push("");
    if (d.description) {
      lines.push(this.fg("text", ` ${d.description}`));
      lines.push("");
    }

    lines.push(this.fg("dim", ` Version: ${d.version}`));
    if (d.author) {
      lines.push(this.fg("dim", ` Author: ${d.author}`));
    }

    if (d.license) {
      lines.push(this.fg("dim", ` License: ${d.license}`));
    }

    if (d.homepage) {
      lines.push(this.fg("dim", ` ${d.homepage}`));
    }

    if (d.keywords && d.keywords.length > 0) {
      lines.push(this.fg("dim", ` Keywords: ${d.keywords.join(", ")}`));
    }

    if (d.downloads !== undefined) {
      lines.push(this.fg("dim", ` Downloads (last month): ${d.downloads.toLocaleString()}`));
    }

    if (d.publishDate) {
      const pubDate = new Date(d.publishDate);
      lines.push(this.fg("dim", ` Last publish: ${pubDate.toLocaleDateString()}`));
    }

    lines.push("");
    if (this.tab === "search" && this.detailsSearchPkg) {
      lines.push([this.#keyHint("enter", "install"), this.#keyHint("esc", "back")].join("  "));
    } else {
      lines.push(this.fg("dim", " esc:back"));
    }

    return lines;
  }

  // ── Installed tab ─────────────────────────────────────────────────────────

  #renderInstalled(width: number): string[] {
    const lines: string[] = [];
    if (this.installedPkgs.length === 0) {
      lines.push(this.fg("dim", " No packages installed."));
      lines.push("");
      lines.push(this.fg("dim", " Switch to Search tab to find packages."));
      return lines;
    }

    this.installedList ||= this.#buildInstalledList();
    lines.push(...this.installedList.render(width));
    return lines;
  }

  #buildInstalledList(): SelectList {
    this.hasUpdates = this.installedPkgs.some((p) => p.hasUpdate);
    this.filteredPkgs = this.installedPkgs;

    const items: SelectItem[] = this.filteredPkgs.map((p) => {
      const isRemoving = this.removingSource === p.source;
      const isUpdating = this.updatingSource === "*" || this.updatingSource === p.source;
      const isChecking = this.checkingVersions && p.type === "npm";
      const wasUpdated = this.justUpdatedSources.has(p.source);
      const hasError = this.errorSources.has(p.source);
      const icon = hasError
        ? "❌"
        : isRemoving
          ? "✗"
          : wasUpdated
            ? "✓"
            : isUpdating || isChecking
              ? "⏳"
              : p.hasUpdate
                ? "🔄"
                : p.type === "npm"
                  ? "📦"
                  : p.type === "git"
                    ? "🔀"
                    : "📁";
      const ver = resolveInstalledVersion(p);
      const desc = p.description || getCachedDescription(p.name) || p.type;
      const errMsg = this.errorSources.get(p.source);
      let text = errMsg ? `\u001B[31m${errMsg}\u001B[0m` : `${ver} — ${desc}`;
      if (isRemoving) {
        text = `\u001B[31mUninstalling...\u001B[0m`;
      } else if (isUpdating) {
        text = `\u001B[33mUpdating...\u001B[0m`;
      } else if (errMsg) {
        text = `\u001B[31m${errMsg}\u001B[0m`;
      } else if (p.hasUpdate && p.latestVersion) {
        text = `${ver} → ${p.latestVersion} — ${desc}`;
      }

      if (wasUpdated && !isRemoving) {
        text = `\x1b[33m${ver}\x1b[0m — ${desc}`;
      }

      return { value: p.source, label: `${icon} ${p.name}`, description: text };
    });

    const list = new SelectList(items, Math.min(items.length + 2, 20), this.selectListTheme());
    const idx = this.#selectedIndex(this.installedList);
    if (idx < items.length) {
      (list as unknown as { selectedIndex: number }).selectedIndex = idx;
    }

    return list;
  }

  // ── Search tab ────────────────────────────────────────────────────────────

  #renderSearch(width: number): string[] {
    const lines: string[] = [];

    lines.push(this.fg("accent", ` 🔍 ${this.searchQuery}█`), "");

    if (this.searchLoading) {
      lines.push(this.fg("dim", " Searching..."));
    } else if (this.searchResults.length === 0) {
      lines.push(
        this.searchQuery
          ? this.fg("dim", " No results found.")
          : this.fg("dim", " Type to search Pi packages on npm..."),
      );
    } else if (this.searchList) {
      lines.push(...this.searchList.render(width));
    }

    return lines;
  }

  #buildSearchList(): SelectList {
    const items: SelectItem[] = this.searchResults.map((r) => {
      const errMsg = this.errorSources.get(r.npmPackage);
      if (errMsg) {
        return {
          value: r.npmPackage,
          label: `❌ ${r.name}`,
          description: `\u001B[31m${errMsg}\u001B[0m`,
        };
      }

      if (this.installingSearchPkg === r.npmPackage) {
        if (this.busy) {
          return {
            value: r.npmPackage,
            label: `⏳ ${r.name}`,
            description: `\u001B[33mInstalling...\u001B[0m`,
          };
        }

        return {
          value: r.npmPackage,
          label: `✓ ${r.name}`,
          description: `\u001B[32mInstalled\u001B[0m`,
        };
      }

      return {
        value: r.npmPackage,
        label: `📦 ${r.name}`,
        description: `${r.version} — ${r.description.slice(0, 60)}`,
      };
    });
    const list = new SelectList(items, Math.min(items.length + 2, 20), this.selectListTheme());
    const prevIdx = this.#selectedIndex(this.searchList);
    if (this.searchList) {
      (list as unknown as { selectedIndex: number }).selectedIndex = Math.min(
        prevIdx,
        items.length - 1,
      );
    }

    return list;
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.installedList?.invalidate();
    this.searchList?.invalidate();
  }
}
