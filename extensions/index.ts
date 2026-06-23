/**
 Pi-plugin-manager — Plugin manager entry point.

 Registers the `/plugins` command and wires up the ManagerUI component
 with Pi's TUI lifecycle.

 @module pi-plugin-manager
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPackages, checkNpmUpdates, checkGitUpdates } from "./packages";
import { ManagerUI } from "./ui";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("plugins", {
    description: "Open the Pi plugin manager",
    async handler(_args, ctx) {
      const pkgs = loadPackages();
      const screenHeight = (process.stdout as { rows?: number }).rows ?? 30;
      const ui = new ManagerUI(pkgs, screenHeight);

      // Background update checks — refresh UI when done
      Promise.all([checkNpmUpdates(pkgs), checkGitUpdates(pkgs)])
        .then(() => {
          ui.finishCheckingVersions();
        })
        .catch(() => {
          ui.finishCheckingVersions();
        });

      // Clear screen so TUI takes up the full terminal
      process.stdout.write("\u{1B}[2J\u{1B}[H");

      await ctx.ui.custom((tui, theme, _kb, done) => {
        ui.setTheme(theme);
        ui.setRequestRender(() => {
          tui.requestRender();
        });
        ui.onClose = () => {
          done(undefined);

          if (ui.changed) {
            process.stdout.write("\u{1B}[2J\u{1B}[H");
            process.stdout.write(
              "\u{1B}[33m⚠  Changes made — run /reload to activate new plugins\u{1B}[0m\n",
            );
          }
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
    },
  });
}
