/**
 Pi-plugin-manager — Package management utilities.

 Reading installed packages, version checking, npm registry search,
 and CLI operations (install/remove/update).

 @module pi-plugin-manager/packages
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- Pi/node built-in APIs */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Package, PackageDetails, SearchResult, VersionInfo } from "./types";

// ── Paths ───────────────────────────────────────────────────────────────────

const AGENT_DIR = join(homedir(), ".pi", "agent");
const GLOBAL_SETTINGS = join(AGENT_DIR, "settings.json");
const NPM_DIR = join(AGENT_DIR, "npm");
const CACHE_FILE = join(AGENT_DIR, "pi-plugin-manager-cache.json");
const CACHE_TTL_DETAILS = 60 * 60 * 1000; // 1 hour for package details
const CACHE_TTL_SEARCH = 15 * 60 * 1000; // 15 minutes for search results

// ── Cache ───────────────────────────────────────────────────────────────────

type CacheEntry = {
  time: number;
  data: unknown;
};

type CacheStore = Record<string, CacheEntry>;

function readCache(): CacheStore {
  if (!existsSync(CACHE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(store: CacheStore): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(store), "utf8");
  } catch {
    /* */
  }
}

function cacheGet<T>(store: CacheStore, key: string, ttl: number): T | undefined {
  const entry = store[key];
  if (!entry) {
    return;
  }

  if (Date.now() - entry.time > ttl) {
    return;
  }

  return entry.data as T;
}

function cacheSet(store: CacheStore, key: string, data: unknown): void {
  store[key] = { time: Date.now(), data };
}

export function getCachedDescription(name: string): string | undefined {
  const cache = readCache();
  const key = `npm-detail:${name}`;
  const entry = cache[key];
  if (!entry || Date.now() - entry.time > CACHE_TTL_DETAILS) {
    return;
  }

  return (entry.data as { description: string }).description;
}

export function clearPackageCache(name: string): void {
  const store = readCache();
  const npmKey = `npm:${name}`;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete store[name];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete store[npmKey];
  writeCache(store);
}

// ── Package loading ─────────────────────────────────────────────────────────

function settingsPath(): string {
  const proj = join(process.cwd(), ".pi", "settings.json");
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
    raw = JSON.parse(readFileSync(sp, "utf8")).packages ?? [];
  } catch {
    return [];
  }

  const result: Package[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const parsed = parseSource(entry);
      if (parsed) {
        result.push(parsed);
      }
    } else if (typeof entry === "object" && entry !== null && "source" in entry) {
      const parsed = parseSource((entry as { source: string }).source);
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

  if (raw.startsWith("npm:")) {
    return parseNpm(raw);
  }

  if (raw.startsWith("git:") || /^(https?|ssh|git):\/\//.test(raw)) {
    return parseGit(raw);
  }

  return parseLocal(raw);
}

function parseNpm(raw: string): Package {
  const rest = raw.slice(4);
  const atIdx = rest.lastIndexOf("@");
  return {
    source: raw,
    type: "npm",
    name: atIdx > 0 ? rest.slice(0, atIdx) : rest,
    version: atIdx > 0 ? rest.slice(atIdx + 1) : undefined,
  };
}

function parseGit(raw: string): Package {
  let url = raw.startsWith("git:") ? raw.slice(4) : raw;
  const atIdx = url.lastIndexOf("@");
  const ver = atIdx > 0 ? url.slice(atIdx + 1) : undefined;
  if (ver) {
    url = url.slice(0, atIdx);
  }

  const name =
    url
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") ?? url;
  return { source: raw, type: "git", name, version: ver };
}

function parseLocal(raw: string): Package {
  const name = raw.split(/[/\\]/).pop() ?? raw;
  return { source: raw, type: "local", name };
}

// ── Version resolution ──────────────────────────────────────────────────────

/** Resolve the installed version of a package from disk. */
export function resolveInstalledVersion(pkg: Package): string {
  if (pkg.version) {
    return pkg.version;
  }

  if (pkg.type === "npm") {
    const jsonPath = join(NPM_DIR, "node_modules", pkg.name, "package.json");
    if (existsSync(jsonPath)) {
      try {
        return JSON.parse(readFileSync(jsonPath, "utf8")).version ?? "?";
      } catch {
        /* */
      }
    }
  }

  if (pkg.type === "git") {
    return "git";
  }

  if (pkg.type === "local") {
    const jsonPath = join(pkg.source, "package.json");
    if (existsSync(jsonPath)) {
      try {
        return JSON.parse(readFileSync(jsonPath, "utf8")).version ?? "local";
      } catch {
        /* */
      }
    }

    return "local";
  }

  return "?";
}

// ── Update checks ───────────────────────────────────────────────────────────

/** Check npm registry for newer versions. Mutates packages in place. */
export async function checkNpmUpdates(pkgs: Package[]): Promise<void> {
  const cache = readCache();
  let dirty = false;

  const results = await Promise.allSettled(
    pkgs
      .filter((p) => p.type === "npm")
      .map(async (p) => {
        // Check cache first
        const key = `npm-detail:${p.name}`;
        const cached = cacheGet<{ version: string; description: string }>(
          cache,
          key,
          CACHE_TTL_DETAILS,
        );
        if (cached) {
          p.latestVersion = cached.version;
          p.description = cached.description;
          p.hasUpdate = p.version !== undefined && p.version !== cached.version;
          return;
        }

        const resp = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(p.name)}/latest`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!resp.ok) {
          return;
        }

        const data = (await resp.json()) as {
          version: string;
          description?: string;
        };
        p.latestVersion = data.version;
        p.description = data.description ?? "";
        p.hasUpdate = p.version !== undefined && p.version !== data.version;

        cacheSet(cache, key, {
          version: data.version,
          description: data.description ?? "",
        });
        dirty = true;
      }),
  );
  void results;
  if (dirty) {
    writeCache(cache);
  }
}

/** Check git remotes for newer tags. Offloads execSync via setTimeout. */
export async function checkGitUpdates(pkgs: Package[]): Promise<void> {
  for (const p of pkgs.filter((p) => p.type === "git")) {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
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
            .map((line) => (line.split("\t", 2)[1] ?? "").replace("refs/tags/", ""))
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
  if (url.startsWith("git:")) {
    url = url.slice(4);
  }

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

/** Search npm registry for pi-package-tagged packages. */
export async function searchCatalog(
  query: string,
  size = 20,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  const q = trimmed ? `keywords:pi-package+${encodeURIComponent(trimmed)}` : "keywords:pi-package";

  // Check cache for empty/popular query
  if (!trimmed) {
    const cache = readCache();
    const cached = cacheGet<SearchResult[]>(cache, "search:popular", CACHE_TTL_SEARCH);
    if (cached) {
      return cached;
    }
  }

  const url = `https://registry.npmjs.org/-/v1/search?text=${q}&size=${size}`;
  const effectiveSignal = signal ?? AbortSignal.timeout(8000);
  try {
    const resp = await fetch(url, { signal: effectiveSignal });
    if (!resp.ok) {
      return [];
    }

    const data = (await resp.json()) as {
      objects: Array<{
        package: { name: string; version: string; description?: string };
      }>;
    };
    const results = data.objects.map((o) => ({
      name: o.package.name,
      description: o.package.description ?? "",
      version: o.package.version,
      npmPackage: o.package.name,
    }));

    // Cache popular results
    if (!trimmed && results.length > 0) {
      const store = readCache();
      cacheSet(store, "search:popular", results);
      writeCache(store);
    }

    return results;
  } catch {
    return [];
  }
}

// ── CLI operations ──────────────────────────────────────────────────────────

export function installPackage(source: string): string {
  return execSync(`pi install ${source}`, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Run a pi CLI command asynchronously via spawn. */
async function spawnPi(args: string[], timeout = 120_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("pi", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `exit code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

/** Install a package asynchronously via spawn. */
export async function installPackageAsync(source: string): Promise<string> {
  return spawnPi(["install", source]);
}

export function removePackage(source: string): string {
  return execSync(`pi remove ${source}`, {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Remove a package asynchronously via spawn. */
export async function removePackageAsync(source: string): Promise<string> {
  return spawnPi(["remove", source], 60_000);
}

export function updatePackage(source: string): string {
  return execSync(`pi update --extension ${source}`, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Update all extensions asynchronously via spawn. Returns stdout on success. */
export async function updateAllExtensionsAsync(): Promise<string> {
  return spawnPi(["update", "--extensions"], 300_000);
}

// ── Package details ─────────────────────────────────────────────────────────

/** Fetch full package metadata from the npm registry. */
export async function fetchPackageDetails(
  name: string,
  signal?: AbortSignal,
): Promise<PackageDetails | undefined> {
  const effectiveSignal = signal ?? AbortSignal.timeout(5000);
  try {
    const [resp, dlResp] = await Promise.all([
      fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        signal: effectiveSignal,
      }),
      fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`, {
        signal: effectiveSignal,
      }),
    ]);
    if (!resp.ok) {
      return;
    }

    const data = (await resp.json()) as {
      name: string;
      description?: string;
      "dist-tags"?: { latest?: string };
      author?: { name?: string };
      homepage?: string;
      license?: string;
      keywords?: string[];
      time?: { modified?: string };
    };
    let downloads: number | undefined;
    if (dlResp.ok) {
      const dlData = (await dlResp.json()) as { downloads?: number };
      downloads = dlData.downloads;
    }

    return {
      name: data.name,
      description: data.description ?? "",
      version: data["dist-tags"]?.latest ?? "?",
      author: data.author?.name,
      homepage: data.homepage,
      license: data.license,
      keywords: data.keywords,
      downloads,
      publishDate: data.time?.modified,
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
    const resp = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      signal: effectiveSignal,
    });
    if (!resp.ok) {
      return [];
    }

    const data = (await resp.json()) as { versions?: Record<string, unknown> };
    if (!data.versions) {
      return [];
    }

    return Object.keys(data.versions).map((v) => ({ version: v }));
  } catch {
    return [];
  }
}
