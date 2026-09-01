export interface ContainerActionState {
  primaryAction: "start" | "unpause" | null;
  primaryLabel: "Start" | "Resume" | null;
  canStop: boolean;
  canRestart: boolean;
  canRemove: boolean;
}

const NONE: ContainerActionState = {
  primaryAction: null,
  primaryLabel: null,
  canStop: false,
  canRestart: false,
  canRemove: false,
};

/**
 * Fail-closed Docker lifecycle rules shared by visible controls, context menus,
 * and acceptance tests. Unknown/transitional engine states expose no actions.
 */
export function getContainerActionState(state: string): ContainerActionState {
  switch (state.toLowerCase()) {
    case "running":
      return {
        primaryAction: null,
        primaryLabel: null,
        canStop: true,
        canRestart: true,
        canRemove: false,
      };
    case "paused":
      return {
        primaryAction: "unpause",
        primaryLabel: "Resume",
        canStop: false,
        canRestart: false,
        canRemove: false,
      };
    case "restarting":
      return {
        primaryAction: null,
        primaryLabel: null,
        canStop: true,
        canRestart: false,
        canRemove: false,
      };
    case "dead":
      return {
        primaryAction: null,
        primaryLabel: null,
        canStop: false,
        canRestart: false,
        canRemove: true,
      };
    case "created":
    case "exited":
      return {
        primaryAction: "start",
        primaryLabel: "Start",
        canStop: false,
        canRestart: false,
        canRemove: true,
      };
    default:
      return NONE;
  }
}
