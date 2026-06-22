# pi-manager

Plugin manager TUI for the [Pi coding agent harness](https://pi.dev).

## Features

- **List** all installed Pi plugins with version info
- **Install** plugins from the Pi package catalog (npm registry)
- **Remove** installed plugins
- **Update** all outdated plugins at once
- **Search** the Pi package catalog by keyword

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

| Key | Installed tab | Search tab |
|-----|--------------|------------|
| ↑↓ | Navigate | Navigate |
| Enter | Remove selected | Install selected |
| u | Update all | — |
| Tab | Switch to Search | Switch to Installed |
| Esc | Close | Close |

## Structure

```
pi-manager/
├── package.json
├── extensions/
│   └── index.ts        # Extension: /manage command + TUI
└── skills/
    └── manage/
        └── SKILL.md    # Skill description for agent loading
```

## License

MIT
