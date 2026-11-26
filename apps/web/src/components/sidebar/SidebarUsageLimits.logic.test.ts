import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type UsageLimitSourceSnapshot,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarUsageModel } from "./SidebarUsageLimits.logic";

const now = Date.parse("2026-10-30T12:00:00.000Z");
const checkedAt = "2026-10-30T11:59:00.000Z";
const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const antigravity = ProviderDriverKind.make("antigravity");
const opencode = ProviderDriverKind.make("opencode");
const cursor = ProviderDriverKind.make("cursor");

function makeProvider(input: {
  readonly instanceId: string;
  readonly driver: ProviderDriverKind;
  readonly displayName?: string;
  readonly endpoint?: string;
  readonly usageLimits?: ServerProviderUsageLimits;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: input.driver,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: input.endpoint
      ? {
          status: "authenticated",
          type: "customEndpoint",
          label: "Custom API endpoint",
          endpoint: input.endpoint,
        }
      : { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
  };
}

function summarize(
  provider: ServerProvider,
  sources: readonly UsageLimitSourceSnapshot[] = [],
  model: string | null = null,
) {
  const result = resolveSidebarUsageModel({
    providerInstanceId: provider.instanceId,
    model,
    providers: [provider],
    sources,
    now,
  });
  if (!result) return null;
  return {
    notice: result.notice,
    lines: result.lines.map((line) => ({
      title: line.title,
      pieces: line.pieces.map((piece) => ({
        slot: piece.slot,
        id: piece.entry.window.id,
        kind: piece.entry.kind,
      })),
    })),
  };
}

describe("resolveSidebarUsageModel", () => {
  it("pairs Claude 5h + 7d + monthly spend and keeps scoped 7d standalone", () => {
    const provider = makeProvider({
      instanceId: "claudeAgent",
      driver: claude,
      usageLimits: {
        checkedAt,
        windows: [
          {
            id: "five_hour",
            kind: "session",
            label: "Session",
            usedPercent: 25,
            windowDurationMins: 300,
          },
          {
            id: "seven_day",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 40,
            windowDurationMins: 10080,
          },
          {
            id: "seven_day_sonnet",
            kind: "weekly",
            label: "Weekly · Sonnet",
            usedPercent: 10,
            windowDurationMins: 10080,
          },
          {
            id: "monthly_spend",
            kind: "monthly",
            label: "Monthly spend",
            usedPercent: 35,
          },
        ],
      },
    });

    expect(summarize(provider)).toEqual({
      notice: null,
      lines: [
        {
          title: "Claude",
          pieces: [
            { slot: "5h", id: "five_hour", kind: "instance" },
            { slot: "7d", id: "seven_day", kind: "instance" },
            { slot: "monthly", id: "monthly_spend", kind: "instance" },
          ],
        },
        {
          title: "Sonnet",
          pieces: [{ slot: "7d", id: "seven_day_sonnet", kind: "instance" }],
        },
      ],
    });
  });

  it("pairs Antigravity families into 5h -> 7d lines and skips missing 5h", () => {
    const provider = makeProvider({
      instanceId: "antigravity",
      driver: antigravity,
      usageLimits: {
        checkedAt,
        windows: [
          {
            id: "3p-weekly",
            kind: "weekly",
            label: "Claude & GPT (shared) · Weekly",
            usedPercent: 60,
            windowDurationMins: 10080,
          },
          {
            id: "gemini-weekly",
            kind: "weekly",
            label: "Gemini · Weekly",
            usedPercent: 12,
            windowDurationMins: 10080,
          },
          {
            id: "gemini-5h",
            kind: "session",
            label: "Gemini · 5-hour",
            usedPercent: 20,
            windowDurationMins: 300,
          },
        ],
      },
    });

    expect(summarize(provider)).toEqual({
      notice: null,
      lines: [
        {
          title: "Gemini",
          pieces: [
            { slot: "5h", id: "gemini-5h", kind: "instance" },
            { slot: "7d", id: "gemini-weekly", kind: "instance" },
          ],
        },
        {
          title: "Claude & GPT (shared)",
          pieces: [{ slot: "7d", id: "3p-weekly", kind: "instance" }],
        },
      ],
    });
  });

  it("groups OpenCode Go 5h, 7d, and monthly as three pieces and keeps budgets separate", () => {
    const provider = makeProvider({
      instanceId: "opencode",
      driver: opencode,
      usageLimits: {
        checkedAt,
        windows: [
          {
            id: "go_rolling",
            kind: "session",
            label: "Go · Session",
            usedPercent: 15,
            windowDurationMins: 300,
          },
          {
            id: "go_weekly",
            kind: "weekly",
            label: "Go · Weekly",
            usedPercent: 30,
            windowDurationMins: 10080,
          },
          {
            id: "go_monthly",
            kind: "monthly",
            label: "Go · Monthly",
            usedPercent: 45,
          },
          {
            id: "budget_1",
            kind: "other",
            label: "Console · Shared · All spend",
            usedPercent: 50,
          },
        ],
      },
    });

    expect(summarize(provider)).toEqual({
      notice: null,
      lines: [
        {
          title: "Go",
          pieces: [
            { slot: "5h", id: "go_rolling", kind: "instance" },
            { slot: "7d", id: "go_weekly", kind: "instance" },
            { slot: "monthly", id: "go_monthly", kind: "instance" },
          ],
        },
        {
          title: "Console · Shared · All spend",
          pieces: [{ slot: "other", id: "budget_1", kind: "instance" }],
        },
      ],
    });
  });

  it("suppresses duplicate Cursor total and keeps distinct monthly buckets on separate lines", () => {
    const provider = makeProvider({
      instanceId: "cursor",
      driver: cursor,
      usageLimits: {
        checkedAt,
        windows: [
          { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 50 },
          { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 40 },
          { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 60 },
        ],
      },
    });

    expect(summarize(provider)).toEqual({
      notice: null,
      lines: [
        {
          title: "Cursor Models",
          pieces: [{ slot: "monthly", id: "autoPercentUsed", kind: "instance" }],
        },
        {
          title: "Other Models",
          pieces: [{ slot: "monthly", id: "apiPercentUsed", kind: "instance" }],
        },
      ],
    });
  });

  it("pairs pooled hub windows and pairs bound HTTP quota accounts", () => {
    const provider = makeProvider({
      instanceId: "proxy-claude",
      driver: claude,
      displayName: "Proxy",
      endpoint: "http://127.0.0.1:8317",
      usageLimits: { checkedAt, windows: [], unavailable: { reason: "unsupported" } },
    });
    const hub: UsageLimitSourceSnapshot = {
      id: UsageLimitSourceId.make("hub"),
      kind: "cliproxy",
      label: "Hub",
      origin: "http://127.0.0.1:8317",
      checkedAt,
      accounts: [
        {
          id: "a.json",
          driver: codex,
          models: ["gpt-5.6-sol"],
          usageLimits: {
            checkedAt,
            windows: [
              { id: "primary", kind: "session", label: "Session", usedPercent: 20 },
              { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 50 },
            ],
          },
        },
      ],
    };
    const httpQuota: UsageLimitSourceSnapshot = {
      id: UsageLimitSourceId.make("quota"),
      kind: "http",
      label: "Quota",
      checkedAt,
      accounts: [],
      quotaAccounts: [
        {
          id: "work",
          label: "Work plan",
          providerInstanceId: provider.instanceId,
          windows: [
            { id: "s", kind: "session", label: "Session", usedPercent: 10 },
            { id: "w", kind: "weekly", label: "Weekly", usedPercent: 20 },
            { id: "m", kind: "monthly", label: "Monthly", usedPercent: 30 },
          ],
        },
      ],
    };

    expect(summarize(provider, [hub, httpQuota], "gpt-5.6-sol")).toEqual({
      notice: null,
      lines: [
        {
          title: "Proxy",
          pieces: [
            { slot: "5h", id: "session", kind: "pool" },
            { slot: "7d", id: "weekly", kind: "pool" },
          ],
        },
        {
          title: "Work plan",
          pieces: [
            { slot: "5h", id: "s", kind: "instance" },
            { slot: "7d", id: "w", kind: "instance" },
            { slot: "monthly", id: "m", kind: "instance" },
          ],
        },
      ],
    });
  });

  it("returns null when the provider has no limits and surfaces notice when probe failed", () => {
    const noLimits = makeProvider({ instanceId: "codex", driver: codex });
    expect(summarize(noLimits)).toBeNull();

    const failed = makeProvider({
      instanceId: "codex",
      driver: codex,
      usageLimits: {
        checkedAt,
        windows: [],
        unavailable: { reason: "probeFailed", message: "Could not read limits." },
      },
    });
    expect(summarize(failed)).toEqual({
      notice: "Could not read limits.",
      lines: [],
    });
  });
});
