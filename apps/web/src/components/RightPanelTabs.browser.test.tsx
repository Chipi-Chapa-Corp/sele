import "~/index.css";

import { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import type { RightPanelSurface } from "~/rightPanelStore";
import { act, render, stubGlobal } from "../../test/render";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";
import { RightPanelTabs, type RightPanelTabsProps } from "./RightPanelTabs";
import { subscribePreviewAction } from "./preview/previewActionBus";

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

// Chromium starts a gesture scroll, and Electron reports its begin, only for a
// wheel event the page did not preventDefault; it then scrolls the latched scroller.
function trackpad() {
  const begin = new Set<() => void>();
  const end = new Set<() => void>();
  const subscribe = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  let scrolling = false;
  return {
    bridge: {
      onTrackpadScrollBegin: subscribe(begin),
      onTrackpadScrollEnd: subscribe(end),
      onMenuAction: () => () => {},
    },
    scroll(target: Element, deltas: readonly number[]) {
      let scroller: Element | null = target;
      while (
        scroller &&
        (scroller.scrollWidth <= scroller.clientWidth ||
          !/auto|scroll/.test(getComputedStyle(scroller).overflowX))
      ) {
        scroller = scroller.parentElement;
      }
      for (const deltaX of deltas) {
        const event = new WheelEvent("wheel", {
          deltaX,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        target.dispatchEvent(event);
        if (event.defaultPrevented) continue;
        if (scroller) scroller.scrollLeft += deltaX;
        if (scrolling) continue;
        scrolling = true;
        for (const listener of begin) listener();
      }
      if (scrolling) for (const listener of end) listener();
      scrolling = false;
    },
  };
}

const surfaces: RightPanelSurface[] = Array.from({ length: 16 }, (_, index) => ({
  id: `terminal:${index}`,
  kind: "terminal",
  resourceId: `${index}`,
  terminalIds: [`${index}`],
  activeTerminalId: `${index}`,
}));

describe("RightPanelTabs", () => {
  it("a flick that scrolls the tab strip to its left edge keeps the thread, and so does a swipe from the edge", async () => {
    navigateHistory.mockReset();
    const { bridge, scroll } = trackpad();
    using _bridge = stubGlobal("desktopBridge", bridge);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const panel = document.createElement("div");
    panel.style.cssText = "width: 320px; height: 200px; display: flex";
    const noop = () => {};
    await using screen = await render(
      <>
        <HistorySwipeNavigation />
        <RightPanelTabs
          mode="embedded"
          keybindings={[]}
          getShortcutContext={() => ({
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          })}
          surfaces={surfaces}
          environmentId={null}
          activeSurfaceId={null}
          pendingSurfaceIds={new Set()}
          previewSessions={{}}
          desktopByTabId={{}}
          terminalLabelsById={new Map(surfaces.map((surface) => [surface.id, "Terminal"]))}
          onActivate={noop}
          onCloseSurface={noop}
          onCloseOtherSurfaces={noop}
          onCloseSurfacesToRight={noop}
          onCloseAllSurfaces={noop}
          onCopyFilePath={noop}
          onAddBrowser={noop}
          onAddBrowserInProfile={noop}
          onAddTerminal={noop}
          onAddDiff={noop}
          onAddFiles={noop}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          browserAvailable={false}
          terminalAvailable
          diffAvailable={false}
          filesAvailable={false}
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          deviceAvailable={false}
        >
          {null}
        </RightPanelTabs>
      </>,
      { container: panel },
    );
    const viewport = screen.container.querySelector<HTMLElement>(
      '[data-right-panel-tab-list] [data-slot="scroll-area-viewport"]',
    )!;
    expect(viewport.scrollWidth - viewport.clientWidth).toBeGreaterThan(120);
    viewport.scrollLeft = 120;

    const momentum = Array.from({ length: 24 }, (_, index) => -60 * 0.85 ** index);
    scroll(viewport.querySelector("[data-active-tab]")!, [-10, -20, -30, ...momentum]);

    expect(viewport.scrollLeft).toBe(0);
    expect(navigateHistory).not.toHaveBeenCalled();

    viewport.scrollLeft = 0;
    scroll(viewport.querySelector("[data-active-tab]")!, [-40, -40, -40, -40, -40]);

    expect(navigateHistory).not.toHaveBeenCalled();
  });
});

const BROWSER_SURFACE: RightPanelSurface = {
  id: "browser:tab-1",
  kind: "preview",
  resourceId: "tab-1",
};
const DIFF_SURFACE: RightPanelSurface = { id: "diff", kind: "diff" };

function panel(activeSurface: RightPanelSurface) {
  const noop = () => {};
  const props: RightPanelTabsProps = {
    mode: "inline",
    keybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: true,
      isWeb: true,
      isDesktop: false,
    }),
    surfaces: [BROWSER_SURFACE, DIFF_SURFACE],
    environmentId: EnvironmentId.make("environment-local"),
    activeSurfaceId: activeSurface.id,
    pendingSurfaceIds: new Set(),
    previewSessions: {},
    desktopByTabId: {},
    terminalLabelsById: new Map(),
    onActivate: noop,
    onCloseSurface: noop,
    onCloseOtherSurfaces: noop,
    onCloseSurfacesToRight: noop,
    onCloseAllSurfaces: noop,
    onCopyFilePath: noop,
    onAddBrowser: noop,
    onAddBrowserInProfile: noop,
    onAddTerminal: noop,
    onAddDiff: noop,
    onAddFiles: noop,
    onAddPullRequest: noop,
    onAddPullRequests: noop,
    onAddDevice: noop,
    browserAvailable: true,
    terminalAvailable: true,
    diffAvailable: true,
    filesAvailable: true,
    pullRequestAvailable: true,
    pullRequestsAvailable: true,
    deviceAvailable: true,
    children: (
      <div data-testid="surface-content">
        {/* Stands in for ServerBrowserSurface, whose page canvas handles thumb buttons itself. */}
        <canvas data-testid="page-canvas" onMouseUp={(event) => event.preventDefault()} />
        <InputGroup>
          <InputGroupInput aria-label="Address" />
          <InputGroupAddon data-testid="address-addon" align="inline-end" />
        </InputGroup>
      </div>
    ),
  };
  return <RightPanelTabs {...props} />;
}

// Chromium focuses on an uncancelled mousedown and runs history back/forward on an
// uncancelled button 3/4 mouseup.
function releaseThumbButton(
  target: Element,
  button: 3 | 4,
): { focusMoved: boolean; routerMoved: boolean } {
  const focused = document.activeElement;
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
  const up = new MouseEvent("mouseup", { bubbles: true, cancelable: true, button });
  target.dispatchEvent(down);
  target.dispatchEvent(up);
  return {
    focusMoved: !down.defaultPrevented || document.activeElement !== focused,
    routerMoved: !up.defaultPrevented,
  };
}

const STAYS_PUT = { focusMoved: false, routerMoved: false };

describe("right panel thumb buttons", () => {
  it("keep the app router still over a surface that is not a browser", async () => {
    await using screen = await render(panel(DIFF_SURFACE));
    const tabStrip = screen.container.querySelector("[data-right-panel-tabbar]")!;
    const content = screen.getByTestId("surface-content").element();

    expect(releaseThumbButton(tabStrip, 3)).toEqual(STAYS_PUT);
    expect(releaseThumbButton(tabStrip, 4)).toEqual(STAYS_PUT);
    expect(releaseThumbButton(content, 3)).toEqual(STAYS_PUT);
    expect(releaseThumbButton(content, 4)).toEqual(STAYS_PUT);
  });

  it("go back and forward in the active browser tab instead of the app router", async () => {
    const actions: string[] = [];
    using _subscription = { [Symbol.dispose]: subscribePreviewAction((a) => actions.push(a)) };
    await using screen = await render(panel(BROWSER_SURFACE));
    const tabStrip = screen.container.querySelector("[data-right-panel-tabbar]")!;
    const content = screen.getByTestId("surface-content").element();

    expect(releaseThumbButton(tabStrip, 3)).toEqual(STAYS_PUT);
    expect(releaseThumbButton(content, 4)).toEqual(STAYS_PUT);
    // The address addon focuses its input on press; a thumb press must leave focus alone.
    expect(releaseThumbButton(screen.getByTestId("address-addon").element(), 3)).toEqual(STAYS_PUT);
    expect(actions).toEqual(["back", "forward", "back"]);

    // The page canvas already went back in the tab; the panel must not go back a second time.
    releaseThumbButton(screen.getByTestId("page-canvas").element(), 3);
    expect(actions).toEqual(["back", "forward", "back"]);
  });
});

const DEVICE_SURFACE: RightPanelSurface = {
  id: "device:host:phone",
  kind: "device",
  target: { hostId: "host", deviceId: "phone", platform: "ios", name: "Phone" },
};

describe("device tab rename", () => {
  it("keeps the editor open on an Enter that confirms an IME candidate", async () => {
    const onRenameDevice = vi.fn();
    const props = panel(DEVICE_SURFACE).props as RightPanelTabsProps;
    await using screen = await render(
      <RightPanelTabs {...props} surfaces={[DEVICE_SURFACE]} onRenameDevice={onRenameDevice}>
        {null}
      </RightPanelTabs>,
    );
    await userEvent.dblClick(screen.getByRole("button", { name: "Phone", exact: true }));
    const input = screen.getByRole("textbox", { name: "Device tab name" });
    await userEvent.fill(input, "にほん");

    for (const shape of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ]) {
      input
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...shape }),
        );
    }

    await expect.element(input).toHaveFocus();
    expect(onRenameDevice).not.toHaveBeenCalled();
    await userEvent.fill(input, "日本語");
    await userEvent.keyboard("{Enter}");
    expect(onRenameDevice).toHaveBeenCalledExactlyOnceWith(DEVICE_SURFACE.id, "日本語");
  });
});

describe("add surface launcher", () => {
  it("hides the kind's add button and stops taking Mod+T and the desktop menu action once that kind cannot add a tab", async () => {
    const menuListeners = new Set<(action: string) => void>();
    using _bridge = stubGlobal("desktopBridge", {
      onMenuAction: (listener: (action: string) => void) => {
        menuListeners.add(listener);
        return () => menuListeners.delete(listener);
      },
    });
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const onAddPullRequest = vi.fn();
    const tabs = (pullRequestAvailable: boolean) => (
      <RightPanelTabs
        {...(panel(DIFF_SURFACE).props as RightPanelTabsProps)}
        open
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        browserAvailable
        terminalAvailable={false}
        diffAvailable={false}
        filesAvailable={false}
        pullRequestAvailable={pullRequestAvailable}
        onAddPullRequest={onAddPullRequest}
        pullRequestsAvailable={false}
        deviceAvailable={false}
      >
        {null}
      </RightPanelTabs>
    );
    const pressModT = async () => {
      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(() => {
        document.body.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    await using screen = await render(tabs(true));
    const addButton = screen.getByRole("button", { name: "Pull request" });

    await expect.element(addButton).toBeInTheDocument();
    expect(menuListeners.size).toBe(1);
    expect(await pressModT()).toBe(true);
    expect(onAddPullRequest).toHaveBeenCalledTimes(1);

    // The browser can still add tabs, but not to the Git kind that is shown.
    await screen.rerender(tabs(false));
    expect(addButton.query()).toBeNull();
    expect(menuListeners.size).toBe(0);
    expect(await pressModT()).toBe(false);
    expect(onAddPullRequest).toHaveBeenCalledTimes(1);
  });
});

describe("tab sizing", () => {
  it("stretches group tabs and nested tabs across the full available width even with long titles", async () => {
    const container = document.createElement("div");
    container.style.cssText = "width: 480px; height: 300px; display: flex;";
    const term1: RightPanelSurface = {
      id: "terminal:1",
      kind: "terminal",
      resourceId: "1",
      terminalIds: ["1"],
      activeTerminalId: "1",
    };
    const term2: RightPanelSurface = {
      id: "terminal:2",
      kind: "terminal",
      resourceId: "2",
      terminalIds: ["2"],
      activeTerminalId: "2",
    };
    const baseProps = panel(term1).props as RightPanelTabsProps;
    const renderTabs = (list: readonly RightPanelSurface[]) => (
      <RightPanelTabs
        {...baseProps}
        mode="inline"
        surfaces={list}
        terminalLabelsById={
          new Map([
            ["1", "Short"],
            [
              "2",
              "A very long terminal title that definitely exceeds four hundred pixels wide on screen",
            ],
          ])
        }
      >
        {null}
      </RightPanelTabs>
    );
    await using screen = await render(renderTabs([term1, term2, DIFF_SURFACE]), { container });
    const tabbar = screen.container.querySelector<HTMLElement>("[data-right-panel-tabbar]")!;
    const toggleGroup = tabbar.querySelector<HTMLElement>('[data-slot="toggle-group"]')!;
    const groupButtons = [...tabbar.querySelectorAll<HTMLElement>("[data-right-panel-group]")];
    const tabList = screen.container.querySelector<HTMLElement>("[data-right-panel-tab-list]")!;
    const viewport = tabList.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    const tabs = [...viewport.querySelectorAll<HTMLElement>("[data-active-tab]")];

    // Group row leaves only the space for Maximize + Toggle panel (80px) and fills the rest equally.
    expect(getComputedStyle(tabbar).paddingRight).toBe("80px");
    expect(Math.round(toggleGroup.getBoundingClientRect().width)).toBe(
      Math.round(tabbar.getBoundingClientRect().width - 88),
    );
    const groupWidths = groupButtons.map((button) =>
      Math.round(button.getBoundingClientRect().width),
    );
    expect(Math.max(...groupWidths) - Math.min(...groupWidths)).toBeLessThanOrEqual(1);

    // Two tabs share the full nested tab strip equally and truncate without triggering overflow.
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(tabs).toHaveLength(2);
    expect(
      Math.abs(tabs[0]!.getBoundingClientRect().width - tabs[1]!.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.round(
        tabs[0]!.getBoundingClientRect().width + tabs[1]!.getBoundingClientRect().width + 4,
      ),
    ).toBe(viewport.clientWidth);
    expect(screen.container.querySelector('[aria-label="Scroll panel tabs"]')).toBeNull();

    // Adding enough tabs to hit the per-tab minimum overflows and enables scroll controls.
    await screen.rerender(renderTabs(surfaces));
    await expect.element(screen.getByRole("button", { name: "Scroll tabs right" })).toBeVisible();
    expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
  });
});
