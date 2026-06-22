/**
 Pi-manager — Plugin manager TUI for the Pi coding agent harness.
 
 Provides the `/manage` command which opens a terminal UI to list, install,
 remove, and update Pi packages. Supports two tabs:
 - Installed: browse/remove installed packages with version info
 - Search: search the npm registry for `pi-package`-tagged packages
 
 @module pi-manager
 */

import {
  type SelectItem,
  SelectList,
  matchesKey,
  truncateToWidth,
} from '@earendil-works/pi-tui';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {
  loadPackages,
  checkNpmUpdates,
  checkGitUpdates,
  searchCatalog,
  installPackage,
  removePackage,
  updateAllExtensions,
  updatePackage,
  resolveInstalledVersion,
  fetchPackageDetails,
  fetchPackageVersions,
} from './packages';
import type {
  Package,
  SearchResult,
  Theme,
  ManagerContext,
  ConfirmAction,
  PackageDetails,
  VersionInfo,
} from './types';

// ── Constants ───────────────────────────────────────────────────────────────

type Tab = 'installed' | 'search';
type View = 'list' | 'confirm' | 'details' | 'versions';

// ── ManagerUI ───────────────────────────────────────────────────────────────

class ManagerUI {
  // Core state
  private tab: Tab = 'installed';
  private view: View = 'list';
  private installedPkgs: Package[] = [];
  private filteredPkgs: Package[] = [];
  private searchResults: SearchResult[] = [];
  private searchQuery = '';
  private installedFilter = '';
  private searchLoading = false;
  private statusMsg = '';
  private statusType: 'info' | 'error' | 'success' = 'info';
  private busy = false;
  private hasUpdates = false;

  // Confirmation state
  private confirmAction: ConfirmAction | undefined;
  private confirmTarget = '';

  // Details / versions
  private details: PackageDetails | undefined;
  private versions: VersionInfo[] = [];
  private detailsLoading = false;

  // TUI components
  private installedList: SelectList | undefined;
  private searchList: SelectList | undefined;
  private versionList: SelectList | undefined;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Dependencies
  private theme?: Theme;
  private readonly ctx!: ManagerContext;
  private requestRender: () => void;

  public onClose?: () => void;

  constructor(pkgs: Package[], ctx: ManagerContext) {
    this.installedPkgs = pkgs;
    this.ctx = ctx;
    this.requestRender = () => {};
    this.hasUpdates = pkgs.some((p) => p.hasUpdate);
    this.statusMsg = `${pkgs.length} packages installed`;
  }

  setRequestRender(fn: () => void): void {
    this.requestRender = fn;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
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
      selectedPrefix: (t: string) => this.fg('accent', t),
      selectedText: (t: string) => this.fg('accent', t),
      description: (t: string) => this.fg('muted', t),
      scrollInfo: (t: string) => this.fg('dim', t),
      noMatch: (t: string) => this.fg('warning', t),
    };
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  private setFooterStatus(text: string): void {
    try {
      this.ctx.ui.setStatus('pi-manager', text);
    } catch {
      /* */
    }
  }

  private clearFooterStatus(): void {
    try {
      this.ctx.ui.setStatus('pi-manager', undefined);
    } catch {
      /* */
    }
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
    if (matchesKey(data, 'escape')) {
      if (this.view !== 'list') {
        this.view = 'list';
        this.invalidate();
        return;
      }

      this.close();
      return;
    }

    if (this.view === 'confirm') {
      this.#handleConfirmInput(data);
      return;
    }

    if (this.view === 'details') {
      this.view = 'list';
      this.invalidate();
      return;
    }

    if (this.view === 'versions') {
      this.#handleVersionInput(data);
      return;
    }

    if (this.tab === 'installed') {
      this.#handleInstalledInput(data);
    } else {
      this.#handleSearchInput(data);
    }
  }

  // ── Installed tab input ───────────────────────────────────────────────────

  #handleInstalledInput(data: string): void {
    // Global keys
    if (data === '/') {
      this.tab = 'search';
      this.invalidate();
      return;
    }

    if (data === 'u' || data === 'U') {
      if (data === 'U' && this.filteredPkgs.length > 0) {
        this.#confirmUpdateOne();
      } else {
        this.#confirmUpdateAll();
      }

      return;
    }

    if (matchesKey(data, 'tab') || data === '\t') {
      this.tab = 'search';
      if (this.searchResults.length === 0 && !this.searchQuery) {
        void this.#doSearch();
      }

      this.invalidate();
      return;
    }

    // Remove
    if (
      matchesKey(data, 'enter') ||
      data === 'r' ||
      data === 'R' ||
      data === 'd' ||
      data === 'D' ||
      matchesKey(data, 'delete')
    ) {
      this.#confirmRemove();
      return;
    }

    // Details
    if (data === 'i' || data === 'I') {
      void this.#showDetails();
      return;
    }

    // Filter typing
    if (matchesKey(data, 'backspace')) {
      if (this.installedFilter.length > 0) {
        this.installedFilter = this.installedFilter.slice(0, -1);
        this.installedList = this.#buildInstalledList();
        this.invalidate();
      }

      return;
    }

    if (
      data.length === 1 &&
      data.charCodeAt(0) >= 32 &&
      data.charCodeAt(0) < 127
    ) {
      this.installedFilter += data;
      this.installedList = this.#buildInstalledList();
      this.invalidate();
      return;
    }

    this.installedList?.handleInput(data);
    this.invalidate();
    this.requestRender();
  }

  // ── Search tab input ──────────────────────────────────────────────────────

  #handleSearchInput(data: string): void {
    if (matchesKey(data, 'tab') || data === '\t') {
      this.tab = 'installed';
      this.invalidate();
      return;
    }

    if (matchesKey(data, 'enter')) {
      void this.#installSelected();
      return;
    }

    if (data === 'v' || data === 'V') {
      void this.#showVersions();
      return;
    }

    if (matchesKey(data, 'backspace')) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.#debounceSearch();
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
      this.#debounceSearch();
      this.invalidate();
      return;
    }

    this.searchList?.handleInput(data);
    this.invalidate();
  }

  // ── Confirmation dialog ───────────────────────────────────────────────────

  #handleConfirmInput(data: string): void {
    if (data === 'y' || data === 'Y' || matchesKey(data, 'enter')) {
      void this.#executeConfirm();
      return;
    }

    if (data === 'n' || data === 'N' || matchesKey(data, 'escape')) {
      this.view = 'list';
      this.statusMsg = 'Cancelled';
      this.statusType = 'info';
      this.invalidate();
    }
  }

  #confirmRemove(): void {
    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.confirmAction = 'remove';
    this.confirmTarget = pkg.name;
    this.view = 'confirm';
    this.invalidate();
  }

  #confirmUpdateOne(): void {
    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.confirmAction = 'update-one';
    this.confirmTarget = pkg.name;
    this.view = 'confirm';
    this.invalidate();
  }

  #confirmUpdateAll(): void {
    this.confirmAction = 'update-all';
    this.confirmTarget = 'all packages';
    this.view = 'confirm';
    this.invalidate();
  }

  async #executeConfirm(): Promise<void> {
    const action = this.confirmAction;
    this.confirmAction = undefined;
    this.view = 'list';
    if (!action) {
      return;
    }

    switch (action) {
      case 'remove': {
        await this.#removeSelected();
        break;
      }

      case 'update-one': {
        await this.#updateSelected();
        break;
      }

      case 'update-all': {
        await this.#updateAll();
        break;
      }

      case 'install': {
        break;
      }
    }
  }

  // ── Version picker ────────────────────────────────────────────────────────

  #handleVersionInput(data: string): void {
    if (matchesKey(data, 'enter')) {
      const idx = this.versionList?.selectedIndex ?? 0;
      const ver = this.versions[idx];
      if (ver) {
        void this.#installVersion(ver.version);
      }

      return;
    }

    this.versionList?.handleInput(data);
    this.invalidate();
    this.requestRender();
  }

  async #installVersion(version: string): Promise<void> {
    this.view = 'list';
    const idx = this.searchList?.selectedIndex ?? 0;
    const result = this.searchResults[idx];
    if (!result) {
      return;
    }

    this.busy = true;
    this.setFooterStatus(`📦 Installing ${result.name}@${version}...`);
    this.statusMsg = `Installing ${result.name}@${version}...`;
    this.statusType = 'info';
    this.invalidate();
    try {
      this.requestRender();
      installPackage(`npm:${result.npmPackage}@${version}`);
      this.statusMsg = `Installed ${result.name}@${version}`;
      this.statusType = 'success';
      this.installedPkgs = loadPackages();
      void checkNpmUpdates(this.installedPkgs);
      this.installedList = this.#buildInstalledList();
    } catch (error) {
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = 'error';
    }

    this.busy = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  // ── Package details ───────────────────────────────────────────────────────

  async #showDetails(): Promise<void> {
    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.filteredPkgs[idx];
    if (pkg?.type !== 'npm') {
      return;
    }

    this.detailsLoading = true;
    this.view = 'details';
    this.invalidate();
    try {
      this.details = await fetchPackageDetails(pkg.name);
    } catch {
      this.details = undefined;
    }

    this.detailsLoading = false;
    this.invalidate();
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
    const {signal} = this.#searchAbort;
    this.searchLoading = true;
    this.setFooterStatus('🔍 Searching packages...');
    this.invalidate();
    try {
      this.searchResults = await searchCatalog(this.searchQuery, 20, signal);
      this.searchList = this.#buildSearchList();
      this.statusMsg = `${this.searchResults.length} results`;
      this.statusType = 'info';
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }

      this.statusMsg = 'Search failed';
      this.statusType = 'error';
    }

    this.searchLoading = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  // ── Package operations ────────────────────────────────────────────────────

  async #removeSelected(): Promise<void> {
    if (this.busy) {
      return;
    }

    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.busy = true;
    this.setFooterStatus(`🗑 Removing ${pkg.name}...`);
    this.statusMsg = `Removing ${pkg.name}...`;
    this.statusType = 'info';
    this.invalidate();
    try {
      this.requestRender();
      removePackage(pkg.source);
      this.installedPkgs = this.installedPkgs.filter(
        (p) => p.source !== pkg.source,
      );
      this.installedList = this.#buildInstalledList();
      this.statusMsg = `Removed ${pkg.name}`;
      this.statusType = 'success';
    } catch (error) {
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = 'error';
    }

    this.busy = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  async #installSelected(): Promise<void> {
    if (this.busy) {
      return;
    }

    const idx = this.searchList?.selectedIndex ?? 0;
    const result = this.searchResults[idx];
    if (!result) {
      return;
    }

    await this.#doInstall(result);
  }

  async #doInstall(result: SearchResult, version?: string): Promise<void> {
    if (this.busy) {
      return;
    }

    const source = version
      ? `npm:${result.npmPackage}@${version}`
      : `npm:${result.npmPackage}`;
    this.busy = true;
    this.setFooterStatus(`📦 Installing ${result.name}...`);
    this.statusMsg = `Installing ${result.name}...`;
    this.statusType = 'info';
    this.invalidate();
    try {
      this.requestRender();
      installPackage(source);
      this.statusMsg = `Installed ${result.name}`;
      this.statusType = 'success';
      this.installedPkgs = loadPackages();
      void checkNpmUpdates(this.installedPkgs);
      this.installedList = this.#buildInstalledList();
    } catch (error) {
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = 'error';
    }

    this.busy = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  async #updateSelected(): Promise<void> {
    if (this.busy) {
      return;
    }

    const idx = this.installedList?.selectedIndex ?? 0;
    const pkg = this.filteredPkgs[idx];
    if (!pkg) {
      return;
    }

    this.busy = true;
    this.setFooterStatus(`🔄 Updating ${pkg.name}...`);
    this.statusMsg = `Updating ${pkg.name}...`;
    this.statusType = 'info';
    this.invalidate();
    try {
      this.requestRender();
      updatePackage(pkg.source);
      this.installedPkgs = loadPackages();
      void checkNpmUpdates(this.installedPkgs);
      this.installedList = this.#buildInstalledList();
      this.statusMsg = `Updated ${pkg.name}`;
      this.statusType = 'success';
    } catch (error) {
      this.statusMsg = `Failed: ${String(error).slice(0, 80)}`;
      this.statusType = 'error';
    }

    this.busy = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  async #updateAll(): Promise<void> {
    if (this.busy) {
      return;
    }

    this.busy = true;
    this.setFooterStatus('🔄 Updating all packages...');
    this.statusMsg = 'Updating all packages...';
    this.statusType = 'info';
    this.invalidate();
    try {
      this.requestRender();
      updateAllExtensions();
      this.installedPkgs = loadPackages();
      this.installedList = this.#buildInstalledList();
      this.statusMsg = 'All packages updated';
      this.statusType = 'success';
    } catch (error) {
      this.statusMsg = `Update failed: ${String(error).slice(0, 80)}`;
      this.statusType = 'error';
    }

    this.busy = false;
    this.clearFooterStatus();
    this.invalidate();
  }

  async #showVersions(): Promise<void> {
    const idx = this.searchList?.selectedIndex ?? 0;
    const result = this.searchResults[idx];
    if (!result) {
      return;
    }

    this.view = 'versions';
    this.detailsLoading = true;
    this.invalidate();
    try {
      this.versions = await fetchPackageVersions(result.npmPackage);
      this.versionList = this.#buildVersionList();
    } catch {
      this.versions = [];
    }

    this.detailsLoading = false;
    this.invalidate();
  }

  #buildVersionList(): SelectList {
    const items: SelectItem[] = this.versions.map((v) => ({
      value: v.version,
      label: v.version,
      description: '',
    }));
    return new SelectList(
      items,
      Math.min(items.length + 2, 15),
      this.selectListTheme(),
    );
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    lines.push(this.fg('accent', this.bold(' Pi Manager ')));
    lines.push(this.fg('muted', '─'.repeat(Math.min(width, 60))));

    // Tab bar
    const installedTab =
      this.tab === 'installed'
        ? this.bg('selectedBg', this.fg('accent', ' Installed '))
        : this.fg('muted', ' Installed ');
    const searchTab =
      this.tab === 'search'
        ? this.bg('selectedBg', this.fg('accent', ' Search '))
        : this.fg('muted', ' Search ');
    lines.push(` ${installedTab} ${searchTab}`, '');

    // Content
    switch (this.view) {
      case 'confirm': {
        lines.push(...this.#renderConfirm(width));

        break;
      }

      case 'details': {
        lines.push(...this.#renderDetails(width));

        break;
      }

      case 'versions': {
        lines.push(...this.#renderVersions(width));

        break;
      }

      case 'list': {
        if (this.tab === 'installed') {
          lines.push(...this.#renderInstalled(width));
        } else {
          lines.push(...this.#renderSearch(width));
        }
      }
    }

    lines.push('');
    const statusColor =
      this.statusType === 'error'
        ? 'error'
        : this.statusType === 'success'
          ? 'success'
          : 'dim';
    lines.push(this.fg(statusColor, ` ${this.statusMsg}`));

    // Keybinding hints
    const bindings = this.#renderBindings();
    lines.push(bindings);

    this.cachedLines = lines.map((l) => truncateToWidth(l, width));
    this.cachedWidth = width;
    return this.cachedLines;
  }

  #renderBindings(): string {
    if (this.view === 'confirm') {
      return this.fg('dim', ' y:yes  n/esc:cancel');
    }

    if (this.view === 'details' || this.view === 'versions') {
      return this.fg('dim', ' esc:back');
    }

    if (this.tab === 'installed') {
      return this.fg(
        'dim',
        ' ↑↓:navigate  enter/r/del:remove  ' +
          (this.hasUpdates
            ? this.fg('warning', 'u:update all')
            : 'u:update all') +
          '  U:update  i:details  tab:search  /:search  esc:close',
      );
    }

    return this.fg(
      'dim',
      ' type:search  ↑↓:navigate  enter:install  v:versions  tab:installed  esc:close',
    );
  }

  // ── Confirmation view ─────────────────────────────────────────────────────

  #renderConfirm(width: number): string[] {
    const actionLabels: Record<ConfirmAction, string> = {
      remove: 'remove',
      'update-all': 'update all packages',
      'update-one': 'update',
      install: 'install',
    };
    const action = actionLabels[this.confirmAction ?? 'remove'];
    return [
      '',
      this.fg('warning', this.bold(` ${action} ${this.confirmTarget}?`)),
      '',
      this.fg('dim', ' [y] Yes    [n] No'),
    ];
  }

  // ── Details view ──────────────────────────────────────────────────────────

  #renderDetails(width: number): string[] {
    if (this.detailsLoading) {
      return ['', this.fg('dim', ' Loading details...')];
    }

    if (!this.details) {
      return ['', this.fg('dim', ' No details available.')];
    }

    const d = this.details;
    const lines: string[] = [];
    lines.push(this.fg('accent', this.bold(` ${d.name}`)));
    lines.push('');
    if (d.description) {
      lines.push(this.fg('text', ` ${d.description}`));
      lines.push('');
    }

    lines.push(this.fg('dim', ` Version: ${d.version}`));
    if (d.author) {
      lines.push(this.fg('dim', ` Author: ${d.author}`));
    }

    if (d.license) {
      lines.push(this.fg('dim', ` License: ${d.license}`));
    }

    if (d.homepage) {
      lines.push(this.fg('dim', ` ${d.homepage}`));
    }

    if (d.keywords && d.keywords.length > 0) {
      lines.push(this.fg('dim', ` Keywords: ${d.keywords.join(', ')}`));
    }

    lines.push('');
    lines.push(this.fg('dim', ' esc:back'));
    return lines;
  }

  // ── Versions view ─────────────────────────────────────────────────────────

  #renderVersions(width: number): string[] {
    if (this.detailsLoading) {
      return ['', this.fg('dim', ' Loading versions...')];
    }

    if (this.versions.length === 0) {
      return ['', this.fg('dim', ' No versions available.')];
    }

    const lines: string[] = [];
    lines.push(this.fg('accent', ' Select version to install'));
    lines.push('');
    if (this.versionList) {
      lines.push(...this.versionList.render(width));
    }

    return lines;
  }

  // ── Installed tab ─────────────────────────────────────────────────────────

  #renderInstalled(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.fg('accent', ` 🔍 ${this.installedFilter}█`), '');
    if (this.installedPkgs.length === 0) {
      lines.push(this.fg('dim', ' No packages installed.'));
      lines.push('');
      lines.push(this.fg('dim', ' Switch to Search tab to find packages.'));
      return lines;
    }

    this.installedList ||= this.#buildInstalledList();
    lines.push(...this.installedList.render(width));
    return lines;
  }

  #buildInstalledList(): SelectList {
    const filter = this.installedFilter.toLowerCase();
    const filtered = filter
      ? this.installedPkgs.filter(
          (p) =>
            p.name.toLowerCase().includes(filter) ||
            p.source.toLowerCase().includes(filter),
        )
      : this.installedPkgs;
    this.hasUpdates = filtered.some((p) => p.hasUpdate);
    this.filteredPkgs = filtered;

    const items: SelectItem[] = filtered.map((p) => {
      const icon = p.hasUpdate
        ? '⬆'
        : p.type === 'npm'
          ? '📦'
          : p.type === 'git'
            ? '🔀'
            : '📁';
      const ver = resolveInstalledVersion(p);
      let desc = `${ver} — ${p.type}`;
      if (p.hasUpdate && p.latestVersion) {
        desc = `${ver} → ${p.latestVersion} — ${p.type}`;
      }

      return {value: p.source, label: `${icon} ${p.name}`, description: desc};
    });

    const list = new SelectList(
      items,
      Math.min(items.length + 2, 15),
      this.selectListTheme(),
    );
    const idx = this.installedList?.selectedIndex ?? 0;
    if (idx < items.length) {
      list.selectedIndex = idx;
    }

    return list;
  }

  // ── Search tab ────────────────────────────────────────────────────────────

  #renderSearch(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.fg('accent', ` 🔍 ${this.searchQuery}█`), '');
    if (this.searchLoading) {
      lines.push(this.fg('dim', ' Searching...'));
    } else if (this.searchResults.length === 0) {
      lines.push(
        this.searchQuery
          ? this.fg('dim', ' No results found.')
          : this.fg('dim', ' Type to search Pi packages on npm...'),
      );
    } else if (this.searchList) {
      lines.push(...this.searchList.render(width));
    }

    return lines;
  }

  #buildSearchList(): SelectList {
    const items: SelectItem[] = this.searchResults.map((r) => ({
      value: r.npmPackage,
      label: `📦 ${r.name}`,
      description: `${r.version} — ${r.description.slice(0, 60)}`,
    }));
    const list = new SelectList(
      items,
      Math.min(items.length + 2, 15),
      this.selectListTheme(),
    );
    if (this.searchList) {
      list.selectedIndex = Math.min(
        this.searchList.selectedIndex,
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
    this.versionList?.invalidate();
  }
}

// ── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand('manage', {
    description: 'Open the Pi plugin manager',
    async handler(_args, ctx) {
      const pkgs = loadPackages();

      Promise.all([checkNpmUpdates(pkgs), checkGitUpdates(pkgs)]).catch(
        () => {},
      );

      ctx.ui.setStatus('pi-manager', '🔄 Checking for updates...');

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const ui = new ManagerUI(pkgs, ctx);
        ui.setTheme(theme);
        ui.setRequestRender(() => {
          tui.requestRender();
        });
        ui.onClose = () => {
          done(undefined);
        };

        return {
          render: (w: number) => ui.render(w),
          handleInput(data: string) {
            ui.handleInput(data);
            tui.requestRender();
          },
          invalidate() {
            ui.invalidate();
          },
        };
      });

      ctx.ui.setStatus('pi-manager', undefined);
    },
  });
}
