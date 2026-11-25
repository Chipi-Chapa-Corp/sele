import type { RightPanelKind, RightPanelSurface } from "./rightPanelStore";

export const RIGHT_PANEL_GROUPS = [
  "git",
  "files",
  "terminal",
  "browser",
  "device",
  "chats",
] as const;
export type RightPanelGroup = (typeof RIGHT_PANEL_GROUPS)[number];

const GROUP_BY_KIND: Record<RightPanelKind, RightPanelGroup> = {
  diff: "git",
  "pull-request": "git",
  "pull-requests": "git",
  issue: "git",
  files: "files",
  file: "files",
  terminal: "terminal",
  preview: "browser",
  device: "device",
  thread: "chats",
  "linked-thread": "chats",
};

export function rightPanelGroupOf(surface: Pick<RightPanelSurface, "kind">): RightPanelGroup {
  return GROUP_BY_KIND[surface.kind];
}

/** The surface a group button returns to: the one last focused in it, else its first. */
export function resolveGroupSurface(
  surfaces: readonly RightPanelSurface[],
  group: RightPanelGroup,
  lastSurfaceId: string | undefined,
): RightPanelSurface | null {
  const members = surfaces.filter((surface) => rightPanelGroupOf(surface) === group);
  return members.find((surface) => surface.id === lastSurfaceId) ?? members[0] ?? null;
}
