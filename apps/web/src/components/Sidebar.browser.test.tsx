import appCss from "../index.css?inline";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as shelfHooks from "../state/olderSettledShelf";
import { createWorkspaceFocusController, workspaceAreaProps } from "../lib/workspaceFocus";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type LocalApi,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { useNowMinute } from "../hooks/useNowMinute";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useProjects, useServerConfigs, useQuietThreadShells } from "../state/entities";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../state/environments";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { readLocalApi } from "../localApi";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS } from "./Sidebar.logic";
import { SortableThreadRow } from "./sidebar/SidebarThreadRow";
import { SidebarProvider } from "./ui/sidebar";

vi.mock(import("../state/olderSettledShelf"), async (original) => {
  const actual = await original();
  return { ...actual, useOlderSettledShelf: vi.fn(actual.useOlderSettledShelf) };
});
vi.mock("../state/entities", { spy: true });
vi.mock("../state/environments", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useScratchProject", { spy: true });
vi.mock("../hooks/useNowMinute", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("./sidebar/SidebarThreadRow", { spy: true });
vi.mock("../state/session", { spy: true });
vi.mock("../state/use-orchestration-command", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  // The desktop defaults: holding Mod alone already matches a thread jump.
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+1", command: "thread.jump.1" },
    { key: "mod+2", command: "thread.jump.2" },
    { key: "mod+shift+[", command: "thread.previous" },
  ]);
  return { ...(await original()), primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it("starts a no-project chat when pressing New thread with no opened chat and never opens the picker", async () => {
    const projects = [project("active"), project("idle")];
    const startThread = vi.fn().mockResolvedValue(null);
    const startScratchThread = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: scopeProjectRef(projects[0]!.environmentId, projects[0]!.id),
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(useScratchProject).mockReturnValue({
      scratchWorkspaceRootFor: () => "/scratch",
      scratchEnvironmentId: () => EnvironmentId.make("local"),
      openScratchProject: vi.fn().mockResolvedValue(null),
      startScratchThread,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }));

    expect(openCommandPalette).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    expect(startScratchThread).toHaveBeenCalledExactlyOnceWith(EnvironmentId.make("local"));
  });

  it("starts in the opened chat's project on New thread, while No project chat skips the project", async () => {
    const activeProject = project("active");
    const idleProject = project("idle");
    const openThread = makeThreadFixture({
      environmentId: activeProject.environmentId,
      projectId: activeProject.id,
      id: ThreadId.make("open-thread"),
    });
    const startThread = vi.fn().mockResolvedValue(null);
    const startScratchThread = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useProjects).mockReturnValue([activeProject, idleProject]);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: openThread,
      defaultProjectRef: scopeProjectRef(idleProject.environmentId, idleProject.id),
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: scopeThreadRef(openThread.environmentId, openThread.id),
    });
    vi.mocked(useScratchProject).mockReturnValue({
      scratchWorkspaceRootFor: () => "/scratch",
      scratchEnvironmentId: () => EnvironmentId.make("local"),
      openScratchProject: vi.fn().mockResolvedValue(null),
      startScratchThread,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }));
    expect(openCommandPalette).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenCalledExactlyOnceWith(
      scopeProjectRef(activeProject.environmentId, activeProject.id),
    );
    expect(startScratchThread).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "New chat without project", exact: true }),
    );
    expect(startScratchThread).toHaveBeenCalledExactlyOnceWith(EnvironmentId.make("local"));
  });

  it("renders settings and usage on the left and search, no-project chat, and new thread on the right", async () => {
    vi.mocked(useProjects).mockReturnValue([project("active")]);
    vi.mocked(useScratchProject).mockReturnValue({
      scratchWorkspaceRootFor: () => "/scratch",
      scratchEnvironmentId: () => EnvironmentId.make("local"),
      openScratchProject: vi.fn().mockResolvedValue(null),
      startScratchThread: vi.fn().mockResolvedValue(undefined),
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const settingsButton = screen.getByRole("button", { name: "Settings", exact: true });
    const usageButton = screen.getByRole("button", { name: "Usage", exact: true });
    const searchButton = screen.getByRole("button", { name: "Search threads" });
    const noProjectButton = screen.getByRole("button", {
      name: "New chat without project",
      exact: true,
    });
    const newThreadButton = screen.getByRole("button", { name: "New thread", exact: true });
    expect(settingsButton).toBeVisible();
    expect(usageButton).toBeVisible();
    expect(searchButton).toBeVisible();
    expect(noProjectButton).toBeVisible();
    expect(newThreadButton).toBeVisible();

    const orderedLabels = Array.from(
      screen.container.querySelectorAll("button[aria-label]"),
      (button) => button.getAttribute("aria-label"),
    ).filter((label) =>
      ["Settings", "Usage", "Search threads", "New chat without project", "New thread"].includes(
        label ?? "",
      ),
    );
    expect(orderedLabels).toEqual([
      "Settings",
      "Usage",
      "Search threads",
      "New chat without project",
      "New thread",
    ]);

    expect(screen.getByRole("button", { name: "Projects", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "T3 Code home" })).not.toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="footer"]')).toBeNull();

    const searchPanel = document.querySelector("[data-sidebar-search-panel]");
    expect(searchPanel).toHaveAttribute("data-open", "false");

    await userEvent.click(searchButton);
    expect(searchPanel).toHaveAttribute("data-open", "true");
    await expect.element(screen.getByRole("combobox", { name: "Search threads" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(searchPanel).toHaveAttribute("data-open", "false");
  });
});

// regression: #41549 a grouped project's folder New thread went to the primary copy
describe("sidebar project folder new thread", () => {
  it("starts in the copy of the viewed thread, as the new-thread shortcut does", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
    const primary = EnvironmentId.make("local");
    const dev1 = EnvironmentId.make("dev1");
    const repositoryIdentity = {
      canonicalKey: "github.com/acme/demo-repo",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/demo-repo.git",
      },
      displayName: "acme/demo-repo",
    };
    const primaryCopy = { ...project("demo-primary"), repositoryIdentity };
    const dev1Copy = {
      ...project("demo-dev1"),
      environmentId: dev1,
      repositoryIdentity,
    };
    vi.mocked(usePrimaryEnvironmentId).mockReturnValue(primary);
    vi.mocked(useConnectedEnvironmentIds).mockReturnValue([primary, dev1]);
    vi.mocked(useProjects).mockReturnValue([primaryCopy, dev1Copy]);
    const dev1Thread = makeThreadFixture({
      environmentId: dev1,
      id: ThreadId.make("dev1-thread"),
      projectId: dev1Copy.id,
      title: "dev1 work",
    });
    vi.mocked(useQuietThreadShells).mockReturnValue([dev1Thread]);
    const threadRef = scopeThreadRef(dev1, dev1Thread.id);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
    const dev1ProjectRef = scopeProjectRef(dev1, dev1Copy.id);
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: dev1Thread,
      defaultProjectRef: dev1ProjectRef,
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: threadRef,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "New thread in acme/demo-repo" }));

    expect(startThread).toHaveBeenCalledExactlyOnceWith(dev1ProjectRef);
  });
});

// regression: #38623 unsent drafts are listed above threads but mod+1..9 skipped them
describe("sidebar numbered jumps", () => {
  it("numbers the unsent draft at the top before the threads below it", async () => {
    const initial = useComposerDraftStore.getState();
    using stack = new DisposableStack();
    stack.defer(() => useComposerDraftStore.setState(initial, true));
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const web = project("web");
    vi.mocked(useProjects).mockReturnValue([web]);
    const thread = threadShell(web.id, 0);
    vi.mocked(useQuietThreadShells).mockReturnValue([thread]);
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: threadRef,
    });
    const draftId = DraftId.make("unsent-draft");
    initial.setProjectDraftThreadId(scopeProjectRef(web.environmentId, web.id), draftId, {
      threadId: ThreadId.make("unsent-draft-thread"),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    initial.setPrompt(draftId, "Unsent prompt");

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const draftRow = screen.getByTestId("sidebar-draft-row");
    await expect.element(draftRow).toBeInTheDocument();
    await expect.element(screen.getByText("Thread 0").first()).toBeInTheDocument();
    await userEvent.keyboard("{Control>}");
    await expect.element(screen.getByText("Ctrl+1")).toBeVisible();
    await expect.element(draftRow.getByText("Ctrl+1")).toBeVisible();
    await expect.element(screen.getByText("Ctrl+2")).toBeVisible();
    await userEvent.keyboard("{/Control}");

    // Previous thread from the open thread steps up to the draft above it.
    await userEvent.keyboard("{Control>}{Shift>}{BracketLeft}{/Shift}{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).toBe(`/draft/${draftId}`),
    );
    await userEvent.keyboard("{Control>}2{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).not.toBe(`/draft/${draftId}`),
    );
    await userEvent.keyboard("{Control>}1{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).toBe(`/draft/${draftId}`),
    );
  });
});

function threadShell(projectId: ProjectId, index: number): EnvironmentThreadShell {
  return makeThreadFixture({
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make(`thread-${index}`),
    projectId,
    title: `Thread ${index}`,
  });
}

describe("sidebar render isolation", () => {
  // regression: #33100 Cmd+J re-rendered every sidebar row, which took hundreds of ms with many threads
  it("does not re-render thread rows when a quick Mod shortcut opens and focuses the terminal", async () => {
    using stack = new DisposableStack();
    const activeProject = project("active");
    const threads = Array.from({ length: 5 }, (_, index) => threadShell(activeProject.id, index));
    const routeThreadRef: ScopedThreadRef = {
      environmentId: activeProject.environmentId,
      threadId: threads[0]!.id,
    };
    threads.unshift(threadShell(activeProject.id, 100));
    // A real wall-clock minute tick mid-test re-renders every row and reads as a leak.
    vi.mocked(useNowMinute).mockReturnValue("2026-01-01T00:00");
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef,
    });
    const terminal = document.createElement("div");
    terminal.dataset.terminalOwner = "drawer";
    const terminalInput = document.createElement("textarea");
    terminal.append(terminalInput);
    document.body.append(terminal);
    stack.defer(() => terminal.remove());
    stack.defer(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, false));
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("Thread 4").first()).toBeInTheDocument();
    const rowRenders = () => vi.mocked(SortableThreadRow).mock.calls.length;

    using _timers = fakeTimers();
    const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    const beforeShortcut = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, true));
    await act(() => terminalInput.focus());
    await userEvent.keyboard(`{/${modifier}}`);
    await act(() => terminalInput.blur());
    expect(
      rowRenders() - beforeShortcut,
      "thread rows re-rendered while opening the terminal with a quick Mod shortcut",
    ).toBe(0);

    const jumpLabelsSince = (start: number) =>
      vi
        .mocked(SortableThreadRow)
        .mock.calls.slice(start)
        .map(([props]) => props.jumpLabel)
        .filter((label) => label !== null);
    const beforeHold = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
    expect(jumpLabelsSince(beforeHold), "holding Mod showed no jump hints").toHaveLength(2);
    const beforeRelease = rowRenders();
    await userEvent.keyboard(`{/${modifier}}`);
    expect(rowRenders()).toBeGreaterThan(beforeRelease);
    expect(jumpLabelsSince(beforeRelease)).toEqual([]);
  });
});

describe("sidebar thread rename", () => {
  // regression: #35151 an untouched rename wrote back the title it opened with over a newer one
  it.each(["{Enter}", "{Tab}"])(
    "ending an untouched rename with %s keeps a title that arrived while it was open",
    async (finish) => {
      const activeProject = project("active");
      const routeThreadRef: ScopedThreadRef = {
        environmentId: activeProject.environmentId,
        threadId: ThreadId.make("thread-0"),
      };
      const shellTitled = (title: string) => ({ ...threadShell(activeProject.id, 0), title });
      const updateMetadata = vi.fn().mockResolvedValue({ _tag: "Success" });
      vi.mocked(useOrchestrationCommand).mockReturnValue(updateMetadata);
      vi.mocked(readEnvironmentScope).mockReturnValue(true);
      vi.mocked(useEnvironmentScope).mockReturnValue(true);
      vi.mocked(useProjects).mockReturnValue([activeProject]);
      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Fix the login redirect")]);
      vi.mocked(useThreadRouteTarget).mockReturnValue({
        kind: "server",
        threadRef: routeThreadRef,
      });
      vi.mocked(useHandleNewThread).mockReturnValue({
        activeDraftThread: null,
        activeThread: null,
        defaultProjectRef: {
          environmentId: activeProject.environmentId,
          projectId: activeProject.id,
        },
        defaultProjectFallbackReady: true,
        handleNewThread: vi.fn().mockResolvedValue(null),
        routeDraftId: null,
        routeThreadRef,
      });
      const tree = () => (
        <SidebarProvider>
          <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
        </SidebarProvider>
      );
      await using screen = await render(tree());
      await userEvent.dblClick(screen.getByText("Fix the login redirect").first());
      const input = screen.getByRole("textbox", { name: "Thread title" });
      await expect.element(input).toHaveValue("Fix the login redirect");

      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Generated title")]);
      await screen.rerender(tree());
      await userEvent.keyboard(finish);

      await expect.element(input).not.toBeInTheDocument();
      expect(updateMetadata).not.toHaveBeenCalled();
    },
  );
});

describe("sidebar thread click", () => {
  // regression: #40715 macOS counts quick clicks on different rows, so the next row got detail 2 and was ignored
  it("opens another thread when the click arrives with a double-click count", async () => {
    const activeProject = project("active");
    const threads = [threadShell(activeProject.id, 0), threadShell(activeProject.id, 1)];
    const routeThreadRef: ScopedThreadRef = {
      environmentId: activeProject.environmentId,
      threadId: threads[0]!.id,
    };
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef,
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
      { router: "/local/thread-0" },
    );
    const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);

    const openRow = screen.getByText("Thread 0").first().element();
    await act(() => {
      openRow.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }),
      );
    });
    expect(navigate).not.toHaveBeenCalled();

    const row = screen.getByText("Thread 1").first().element();
    await act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }));
    });

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ threadId: "thread-1" }) }),
    );
  });
});

describe("sidebar thread menu", () => {
  it("tells the menu whether the keyboard opened it", async () => {
    const activeProject = project("active");
    const thread = threadShell(activeProject.id, 0);
    const threadRef = { environmentId: activeProject.environmentId, threadId: thread.id };
    const show = vi.fn().mockResolvedValue(null);
    vi.mocked(readLocalApi).mockReturnValue({ contextMenu: { show } } as unknown as LocalApi);
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue([thread]);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: threadRef,
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const row = screen.getByText("Thread 0").first();
    await expect.element(row).toBeInTheDocument();
    row.element().closest<HTMLElement>("[data-sidebar-row]")!.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show.mock.lastCall?.[2]).toBe("keyboard");
    await userEvent.click(row, { button: "right" });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    expect(show.mock.lastCall?.[2]).toBe("mouse");
  });
});

describe("sidebar settled pagination", () => {
  it("keeps the viewport in place when showing more settled threads", async () => {
    using stack = new DisposableStack();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    stack.defer(() => style.remove());
    const focusController = createWorkspaceFocusController(document);
    stack.defer(() => focusController.dispose());
    let loading = false;
    const originalShelf = vi.mocked(shelfHooks.useOlderSettledShelf).getMockImplementation()!;
    using _shelf = vi.spyOn(shelfHooks, "useOlderSettledShelf").mockImplementation((input) => ({
      ...originalShelf(input),
      loading,
      retry: () => {
        loading = true;
      },
    }));
    const activeProject = project("active");
    const threads = Array.from({ length: 70 }, (_, index) =>
      makeThreadFixture({
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
        id: ThreadId.make(`settled-${index}`),
        title: `Settled thread ${index}`,
        settledOverride: "settled",
        settledAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    threads.unshift(threadShell(activeProject.id, 100));
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useServerConfigs).mockReturnValue(
      new Map([
        [
          activeProject.environmentId,
          {
            scratchWorkspaceRoot: null,
            shellThreadFamilies: false,
          } as unknown as EnvironmentServerConfig,
        ],
      ]),
    );
    await using screen = await render(
      <SidebarProvider
        {...workspaceAreaProps("sidebar", 0, "Threads")}
        style={{ height: 400, minHeight: 400 }}
      >
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const shelf = screen.container.querySelector<HTMLElement>(
      '[data-sidebar-row="shelf:settled"]',
    )!;
    if (shelf.getAttribute("aria-expanded") === "false") await act(() => shelf.click());
    const more = screen.getByRole("button", { name: "Show 25 more", exact: true });
    await expect.element(more).toBeInTheDocument();
    const moreButton = more.element() as HTMLButtonElement;
    const viewport = moreButton.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    viewport.style.height = "300px";
    viewport.style.maxHeight = "300px";
    moreButton.scrollIntoView({ block: "nearest" });
    const before = viewport.scrollTop;
    expect(before).toBeGreaterThan(0);
    moreButton.focus({ preventScroll: true });
    await act(() => moreButton.click());
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toHaveFocus();
    expect(viewport.scrollTop).toBe(before);
    const loadedRows = screen.container.querySelectorAll("[data-thread-item]").length;
    await act(() => moreButton.click());
    expect(screen.container.querySelectorAll("[data-thread-item]")).toHaveLength(loadedRows);
  });
});

describe("sidebar compact rows and project grouping", () => {
  it("renders single-line compact rows with status indicator and hover snooze/settle actions", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarCompactRows: true,
      sidebarWorkingShelfEnabled: false,
    });
    const activeProject = project("alpha");
    const workingThread = makeThreadFixture({
      environmentId: activeProject.environmentId,
      projectId: activeProject.id,
      id: ThreadId.make("compact-working"),
      title: "Working thread with a very long title that trims on hover",
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "codex",
        lastError: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const idleThread = makeThreadFixture({
      environmentId: activeProject.environmentId,
      projectId: activeProject.id,
      id: ThreadId.make("compact-idle"),
      title: "Idle thread",
      lastVisitedAt: "2026-01-02T00:00:00.000Z",
    });
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue([workingThread, idleThread]);
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: scopeProjectRef(activeProject.environmentId, activeProject.id),
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(useServerConfigs).mockReturnValue(
      new Map([
        [
          activeProject.environmentId,
          {
            scratchWorkspaceRoot: null,
            shellThreadFamilies: false,
          } as unknown as EnvironmentServerConfig,
        ],
      ]),
    );

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const compactRows = screen.container.querySelectorAll('[data-testid="sidebar-row-compact"]');
    expect(compactRows).toHaveLength(2);
    expect(screen.container.querySelector('[data-testid="sidebar-row-card"]')).toBeNull();

    const workingRow = Array.from(compactRows).find((row) =>
      row.textContent?.includes("Working thread"),
    )!;
    const idleRow = Array.from(compactRows).find((row) =>
      row.textContent?.includes("Idle thread"),
    )!;
    expect(workingRow.querySelector('[data-testid="sidebar-row-compact-status"]')).not.toBeNull();
    expect(idleRow.querySelector('[data-testid="sidebar-row-compact-status"]')).toBeNull();
    expect(idleRow.querySelector('button[aria-label="Snooze thread"]')).not.toBeNull();
    expect(idleRow.querySelector('button[aria-label="Settle thread"]')).not.toBeNull();
  });

  it("groups compact chat rows inside collapsible project dropdowns", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarCompactRows: true,
      boringSidebarEnabled: true,
    });
    const alpha = project("alpha");
    const beta = project("beta");
    const alphaThread = makeThreadFixture({
      environmentId: alpha.environmentId,
      projectId: alpha.id,
      id: ThreadId.make("alpha-thread"),
      title: "Alpha compact chat",
    });
    const betaThread = makeThreadFixture({
      environmentId: beta.environmentId,
      projectId: beta.id,
      id: ThreadId.make("beta-thread"),
      title: "Beta compact chat",
    });
    vi.mocked(useProjects).mockReturnValue([alpha, beta]);
    vi.mocked(useQuietThreadShells).mockReturnValue([alphaThread, betaThread]);
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: scopeProjectRef(alpha.environmentId, alpha.id),
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const folders = screen.container.querySelectorAll('[data-testid="sidebar-project-folder"]');
    expect(folders).toHaveLength(2);
    expect(screen.container.querySelectorAll('[data-testid="sidebar-row-compact"]')).toHaveLength(
      2,
    );

    const alphaToggle = screen.container.querySelector<HTMLButtonElement>(
      '[data-sidebar-row="folder:local:/projects/alpha"]',
    )!;
    // The sidebar shift guard drops pointer clicks on freshly rendered rows (<500ms); keys pass.
    alphaToggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Alpha compact chat")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Beta compact chat")).toBeVisible();

    alphaToggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Alpha compact chat")).toBeVisible();
  });

  it("keeps a pinned empty project folder but drops an empty No project folder", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
    const alpha = { ...project("alpha"), pinnedAt: "2026-01-01T00:00:00.000Z" };
    const scratch = {
      ...project("scratch"),
      isScratch: true as const,
      pinnedAt: "2026-01-01T00:00:00.000Z",
    };
    const beta = project("beta");
    vi.mocked(useProjects).mockReturnValue([alpha, scratch, beta]);
    vi.mocked(useQuietThreadShells).mockReturnValue([
      makeThreadFixture({
        environmentId: beta.environmentId,
        projectId: beta.id,
        id: ThreadId.make("beta-chat"),
        title: "Beta chat",
      }),
    ]);
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: scopeProjectRef(beta.environmentId, beta.id),
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await expect.element(screen.getByText("Beta chat")).toBeVisible();
    const folderTitles = Array.from(
      screen.container.querySelectorAll<HTMLElement>('[data-sidebar-row^="folder:"]'),
      (folder) => folder.textContent ?? "",
    );
    expect(folderTitles.some((title) => title.includes("alpha"))).toBe(true);
    expect(folderTitles.some((title) => title.includes("beta"))).toBe(true);
    expect(folderTitles.some((title) => title.includes("No project"))).toBe(false);
  });

  it("renders working threads grouped by project above Snoozed and Settled", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarCompactRows: true,
      boringSidebarEnabled: true,
      sidebarWorkingShelfEnabled: true,
    });
    const alpha = project("alpha");
    const beta = project("beta");
    const alphaIdle = makeThreadFixture({
      environmentId: alpha.environmentId,
      projectId: alpha.id,
      id: ThreadId.make("alpha-idle"),
      title: "Alpha idle chat",
    });
    const alphaWorking = makeThreadFixture({
      environmentId: alpha.environmentId,
      projectId: alpha.id,
      id: ThreadId.make("alpha-working"),
      title: "Alpha working chat",
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "codex",
        lastError: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const betaWorking = makeThreadFixture({
      environmentId: beta.environmentId,
      projectId: beta.id,
      id: ThreadId.make("beta-working"),
      title: "Beta working chat",
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "codex",
        lastError: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    vi.mocked(useProjects).mockReturnValue([alpha, beta]);
    vi.mocked(useQuietThreadShells).mockReturnValue([alphaIdle, alphaWorking, betaWorking]);
    vi.mocked(useThreadRouteTarget).mockReturnValue(null);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: scopeProjectRef(alpha.environmentId, alpha.id),
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const workingHeader = screen.container.querySelector<HTMLElement>(
      '[data-testid="sidebar-working-header"]',
    )!;
    expect(workingHeader).not.toBeNull();
    const settledHeader = screen.container.querySelector<HTMLElement>(
      '[data-sidebar-row="shelf:settled"]',
    )!;
    expect(settledHeader).not.toBeNull();
    expect(
      workingHeader.compareDocumentPosition(settledHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const followsWorkingHeader = (text: string) => {
      const row = screen.getByText(text).element();
      return Boolean(workingHeader.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    expect(followsWorkingHeader("Alpha working chat")).toBe(true);
    expect(followsWorkingHeader("Beta working chat")).toBe(true);
    expect(followsWorkingHeader("Alpha idle chat")).toBe(false);

    const workingAlphaToggle = screen.container.querySelector<HTMLButtonElement>(
      '[data-sidebar-row="working-folder:local:/projects/alpha"]',
    )!;
    expect(workingAlphaToggle).not.toBeNull();
    workingAlphaToggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Alpha working chat")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Beta working chat")).toBeVisible();
    await expect.element(screen.getByText("Alpha idle chat")).toBeVisible();

    workingAlphaToggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Alpha working chat")).toBeVisible();
  });
});
