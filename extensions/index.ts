/**
 Pi-plugin-manager — Plugin manager entry point.

 Registers the `/manage` command and wires up the ManagerUI component
 with Pi's TUI lifecycle.

 @module pi-plugin-manager
 */

import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {loadPackages, checkNpmUpdates, checkGitUpdates} from './packages';
import {ManagerUI} from './ui';

export default function (pi: ExtensionAPI) {
  pi.registerCommand('manage', {
    description: 'Open the Pi plugin manager',
    async handler(_args, ctx) {
      const pkgs = loadPackages();
      const ui = new ManagerUI(pkgs);

      // Background update checks — refresh UI when done
      Promise.all([checkNpmUpdates(pkgs), checkGitUpdates(pkgs)])
        .then(() => {
          ui.finishCheckingVersions();
        })
        .catch(() => {
          ui.finishCheckingVersions();
        });

      await ctx.ui.custom((tui, theme, _kb, done) => {
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
    },
  });
}
