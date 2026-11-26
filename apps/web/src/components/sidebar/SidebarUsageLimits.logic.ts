import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { CURSOR_USAGE_WINDOWS, type LimitPoolWindow } from "@t3tools/shared/usageLimits";
import { limitsNotice } from "@t3tools/shared/usageLimitsCopy";

import { m, type MessageResolver } from "~/i18n/messages";
import {
  resolveThreadDetailsLimits,
  resolveThreadHttpQuotas,
} from "../chat/ThreadDetailsUsage.logic";

export type SidebarUsagePieceSlot = "5h" | "7d" | "monthly" | "other";

export type SidebarUsageWindowEntry =
  | {
      readonly kind: "instance";
      readonly key: string;
      readonly window: ServerProviderUsageWindow;
      readonly accountLabel?: string | undefined;
    }
  | {
      readonly kind: "pool";
      readonly key: string;
      readonly window: LimitPoolWindow;
    };

export interface SidebarUsagePiece {
  readonly slot: SidebarUsagePieceSlot;
  readonly entry: SidebarUsageWindowEntry;
}

export interface SidebarUsageLine {
  readonly key: string;
  readonly title: string;
  readonly pieces: readonly SidebarUsagePiece[];
}

export interface SidebarUsageModel {
  readonly providerTitle: string | null;
  readonly lines: readonly SidebarUsageLine[];
  readonly notice: string | null;
}

const SLOT_ORDER: Readonly<Record<SidebarUsagePieceSlot, number>> = {
  "5h": 0,
  "7d": 1,
  monthly: 2,
  other: 3,
};

const CADENCE_LABELS = new Set([
  "session",
  "5-hour",
  "5h",
  "weekly",
  "7-day",
  "7d",
  "monthly",
  "monthly spend",
  "monthly credit limit",
  "subscription",
]);

function isCadenceLabel(value: string): boolean {
  return CADENCE_LABELS.has(value.trim().toLowerCase());
}

function slotForKind(kind: ServerProviderUsageWindow["kind"]): SidebarUsagePieceSlot {
  switch (kind) {
    case "session":
      return "5h";
    case "weekly":
      return "7d";
    case "monthly":
      return "monthly";
    case "other":
      return "other";
  }
}

function resolveGroupIdentity(
  label: string,
  defaultTitle: string,
  scopePrefix: string,
): { readonly groupKey: string; readonly title: string } {
  const parts = label
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    const single = parts[0] ?? label.trim();
    if (isCadenceLabel(single)) {
      return { groupKey: `${scopePrefix}:default`, title: defaultTitle };
    }
    return { groupKey: `${scopePrefix}:label:${single.toLowerCase()}`, title: single };
  }

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (isCadenceLabel(last)) {
    const title = parts.slice(0, -1).join(" · ");
    return { groupKey: `${scopePrefix}:family:${title.toLowerCase()}`, title };
  }
  if (isCadenceLabel(first)) {
    const title = parts.slice(1).join(" · ");
    return { groupKey: `${scopePrefix}:family:${title.toLowerCase()}`, title };
  }
  const full = parts.join(" · ");
  return { groupKey: `${scopePrefix}:label:${full.toLowerCase()}`, title: full };
}

function cursorWindowRank(id: string): number {
  const index = CURSOR_USAGE_WINDOWS.findIndex((window) => window.id === id);
  return index < 0 ? CURSOR_USAGE_WINDOWS.length : index;
}

function normalizeInstanceWindows(
  driver: ServerProvider["driver"] | undefined,
  windows: readonly ServerProviderUsageWindow[],
): readonly ServerProviderUsageWindow[] {
  if (driver === "antigravity") {
    return [...windows].sort(
      (left, right) =>
        Number(!left.id.startsWith("gemini-")) - Number(!right.id.startsWith("gemini-")) ||
        left.id
          .replace(/-(5h|weekly|quota)$/, "")
          .localeCompare(right.id.replace(/-(5h|weekly|quota)$/, "")) ||
        SLOT_ORDER[slotForKind(left.kind)] - SLOT_ORDER[slotForKind(right.kind)],
    );
  }
  if (driver === "cursor") {
    const hasAuto = windows.some((window) => window.id === "autoPercentUsed");
    const hasApi = windows.some((window) => window.id === "apiPercentUsed");
    const total = windows.find((window) => window.id === "totalPercentUsed");
    const auto = windows.find((window) => window.id === "autoPercentUsed");
    const duplicateTotal =
      windows.length === 2 &&
      total !== undefined &&
      auto !== undefined &&
      total.usedPercent === auto.usedPercent &&
      total.resetsAt === auto.resetsAt;
    const hideTotal = (hasAuto && hasApi) || duplicateTotal;
    return windows
      .filter((window) => !hideTotal || window.id !== "totalPercentUsed")
      .sort((left, right) => cursorWindowRank(left.id) - cursorWindowRank(right.id));
  }
  return windows;
}

function groupEntriesIntoLines(
  entries: readonly SidebarUsageWindowEntry[],
  defaultTitle: string,
  scopePrefix: string,
): SidebarUsageLine[] {
  const groups = new Map<
    string,
    {
      readonly key: string;
      readonly title: string;
      readonly pieces: SidebarUsagePiece[];
    }
  >();

  for (const entry of entries) {
    const slot = slotForKind(entry.window.kind);
    const base = resolveGroupIdentity(entry.window.label, defaultTitle, scopePrefix);
    const piece: SidebarUsagePiece = {
      slot,
      entry,
    };

    const existing = groups.get(base.groupKey);
    if (!existing) {
      groups.set(base.groupKey, { key: base.groupKey, title: base.title, pieces: [piece] });
      continue;
    }

    const canMerge =
      slot !== "other" &&
      existing.pieces.every((candidate) => candidate.slot !== "other" && candidate.slot !== slot);
    if (canMerge) {
      existing.pieces.push(piece);
      continue;
    }

    const fallbackKey = `${base.groupKey}:extra:${entry.key}`;
    groups.set(fallbackKey, {
      key: fallbackKey,
      title: entry.window.label,
      pieces: [piece],
    });
  }

  return [...groups.values()].map((group) => ({
    key: group.key,
    title: group.title,
    pieces: [...group.pieces].sort((left, right) => SLOT_ORDER[left.slot] - SLOT_ORDER[right.slot]),
  }));
}

function resolveProviderDisplayTitle(provider: ServerProvider | undefined): string | null {
  if (!provider) return null;
  return (
    provider.displayName?.trim() ||
    providerClients.get(provider.driver)?.label ||
    String(provider.driver)
  );
}

export function resolveSidebarUsageModel(
  input: {
    readonly providerInstanceId: ProviderInstanceId | null;
    readonly model: string | null;
    readonly providers: readonly ServerProvider[];
    readonly sources: UsageLimitSourceSnapshots;
    readonly now: number;
    readonly defaultTitle?: string;
  },
  resolve: MessageResolver = m,
): SidebarUsageModel | null {
  const { providerInstanceId, model, providers, sources, now } = input;
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const quotas = resolveThreadHttpQuotas(providerInstanceId, sources);
  if (!resolved && quotas.length === 0) return null;

  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  const providerTitle = resolveProviderDisplayTitle(provider);
  const fallbackTitle = providerTitle ?? input.defaultTitle ?? "Usage limits";
  const lines: SidebarUsageLine[] = [];
  let notice: string | null = null;

  if (resolved?.kind === "pool") {
    const entries: SidebarUsageWindowEntry[] = resolved.windows.map((window) => ({
      kind: "pool",
      key: `${window.kind}:${window.id}`,
      window,
    }));
    lines.push(...groupEntriesIntoLines(entries, fallbackTitle, "pool"));
  } else if (resolved) {
    const instanceNotice = limitsNotice(resolved.limits, resolve);
    if (instanceNotice === null) {
      const normalized = normalizeInstanceWindows(provider?.driver, resolved.limits.windows);
      const entries: SidebarUsageWindowEntry[] = normalized.map((window) => ({
        kind: "instance",
        key: `${window.kind}:${window.id}`,
        window,
      }));
      lines.push(...groupEntriesIntoLines(entries, fallbackTitle, "instance"));
    } else if (quotas.length === 0) {
      notice = instanceNotice;
    }
  }

  if (quotas.length > 0) {
    const quotasByAccount = new Map<string, SidebarUsageWindowEntry[]>();
    for (const quota of quotas) {
      const accountKey = quota.accountLabel;
      const list = quotasByAccount.get(accountKey);
      const entry: SidebarUsageWindowEntry = {
        kind: "instance",
        key: quota.key,
        window: quota.window,
        accountLabel: quota.accountLabel,
      };
      if (list) list.push(entry);
      else quotasByAccount.set(accountKey, [entry]);
    }
    let accountIndex = 0;
    for (const [accountLabel, entries] of quotasByAccount) {
      lines.push(...groupEntriesIntoLines(entries, accountLabel, `quota:${accountIndex}`));
      accountIndex += 1;
    }
  }

  if (lines.length === 0 && notice === null) return null;
  return { providerTitle, lines, notice };
}
