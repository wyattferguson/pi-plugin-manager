# pi-plugin-manager

<p align="center">
  <em>Browse, install, and remove Pi plugins — without leaving the terminal.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/github/stars/wyattferguson/pi-plugin-manager?style=flat-square&color=111111&label=stars" alt="Stars">
  <img src="https://img.shields.io/github/v/release/wyattferguson/pi-plugin-manager?style=flat-square&color=111111&label=release" alt="Release">
</p>

A terminal UI for managing Pi plugins — browse what's installed, search the catalog, install/remove/update, all without leaving the terminal.

<p align="center">
  <img src="assets/installed-screenshot.png" alt="Installed tab" width="600">
</p>

<p align="center">
  <img src="assets/search-screenshot.png" alt="Search tab" width="600">
</p>

- **Browse / Install / Remove Plugins** — See and manage all your plugins from one place
- **Search catalog** — Find and install plugins from Pi Package Catalog
- **Update all** — One key (`u`) updates every outdated package
- **Package details** — (`i`) shows description, author, downloads, publish date
- **Version picker** — (`v`) pick specific plugin versions for maximum compatibility

## Usage

Install command:

```bash
pi install npm:pi-plugin-manager
```

Run in Pi with:

```bash
/plugins
```

## Keybindings

**Installed tab**

| Key                   | Action                         |
| --------------------- | ------------------------------ |
| `↑↓`                  | Navigate list                  |
| `PgUp` / `PgDn`       | Page up / down                 |
| `Enter` / `r` / `Del` | Remove selected (with confirm) |
| `u`                   | Update all packages            |
| `i`                   | Show package details           |
| `Tab`                 | Switch to search               |
| `Esc`                 | Back / Close                   |

**Search tab**

| Key           | Action                    |
| ------------- | ------------------------- |
| `↑↓`          | Navigate results          |
| `PgUp`/`PgDn` | Page up / down            |
| `Enter`       | Install selected          |
| `v`           | Choose version to install |
| `i`           | Show package details      |
| Type          | Search catalog            |
| `Tab`         | Switch to installed       |
| `Esc`         | Back / Close              |

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
