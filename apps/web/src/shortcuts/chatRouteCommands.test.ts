import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import * as commandPalette from "../commandPaletteBus";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import * as previewActions from "../components/preview/previewActionBus";
import * as newThreadHooks from "../hooks/useHandleNewThread";
import * as scratchHooks from "../hooks/useScratchProject";
import * as settings from "../hooks/useSettings";
import * as storage from "../hooks/useLocalStorage";
import * as entities from "../state/entities";
import * as projectsState from "../state/projects";
import * as session from "../state/session";
import { Atom } from "effect/reactivity";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import { installChatRouteCommands } from "./chatRouteCommands";
import * as dispatcher from "./dispatcher";

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

describe("new thread commands", () => {
  it("starts a no-project chat when no thread is open and never opens the picker popup", () => {
    using _settings = vi
      .spyOn(settings, "getClientSettings")
      .mockReturnValue(DEFAULT_CLIENT_SETTINGS);
    using _projects = vi
      .spyOn(entities, "readProjects")
      .mockReturnValue([project("active"), project("idle")]);
    using _ready = vi
      .spyOn(projectsState, "defaultProjectFallbackReadyAtom")
      .mockReturnValue(Atom.make(true));
    using _storedProject = vi.spyOn(storage, "getLocalStorageItem").mockReturnValue("local:idle");
    using openPicker = vi.spyOn(commandPalette, "openCommandPalette").mockImplementation(() => {});
    const startThread = vi.fn().mockResolvedValue(null);
    using _newThread = vi
      .spyOn(newThreadHooks, "createNewThreadHandler")
      .mockReturnValue(startThread);
    const startScratchThread = vi.fn().mockResolvedValue(undefined);
    using _scratch = vi.spyOn(scratchHooks, "createScratchProjectActions").mockReturnValue({
      scratchWorkspaceRootFor: () => "/scratch",
      scratchEnvironmentId: () => EnvironmentId.make("local"),
      openScratchProject: vi.fn().mockResolvedValue(null),
      startScratchThread,
    });
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = { state: { matches: [] } } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const commands = register.mock.calls[0]![0];
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    commands["chat.new"]!(event);

    expect(openPicker).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    expect(startScratchThread).toHaveBeenCalledExactlyOnceWith(EnvironmentId.make("local"));
  });

  it("starts in the opened thread's project when a thread is open", () => {
    using _settings = vi
      .spyOn(settings, "getClientSettings")
      .mockReturnValue(DEFAULT_CLIENT_SETTINGS);
    const activeProject = project("active");
    const idleProject = project("idle");
    const openThread = makeThreadFixture({
      environmentId: activeProject.environmentId,
      projectId: activeProject.id,
      id: ThreadId.make("open-thread"),
    });
    using _projects = vi
      .spyOn(entities, "readProjects")
      .mockReturnValue([activeProject, idleProject]);
    using _shell = vi.spyOn(entities, "readThreadShell").mockReturnValue(openThread);
    using _ready = vi
      .spyOn(projectsState, "defaultProjectFallbackReadyAtom")
      .mockReturnValue(Atom.make(true));
    using _storedProject = vi.spyOn(storage, "getLocalStorageItem").mockReturnValue("local:idle");
    using openPicker = vi.spyOn(commandPalette, "openCommandPalette").mockImplementation(() => {});
    const startThread = vi.fn().mockResolvedValue(null);
    using _newThread = vi
      .spyOn(newThreadHooks, "createNewThreadHandler")
      .mockReturnValue(startThread);
    const startScratchThread = vi.fn().mockResolvedValue(undefined);
    using _scratch = vi.spyOn(scratchHooks, "createScratchProjectActions").mockReturnValue({
      scratchWorkspaceRootFor: () => "/scratch",
      scratchEnvironmentId: () => EnvironmentId.make("local"),
      openScratchProject: vi.fn().mockResolvedValue(null),
      startScratchThread,
    });
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = {
      state: {
        matches: [
          {
            routeId: "/_chat/$environmentId/$threadId",
            params: { environmentId: openThread.environmentId, threadId: openThread.id },
          },
        ],
      },
    } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const commands = register.mock.calls[0]![0];
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    commands["chat.new"]!(event);

    expect(openPicker).not.toHaveBeenCalled();
    expect(startScratchThread).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenCalledExactlyOnceWith({
      environmentId: activeProject.environmentId,
      projectId: activeProject.id,
    });
  });
});

describe("preview commands", () => {
  it.each([
    { command: "preview.find", action: "find" },
    { command: "preview.refresh", action: "refresh" },
    { command: "preview.focusUrl", action: "focus-url" },
  ] as const)("$command reaches the right panel on a draft thread", ({ command, action }) => {
    const draftId = DraftId.make("draft-1");
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(
        { environmentId: EnvironmentId.make("local"), projectId: ProjectId.make("active") },
        draftId,
      );
    using stack = new DisposableStack();
    stack.defer(() => useComposerDraftStore.getState().clearDraftThread(draftId));
    using _scope = vi.spyOn(session, "readEnvironmentScope").mockReturnValue(true);
    using dispatch = vi.spyOn(previewActions, "dispatchPreviewAction").mockImplementation(() => {});
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = {
      state: { matches: [{ routeId: "/_chat/draft/$draftId", params: { draftId } }] },
    } as unknown as AnyRouter;
    stack.defer(installChatRouteCommands(router));
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;

    register.mock.calls[0]![0][command]!(event);

    expect(dispatch).toHaveBeenCalledWith(action);
  });

  it("preview.find leaves the key unclaimed on non-thread chat routes", () => {
    using dispatch = vi.spyOn(previewActions, "dispatchPreviewAction").mockImplementation(() => {});
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = {
      state: { matches: [{ routeId: "/_chat/pull-requests", params: {} }] },
    } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;

    const result = register.mock.calls[0]![0]["preview.find"]!(event);

    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
