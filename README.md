# pi-plugin-manager

<p align="center">
  <em>Browse, install, and remove Pi plugins — without leaving the terminal.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/github/stars/wyattferguson/pi-plugin-manager?style=flat-square&color=111111&label=stars" alt="Stars">
  <img src="https://img.shields.io/github/v/release/wyattferguson/pi-plugin-manager?style=flat-square&color=111111&label=release" alt="Release">
</p>

A TUI for managing Pi plugins — see what's installed, search the catalog, install and remove packages, and bulk-update everything that's out of date. All from one screen, all with keyboard shortcuts.

<p align="center">
  <img src="assets/installed-screenshot.png" alt="Installed tab" width="600">
</p>

<p align="center">
  <img src="assets/search-screenshot.png" alt="Search tab" width="600">
</p>

## Install

```bash
pi install npm:pi-plugin-manager
```

That's it. No config files, no API keys.

## Why this exists

Pi has a growing ecosystem of extensions, skills, and themes — everything from web search and subagent delegation to custom providers and status bars. But managing them has meant juggling `pi install`, `pi remove`, `pi list`, and `pi check-updates` commands across separate terminal sessions.

This puts it all in one place. A single TUI that shows your installed plugins, checks for updates, lets you search the catalog, and handles installs and removals — all with keyboard shortcuts, no context-switching.

## What you can do

| Want                              | How                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| See every plugin you've installed | Open the Installed tab — name, version, description, and type (📦 npm, 🔀 git, 📁 local) at a glance              |
| Check for updates                 | Installed tab shows 🔄 on outdated packages and the version bump (`1.2.3 → 2.0.0`)                                |
| Update everything outdated        | One key — `u` — updates all outdated npm packages in sequence                                                     |
| Search the package catalog        | Switch to Search tab, type to find plugins on npm tagged with `pi-package`                                        |
| Install something                 | Search results show name, version, and description. Hit Enter to see details, then Enter again to install         |
| Remove a plugin                   | Arrow to it, press `r`, confirm with `y`. Done                                                                    |
| See what a package is about       | `i` on any installed package opens a details panel with description, author, license, downloads, and publish date |
| Pin a specific version            | Pick an exact version before installing instead of grabbing `latest`                                              |

## Usage

Open the manager with:

```bash
/plugins
```

### Keyboard reference

| Key                 | Action                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `↑` `↓`             | Navigate the list                                                    |
| `Tab`               | Switch between Installed and Search tabs                             |
| `Enter`             | Open details / confirm install (search) / confirm remove (installed) |
| `r` / `Delete`      | Remove the selected package                                          |
| `u`                 | Update all outdated packages                                         |
| `i`                 | Show package details                                                 |
| `v`                 | Pick a specific version (before install)                             |
| `PageUp` `PageDown` | Jump 20 items at a time                                              |
| `Escape`            | Go back / close the manager                                          |
| `y` `n`             | Confirm or cancel an action                                          |

## What about updates after install?

The Installed tab checks npm for newer versions when it opens. Packages with updates show a 🔄 icon and the version bump. Press `u` to update everything — it installs `npm:name@latest` for each outdated package individually (which means pinned versions stay pinned).

## License

[MIT license](https://github.com/wyattferguson/pi-plugin-manager/blob/master/LICENSE)

## Contact + Support

Created by [Wyatt Ferguson](https://github.com/wyattferguson)

For any questions or comments heres how you can reach me:

**:octopus: Follow me on [Github @wyattferguson](https://github.com/wyattferguson)**

**:mailbox_with_mail: Email me at [wyattxdev@duck.com](wyattxdev@duck.com)**

**:tropical_drink: Follow on [BlueSky @wyattf](https://wyattf.bsky.social)**

If you find this useful and want to tip me a little coffee money:

**:coffee: [Buy Me A Coffee](https://www.buymeacoffee.com/wyattferguson)**
