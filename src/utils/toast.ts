import type { PluginInput } from '@opencode-ai/plugin';

/**
 * Show a toast notification in the OpenCode TUI.
 */
export function showToast(
  ctx: PluginInput,
  title: string,
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  duration = 3000,
): void {
  ctx.client.tui
    .showToast({
      body: { title, message, variant, duration },
    })
    .catch(() => {});
}
