import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ThreadPreviewState } from "../../previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { act, render } from "../../../test/render";
import { useRightPanelActions } from "./useRightPanelActions";

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));

const EMPTY_PREVIEW_STATE: ThreadPreviewState = {
  snapshot: null,
  sessions: {},
  suppressedTabIds: new Set<string>(),
  activeTabId: null,
  desktopOverlay: null,
  desktopByTabId: {},
  recentlySeenUrls: [],
  listLoaded: false,
  serverEpoch: null,
  serverRevision: 0,
};

const THREAD_REF = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

type Actions = ReturnType<typeof useRightPanelActions>;

async function mountActions(overrides: Partial<Parameters<typeof useRightPanelActions>[0]> = {}) {
  let actions!: Actions;
  const Harness = () => {
    actions = useRightPanelActions({
      activeThreadRef: THREAD_REF,
      activeProject: {
        environmentId: THREAD_REF.environmentId,
        id: ProjectId.make("project-1"),
        title: "Repo",
        workspaceRoot: "/repo",
      } as unknown as Parameters<typeof useRightPanelActions>[0]["activeProject"],
      activeRightPanelSurface: null,
      activePreviewState: EMPTY_PREVIEW_STATE,
      deviceState: {
        hosts: [],
        devices: [],
        onboardingCompleted: true,
        hostStatus: "ready",
      } as unknown as Parameters<typeof useRightPanelActions>[0]["deviceState"],
      deviceStateLoaded: true,
      pullRequestPanelTarget: null,
      threadPanelPresentation: "inline",
      isServerThread: true,
      embedded: false,
      diffAvailable: true,
      browserAvailable: false,
      canOperatePreview: false,
      diffOpen: false,
      previewPanelOpen: false,
      rightPanelOpen: false,
      canMaximizeRightPanel: false,
      rightPanelMaximized: false,
      supportsPullRequests: false,
      pullRequestsSurfaceAvailable: false,
      gitCwd: "/repo",
      activeProjectCwd: "/repo",
      onDiffPanelOpen: undefined,
      closeRightPanelSurface: () => {},
      ...overrides,
    });
    return null;
  };
  const screen = await render(<Harness />);
  return {
    get actions() {
      return actions;
    },
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

describe("useRightPanelActions.toggleRightPanel", () => {
  it("opens the git diff pane by default when the right panel has no surfaces", async () => {
    useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
    const onDiffPanelOpen = vi.fn();
    await using harness = await mountActions({ onDiffPanelOpen });

    await act(() => harness.actions.toggleRightPanelStable());

    const state = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(state.isOpen).toBe(true);
    expect(state.activeSurfaceId).toBe("diff");
    expect(state.surfaces).toEqual([{ id: "diff", kind: "diff" }]);
    expect(onDiffPanelOpen).toHaveBeenCalledTimes(1);
  });

  it("restores the existing active surface instead of switching to git when reopening", async () => {
    useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
    useRightPanelStore.getState().open(THREAD_REF, "files");
    useRightPanelStore.getState().close(THREAD_REF);
    const onDiffPanelOpen = vi.fn();
    await using harness = await mountActions({ onDiffPanelOpen });

    await act(() => harness.actions.toggleRightPanelStable());

    const state = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(state.isOpen).toBe(true);
    expect(state.activeSurfaceId).toBe("files");
    expect(onDiffPanelOpen).not.toHaveBeenCalled();
  });

  it("opens the empty panel when diff is unavailable", async () => {
    useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
    await using harness = await mountActions({ diffAvailable: false });

    await act(() => harness.actions.toggleRightPanelStable());

    const state = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(state.isOpen).toBe(true);
    expect(state.activeSurfaceId).toBeNull();
    expect(state.surfaces).toEqual([]);
  });
});
