/**
 Tests: Package parsing, loading, filtering, and version resolution.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- bun:test types */

import {describe, expect, test} from 'bun:test';
import {parseSource, resolveInstalledVersion} from '../extensions/packages';
import type {Package} from '../extensions/types';

// ── parseSource ─────────────────────────────────────────────────────────────

describe('parseSource', () => {
  test('npm without version', () => {
    const p = parseSource('npm:context-mode');
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('npm');
    expect(p!.name).toBe('context-mode');
    expect(p!.version).toBeUndefined();
  });

  test('npm with pinned version', () => {
    const p = parseSource('npm:context-mode@1.2.3');
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('npm');
    expect(p!.name).toBe('context-mode');
    expect(p!.version).toBe('1.2.3');
  });

  test('npm scoped package', () => {
    const p = parseSource('npm:@scope/pkg@1.0.0');
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('npm');
    expect(p!.name).toBe('@scope/pkg');
    expect(p!.version).toBe('1.0.0');
  });

  test('git with ref', () => {
    const p = parseSource('git:github.com/user/repo@v1');
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('git');
    expect(p!.name).toBe('repo');
    expect(p!.version).toBe('v1');
  });

  test('https git URL', () => {
    const p = parseSource('https://github.com/user/repo@v2');
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('git');
    expect(p!.name).toBe('repo');
  });

  test('local path', () => {
    const p = parseSource(String.raw`C:\path\to\pkg`);
    expect(p).not.toBeUndefined();
    expect(p!.type).toBe('local');
    expect(p!.name).toBe('pkg');
  });

  test('empty string', () => {
    expect(parseSource('')).toBeUndefined();
  });

  test('npm scoped without version', () => {
    const p = parseSource('npm:@scope/pkg');
    expect(p).not.toBeUndefined();
    expect(p!.name).toBe('@scope/pkg');
    expect(p!.version).toBeUndefined();
  });
});

// ── loadPackages (via parseSource) ──────────────────────────────────────────

describe('loadPackages-like processing', () => {
  function processEntries(entries: unknown[]): Package[] {
    const result: Package[] = [];
    for (const entry of entries) {
      if (typeof entry === 'string') {
        const p = parseSource(entry);
        if (p) {
          result.push(p);
        }
      } else if (
        typeof entry === 'object' &&
        entry !== null &&
        'source' in entry
      ) {
        const p = parseSource((entry as {source: string}).source);
        if (p) {
          result.push(p);
        }
      }
    }

    return result;
  }

  test('string entries', () => {
    const pkgs = processEntries(['npm:foo', 'git:github.com/u/r@v1']);
    expect(pkgs.length).toBe(2);
    expect(pkgs[0].name).toBe('foo');
    expect(pkgs[1].name).toBe('r');
  });

  test('object entries', () => {
    const pkgs = processEntries([{source: 'npm:bar', extensions: ['*.ts']}]);
    expect(pkgs.length).toBe(1);
    expect(pkgs[0].name).toBe('bar');
  });

  test('mixed entries', () => {
    const pkgs = processEntries([
      'npm:a',
      {source: 'git:github.com/x/y@v1'},
      'npm:@scope/c@2.0.0',
    ]);
    expect(pkgs.length).toBe(3);
    expect(pkgs[0].name).toBe('a');
    expect(pkgs[1].name).toBe('y');
    expect(pkgs[2].name).toBe('@scope/c');
  });

  test('empty array', () => {
    expect(processEntries([]).length).toBe(0);
  });

  test('filters undefined', () => {
    const pkgs = processEntries(['', 'npm:ok']);
    expect(pkgs.length).toBe(1);
  });
});

// ── resolveInstalledVersion ─────────────────────────────────────────────────

describe('resolveInstalledVersion', () => {
  test('pinned version takes priority', () => {
    expect(resolveInstalledVersion(makePkg({version: '1.0.0'}))).toBe('1.0.0');
  });

  test('git without version', () => {
    expect(resolveInstalledVersion(makePkg({type: 'git'}))).toBe('git');
  });

  test('local without version', () => {
    expect(resolveInstalledVersion(makePkg({type: 'local'}))).toBe('local');
  });

  test('unknown type falls back', () => {
    const ver = resolveInstalledVersion(
      makePkg({type: 'npm', name: 'nonexistent-pkg-xyz-123'}),
    );
    expect(ver).toBe('?');
  });
});

// ── Filter logic ────────────────────────────────────────────────────────────

describe('filterPkgs', () => {
  function filter(pkgs: Package[], query: string): Package[] {
    if (!query) {
      return pkgs;
    }

    const f = query.toLowerCase();
    return pkgs.filter(
      (p) =>
        p.name.toLowerCase().includes(f) || p.source.toLowerCase().includes(f),
    );
  }

  test('empty filter returns all', () => {
    const pkgs = [makePkg({name: 'foo'})];
    expect(filter(pkgs, '').length).toBe(1);
  });

  test('matches name', () => {
    const pkgs = [
      makePkg({name: 'foo', source: 'npm:foo'}),
      makePkg({name: 'bar', source: 'npm:bar'}),
    ];
    expect(filter(pkgs, 'oo').length).toBe(1);
    expect(filter(pkgs, 'bar').length).toBe(1);
  });

  test('case insensitive', () => {
    const pkgs = [makePkg({name: 'FooBar'})];
    expect(filter(pkgs, 'foobar').length).toBe(1);
  });

  test('no match', () => {
    const pkgs = [makePkg({name: 'foo'})];
    expect(filter(pkgs, 'xyz').length).toBe(0);
  });

  test('matches source', () => {
    const pkgs = [makePkg({name: 'foo', source: 'npm:bar'})];
    expect(filter(pkgs, 'bar').length).toBe(1);
  });
});

// ── Build installed items ───────────────────────────────────────────────────

describe('buildInstalledItems', () => {
  function buildItems(
    pkgs: Package[],
  ): Array<{label: string; description: string}> {
    return pkgs.map((p) => {
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

      return {label: `${icon} ${p.name}`, description: desc};
    });
  }

  test('npm with update', () => {
    const items = buildItems([
      makePkg({
        name: 'foo',
        type: 'npm',
        hasUpdate: true,
        latestVersion: '2.0.0',
      }),
    ]);
    expect(items[0].label).toBe('⬆ foo');
  });

  test('npm without update', () => {
    const items = buildItems([
      makePkg({name: 'bar', type: 'npm', hasUpdate: false}),
    ]);
    expect(items[0].label).toBe('📦 bar');
  });

  test('git with update', () => {
    const items = buildItems([
      makePkg({
        name: 'g',
        type: 'git',
        version: 'v1',
        hasUpdate: true,
        latestVersion: 'v2',
      }),
    ]);
    expect(items[0].label).toBe('⬆ g');
    expect(items[0].description).toBe('v1 → v2 — git');
  });

  test('local package', () => {
    const items = buildItems([makePkg({name: 'p', type: 'local'})]);
    expect(items[0].label).toBe('📁 p');
  });

  test('hasUpdates detection', () => {
    const pkgs = [
      makePkg({hasUpdate: false}),
      makePkg({hasUpdate: true}),
      makePkg({hasUpdate: false}),
    ];
    expect(pkgs.some((p) => p.hasUpdate)).toBe(true);
  });

  test('no updates', () => {
    const pkgs = [makePkg({hasUpdate: false})];
    expect(pkgs.some((p) => p.hasUpdate)).toBe(false);
  });
});

// ── Search URL ──────────────────────────────────────────────────────────────

describe('searchCatalog URL', () => {
  function buildUrl(query: string): string {
    const trimmed = query.trim();
    const q = trimmed
      ? `keywords:pi-package+${encodeURIComponent(trimmed)}`
      : 'keywords:pi-package';
    return `https://registry.npmjs.org/-/v1/search?text=${q}&size=20`;
  }

  test('empty query searches pi-package keyword', () => {
    expect(buildUrl('')).toContain('keywords:pi-package');
  });

  test('with query adds search term', () => {
    expect(buildUrl('test')).toContain('pi-package+test');
  });

  test('trims whitespace', () => {
    expect(buildUrl('  hello  ')).toContain('pi-package+hello');
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePkg(overrides: Partial<Package> = {}): Package {
  return {
    source: overrides.source ?? 'npm:test',
    type: overrides.type ?? 'npm',
    name: overrides.name ?? 'test-pkg',
    version: overrides.version,
    hasUpdate: overrides.hasUpdate,
    latestVersion: overrides.latestVersion,
  };
}
