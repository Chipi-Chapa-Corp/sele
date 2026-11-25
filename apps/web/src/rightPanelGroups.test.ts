import { describe, expect, it } from "vite-plus/test";

import { resolveGroupSurface, rightPanelGroupOf } from "./rightPanelGroups";
import type { RightPanelSurface } from "./rightPanelStore";

const diff: RightPanelSurface = { id: "diff", kind: "diff" };
const prs: RightPanelSurface = { id: "pull-requests", kind: "pull-requests" };
const files: RightPanelSurface = { id: "files", kind: "files" };

describe("rightPanelGroups", () => {
  it("groups diff and pull requests under git, apart from files", () => {
    expect(rightPanelGroupOf(diff)).toBe("git");
    expect(rightPanelGroupOf(prs)).toBe("git");
    expect(rightPanelGroupOf(files)).toBe("files");
  });

  it("returns to the last focused surface of a group, else its first", () => {
    const surfaces = [diff, files, prs];
    expect(resolveGroupSurface(surfaces, "git", "pull-requests")).toBe(prs);
    expect(resolveGroupSurface(surfaces, "git", "closed")).toBe(diff);
    expect(resolveGroupSurface(surfaces, "terminal", undefined)).toBeNull();
  });
});
