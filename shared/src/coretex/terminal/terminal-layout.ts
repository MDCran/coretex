/**
 * Full-page Terminal is an exclusive app surface: the workspace shell stays out
 * of the render tree until the Terminal is docked again or closed.
 */
export function isTerminalExclusive(
  dockOpen: boolean,
  fullscreen: boolean,
): boolean {
  return dockOpen && fullscreen;
}
