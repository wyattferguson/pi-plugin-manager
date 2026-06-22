/**
 Pi-manager — Package management utilities.
 
 Reading installed packages, version checking, npm registry search,
 and CLI operations (install/remove/update).
 
 @module pi-manager/packages
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- Pi/node built-in APIs */

import {execSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {Package, PackageDetails, SearchResult, VersionInfo} from './types';

// ── Paths ───────────────────────────────────────────────────────────────────

const AGENT_DIR = join(homedir(), '.pi', 'agent');
const GLOBAL_SETTINGS = join(AGENT_DIR, 'settings.json');
const NPM_DIR = join(AGENT_DIR, 'npm');

// ── Package loading ─────────────────────────────────────────────────────────

function settingsPath(): string {
  const proj = join(process.cwd(), '.pi', 'settings.json');
  return existsSync(proj) ? proj : GLOBAL_SETTINGS;
}

/** Read installed packages from Pi's settings.json. */
export function loadPackages(): Package[] {
  const sp = settingsPath();
  if (!existsSync(sp)) {
    return [];
  }

  let raw: unknown[];
  try {
    raw = JSON.parse(readFileSync(sp, 'utf8')).packages ?? [];
  } catch {
    return [];
  }

  const result: Package[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const parsed = parseSource(entry);
      if (parsed) {
        result.push(parsed);
      }
    } else if (
      typeof entry === 'object' &&
      entry !== null &&
      'source' in entry
    ) {
      const parsed = parseSource((entry as {source: string}).source);
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  return result;
}

/** Parse a package source string into a structured Package object. */
export function parseSource(raw: string): Package | undefined {
  if (!raw) {
    return;
  }

  if (raw.startsWith('npm:')) {
    return parseNpm(raw);
  }

  if (raw.startsWith('git:') || /^(https?|ssh|git):\/\//.test(raw)) {
    return parseGit(raw);
  }

  return parseLocal(raw);
}

function parseNpm(raw: string): Package {
  const rest = raw.slice(4);
  const atIdx = rest.lastIndexOf('@');
  return {
    source: raw,
    type: 'npm',
    name: atIdx > 0 ? rest.slice(0, atIdx) : rest,
    version: atIdx > 0 ? rest.slice(atIdx + 1) : undefined,
  };
}

function parseGit(raw: string): Package {
  let url = raw.startsWith('git:') ? raw.slice(4) : raw;
  const atIdx = url.lastIndexOf('@');
  const ver = atIdx > 0 ? url.slice(atIdx + 1) : undefined;
  if (ver) {
    url = url.slice(0, atIdx);
  }

  const name =
    url
      .split('/')
      .pop()
      ?.replace(/\.git$/, '') ?? url;
  return {source: raw, type: 'git', name, version: ver};
}

function parseLocal(raw: string): Package {
  const name = raw.split(/[/\\]/).pop() ?? raw;
  return {source: raw, type: 'local', name};
}

// ── Version resolution ──────────────────────────────────────────────────────

/** Resolve the installed version of a package from disk. */
export function resolveInstalledVersion(pkg: Package): string {
  if (pkg.version) {
    return pkg.version;
  }

  if (pkg.type === 'npm') {
    const jsonPath = join(NPM_DIR, 'node_modules', pkg.name, 'package.json');
    if (existsSync(jsonPath)) {
      try {
        return JSON.parse(readFileSync(jsonPath, 'utf8')).version ?? '?';
      } catch {
        /* */
      }
    }
  }

  if (pkg.type === 'git') {
    return 'git';
  }

  if (pkg.type === 'local') {
    const jsonPath = join(pkg.source, 'package.json');
    if (existsSync(jsonPath)) {
      try {
        return JSON.parse(readFileSync(jsonPath, 'utf8')).version ?? 'local';
      } catch {
        /* */
      }
    }

    return 'local';
  }

  return '?';
}

// ── Update checks ───────────────────────────────────────────────────────────

/** Check npm registry for newer versions. Mutates packages in place. */
export async function checkNpmUpdates(pkgs: Package[]): Promise<void> {
  const results = await Promise.allSettled(
    pkgs
      .filter((p) => p.type === 'npm')
      .map(async (p) => {
        const resp = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(p.name)}/latest`,
          {signal: AbortSignal.timeout(5000)},
        );
        if (!resp.ok) {
          return;
        }

        const data = (await resp.json()) as {version: string};
        p.latestVersion = data.version;
        p.hasUpdate = p.version !== undefined && p.version !== data.version;
      }),
  );
  void results;
}

/** Check git remotes for newer tags. Offloads execSync via setTimeout. */
export async function checkGitUpdates(pkgs: Package[]): Promise<void> {
  for (const p of pkgs.filter((p) => p.type === 'git')) {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          const url = extractGitUrl(p.source);
          const output = execSync(`git ls-remote --tags "${url}"`, {
            encoding: 'utf8',
            timeout: 8000,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          const tags = output
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) =>
              (line.split('\t', 2)[1] ?? '').replace('refs/tags/', ''),
            )
            .filter((t) => /^v?\d/.test(t))
            .sort();
          const latest = tags.at(-1);
          if (latest && p.version && latest !== p.version) {
            p.latestVersion = latest;
            p.hasUpdate = true;
          }
        } catch {
          // Git not available or network issue
        }

        resolve();
      }, 0);
    });
  }
}

function extractGitUrl(source: string): string {
  let url = source;
  if (url.startsWith('git:')) {
    url = url.slice(4);
  }

  const atIdx = url.lastIndexOf('@');
  if (atIdx > 0 && (url.startsWith('http') || url.includes(':'))) {
    const after = url.slice(atIdx + 1);
    if (/^v?\d/.test(after) || after.length === 40) {
      url = url.slice(0, atIdx);
    }
  }

  return url;
}

// ── Package catalog search ──────────────────────────────────────────────────

/** Search npm registry for pi-package-tagged packages. */
export async function searchCatalog(
  query: string,
  size = 20,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  const q = trimmed
    ? `keywords:pi-package+${encodeURIComponent(trimmed)}`
    : 'keywords:pi-package';
  const url = `https://registry.npmjs.org/-/v1/search?text=${q}&size=${size}`;
  const effectiveSignal = signal ?? AbortSignal.timeout(8000);
  try {
    const resp = await fetch(url, {signal: effectiveSignal});
    if (!resp.ok) {
      return [];
    }

    const data = (await resp.json()) as {
      objects: Array<{
        package: {name: string; version: string; description?: string};
      }>;
    };
    return data.objects.map((o) => ({
      name: o.package.name,
      description: o.package.description ?? '',
      version: o.package.version,
      npmPackage: o.package.name,
    }));
  } catch {
    return [];
  }
}

// ── CLI operations ──────────────────────────────────────────────────────────

export function installPackage(source: string): string {
  return execSync(`pi install ${source}`, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function removePackage(source: string): string {
  return execSync(`pi remove ${source}`, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function updateAllExtensions(): string {
  return execSync('pi update --extensions', {
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function updatePackage(source: string): string {
  return execSync(`pi update --extension ${source}`, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── Package details ─────────────────────────────────────────────────────────

/** Fetch full package metadata from the npm registry. */
export async function fetchPackageDetails(
  name: string,
  signal?: AbortSignal,
): Promise<PackageDetails | undefined> {
  const effectiveSignal = signal ?? AbortSignal.timeout(5000);
  try {
    const resp = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      {signal: effectiveSignal},
    );
    if (!resp.ok) {
      return;
    }

    const data = (await resp.json()) as {
      name: string;
      description?: string;
      'dist-tags'?: {latest?: string};
      author?: {name?: string};
      homepage?: string;
      license?: string;
      keywords?: string[];
    };
    return {
      name: data.name,
      description: data.description ?? '',
      version: data['dist-tags']?.latest ?? '?',
      author: data.author?.name,
      homepage: data.homepage,
      license: data.license,
      keywords: data.keywords,
    };
  } catch {}
}

/** Fetch available versions for a package from the npm registry. */
export async function fetchPackageVersions(
  name: string,
  signal?: AbortSignal,
): Promise<VersionInfo[]> {
  const effectiveSignal = signal ?? AbortSignal.timeout(5000);
  try {
    const resp = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      {signal: effectiveSignal},
    );
    if (!resp.ok) {
      return [];
    }

    const data = (await resp.json()) as {versions?: Record<string, unknown>};
    if (!data.versions) {
      return [];
    }

    return Object.keys(data.versions).map((v) => ({version: v}));
  } catch {
    return [];
  }
}
