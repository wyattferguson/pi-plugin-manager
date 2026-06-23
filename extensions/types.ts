/**
 Pi-plugin-manager — Shared types.

 @module pi-plugin-manager/types
 */

// ── Package types ───────────────────────────────────────────────────────────

export type PackageSource = "npm" | "git" | "local";

export type Package = {
  source: string;
  type: PackageSource;
  name: string;
  version?: string;
  description?: string;
  hasUpdate?: boolean;
  latestVersion?: string;
};

// ── Search types ────────────────────────────────────────────────────────────

export type SearchResult = {
  name: string;
  description: string;
  version: string;
  npmPackage: string;
  author?: string;
  homepage?: string;
};

// ── Package details ─────────────────────────────────────────────────────────

export type PackageDetails = {
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
  downloads?: number;
  publishDate?: string;
};

// ── Version picker ──────────────────────────────────────────────────────────

export type VersionInfo = {
  version: string;
};

// ── Theme ───────────────────────────────────────────────────────────────────

export type Theme = {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
  bold: (text: string) => string;
};
