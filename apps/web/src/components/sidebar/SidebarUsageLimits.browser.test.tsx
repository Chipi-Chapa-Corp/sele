import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { SidebarUsageLimits } from "./SidebarUsageLimits";

const checkedAt = "2026-10-30T11:59:00.000Z";

function makeProvider(
  driver: string,
  windows: readonly ServerProviderUsageWindow[],
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: { checkedAt, windows },
  };
}

describe("SidebarUsageLimits", () => {
  it("renders title on top, 5h -> 7d side by side, 7d full width when 5h is missing, and monthly as a third piece", async () => {
    const container = document.createElement("div");
    container.style.width = "256px";

    const provider = makeProvider("claudeAgent", [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        usedPercent: 20,
        windowDurationMins: 300,
      },
      {
        id: "seven_day",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 35,
        windowDurationMins: 10080,
      },
      {
        id: "monthly_spend",
        kind: "monthly",
        label: "Monthly spend",
        usedPercent: 50,
      },
      {
        id: "seven_day_sonnet",
        kind: "weekly",
        label: "Weekly · Sonnet",
        usedPercent: 10,
        windowDurationMins: 10080,
      },
      {
        id: "gemini-5h",
        kind: "session",
        label: "Gemini · 5-hour",
        usedPercent: 15,
        windowDurationMins: 300,
      },
      {
        id: "gemini-weekly",
        kind: "weekly",
        label: "Gemini · Weekly",
        usedPercent: 25,
        windowDurationMins: 10080,
      },
    ]);

    const onOpenUsage = vi.fn();
    await using screen = await render(
      <SidebarUsageLimits
        providerInstanceId={provider.instanceId}
        model={null}
        providers={[provider]}
        sources={[]}
        onOpenUsage={onOpenUsage}
      />,
      { container, router: "/" },
    );

    const lines = [...container.querySelectorAll<HTMLElement>("[data-sidebar-usage-line]")];
    expect(lines).toHaveLength(3);

    // Line 1: Claude with 5h -> 7d -> monthly (3 pieces side-by-side under the title, no 5h/7d hints)
    const claudeTitle = lines[0]!.querySelector<HTMLElement>("[data-sidebar-usage-title]")!;
    const claudePieces = [...lines[0]!.querySelectorAll<HTMLElement>("[data-sidebar-usage-piece]")];
    expect(claudeTitle.textContent).toBe("Claude");
    expect(claudePieces.map((el) => el.dataset.sidebarUsagePiece)).toEqual(["5h", "7d", "monthly"]);
    expect(claudePieces.map((el) => el.textContent)).toEqual(["80%", "65%", "50%"]);
    const claudeTitleRect = claudeTitle.getBoundingClientRect();
    const [p5h, p7d, pMo] = claudePieces.map((el) => el.getBoundingClientRect());
    expect(p5h!.top).toBeGreaterThanOrEqual(claudeTitleRect.bottom - 1);
    expect(Math.abs(p5h!.top - p7d!.top)).toBeLessThan(2);
    expect(Math.abs(p7d!.top - pMo!.top)).toBeLessThan(2);
    expect(p5h!.right).toBeLessThanOrEqual(p7d!.left);
    expect(p7d!.right).toBeLessThanOrEqual(pMo!.left);

    // 5h percentage sits to the left of its bar; 7d and monthly percentages sit to the right of theirs
    const p5hPercent = claudePieces[0]!.querySelector<HTMLElement>("[data-sidebar-usage-percent]")!;
    const p5hBar = claudePieces[0]!.querySelector<HTMLElement>("[data-sidebar-usage-bar]")!;
    expect(p5hPercent.getBoundingClientRect().right).toBeLessThanOrEqual(
      p5hBar.getBoundingClientRect().left,
    );
    const p7dPercent = claudePieces[1]!.querySelector<HTMLElement>("[data-sidebar-usage-percent]")!;
    const p7dBar = claudePieces[1]!.querySelector<HTMLElement>("[data-sidebar-usage-bar]")!;
    expect(p7dBar.getBoundingClientRect().right).toBeLessThanOrEqual(
      p7dPercent.getBoundingClientRect().left,
    );
    const pMoPercent = claudePieces[2]!.querySelector<HTMLElement>("[data-sidebar-usage-percent]")!;
    const pMoBar = claudePieces[2]!.querySelector<HTMLElement>("[data-sidebar-usage-bar]")!;
    expect(pMoBar.getBoundingClientRect().right).toBeLessThanOrEqual(
      pMoPercent.getBoundingClientRect().left,
    );

    // Line 2: Sonnet with no 5h -> 7d fills the full width of the pieces row
    const sonnetTitle = lines[1]!.querySelector<HTMLElement>("[data-sidebar-usage-title]")!;
    const sonnetPiecesRow = lines[1]!.querySelector<HTMLElement>("[data-sidebar-usage-pieces]")!;
    const sonnetPieces = [...lines[1]!.querySelectorAll<HTMLElement>("[data-sidebar-usage-piece]")];
    expect(sonnetTitle.textContent).toBe("Sonnet");
    expect(sonnetPieces.map((el) => el.dataset.sidebarUsagePiece)).toEqual(["7d"]);
    expect(
      Math.abs(
        sonnetPieces[0]!.getBoundingClientRect().width -
          sonnetPiecesRow.getBoundingClientRect().width,
      ),
    ).toBeLessThan(2);

    // Line 3: Gemini with 5h -> 7d side-by-side
    const geminiTitle = lines[2]!.querySelector<HTMLElement>("[data-sidebar-usage-title]")!;
    const geminiPieces = [...lines[2]!.querySelectorAll<HTMLElement>("[data-sidebar-usage-piece]")];
    expect(geminiTitle.textContent).toBe("Gemini");
    expect(geminiPieces.map((el) => el.dataset.sidebarUsagePiece)).toEqual(["5h", "7d"]);
    expect(geminiPieces[0]!.getBoundingClientRect().right).toBeLessThanOrEqual(
      geminiPieces[1]!.getBoundingClientRect().left,
    );

    // Clicking a piece navigates to /usage and triggers onOpenUsage
    await userEvent.click(geminiPieces[0]!);
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/usage"));
  });

  it("renders nothing when the active provider has no usage limits", async () => {
    const provider: ServerProvider = {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt,
      models: [],
      slashCommands: [],
      skills: [],
    };

    await using screen = await render(
      <SidebarUsageLimits
        providerInstanceId={provider.instanceId}
        model={null}
        providers={[provider]}
        sources={[]}
      />,
    );

    expect(screen.container.querySelector("[data-sidebar-usage]")).toBeNull();
  });
});
