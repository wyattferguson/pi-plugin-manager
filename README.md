# pi-manager

Plugin manager TUI for the [Pi coding agent harness](https://pi.dev).

## Features

- **List** all installed Pi plugins with version info and update indicators
- **Install** plugins from the Pi package catalog (npm registry search)
- **Remove** installed plugins
- **Update** all outdated plugins at once (`u` key)
- **Search** the Pi package catalog by keyword — defaults to popular packages
- **Footer progress** during install, remove, update, and search operations
- **Two-tab TUI** — Installed (browse/remove) and Search (find/install)

## Usage

Install globally:

```bash
pi install npm:pi-manager
```

Or locally in a project:

```bash
pi install -l npm:pi-manager
```

Then type `/manage` in Pi to open the manager.

### Keybindings

**Installed tab**

- `↑↓` — Navigate list
- `Enter / r / Del` — Remove selected (with confirmation)
- `u` — Update all packages (with confirmation)
- `U` — Update selected package (with confirmation)
- `i` — Show package details
- `Type` — Filter packages by name
- `/` — Jump to search tab
- `Tab` — Switch to search
- `Esc` — Back to list / Close manager

**Search tab**

- `↑↓` — Navigate results
- `Enter` — Install selected package
- `v` — Choose version to install
- `Type` — Search npm registry
- `Tab` — Switch to installed
- `Esc` — Back / Close

## Contributing

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Pi](https://pi.dev) (for integration testing)

### Setup

```bash
git clone https://github.com/wyattferguson/pi-manager.git
cd pi-manager
bun install
```

### Development workflow

- **`bun test`** — Run 31 unit tests
- **`bun run lint`** — Lint with xo (strict rules)
- **`bun run typecheck`** — TypeScript type checking
- **`bun run build`** — Full CI pipeline (typecheck → lint → test)

### Project structure

```text
pi-manager/
├── extensions/
│   ├── index.ts          # ManagerUI component + /manage command
│   ├── packages.ts       # Package utilities (load, parse, version checks, CLI ops)
│   └── types.ts          # Shared TypeScript types
├── types/
│   └── pi.d.ts           # Type stubs for Pi's runtime APIs
├── tests/
│   └── packages.test.ts  # Unit tests (bun:test)
├── skills/
│   └── manage/SKILL.md   # Agent skill description
├── package.json
├── tsconfig.json
├── .npmignore
└── README.md
```

### Code conventions

- **Single quotes**, semicolons, 2-space indentation (enforced by xo + prettier)
- **TypeScript strict mode** — `tsc --noEmit` must pass
- **Private fields** use ES2022 `#method()` syntax for true encapsulation
- **Theme-safe rendering** — all `theme.fg()/bg()/bold()` calls use `?.` guards
- **Error boundaries** — `render()`, `handleInput()`, and footer ops are wrapped in try/catch

### Testing

Tests use [Bun's test runner](https://bun.sh/docs/test). To add a new test:

1. Create `tests/<feature>.test.ts`
2. Import `describe`, `expect`, `test` from `bun:test`
3. Add the `eslint-disable` comment block at the top (bun:test types aren't resolvable by xo)

### Submitting changes

1. Fork the repo and create a feature branch
2. Make changes — `bun run build` must pass
3. Test manually in Pi: `pi -e ./extensions/index.ts`, then `/manage`
4. Submit a PR with a clear description

### Roadmap

- [x] **Git package support** — full install/remove/update for git-sourced packages
- [x] **Individual update** — `U` key updates one selected package
- [x] **Package details view** — `i` key shows description, author, homepage
- [x] **Keyboard shortcuts** — `r` remove, `/` search, `v` versions, `i` info
- [x] **Filter installed packages** — type to filter in installed tab
- [x] **Confirmation dialog** — y/n confirm before remove, update
- [x] **Version picker** — `v` on search tab to choose install version
- [ ] **Package health indicators** — show download count, last publish date, stars
- [ ] **Color themes** — respect Pi's dark/light theme for better accessibility
- [ ] **Export/import** — export installed package list for sharing
- [ ] **Keyboard-only navigation hints** — show available keys in a footer bar
- [ ] **Auto-refresh** — refresh update status periodically while manager is open
- [ ] **Install from git URL** — paste a git URL directly to install

## License

[MIT license](https://github.com/wyattferguson/pi-manager/blob/master/LICENSE)

## Contact + Support

Created by [Wyatt Ferguson](https://github.com/wyattferguson)

For any questions or comments heres how you can reach me:

### :octocat: Follow me on [Github @wyattferguson](https://github.com/wyattferguson)

### :mailbox_with_mail: Email me at [wyattxdev@duck.com](wyattxdev@duck.com)

### :tropical_drink: Follow on [BlueSky @wyattf](https://wyattf.bsky.social)

If you find this useful and want to tip me a little coffee money:

### :coffee: [Buy Me A Coffee](https://www.buymeacoffee.com/wyattferguson)
