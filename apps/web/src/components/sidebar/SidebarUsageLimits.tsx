import { paceRemainingPercent, remainingPercent } from "@t3tools/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";

import type { ActiveThreadUsage } from "../../activeThreadUsageStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { limitTone, LimitWindowTooltip, PoolWindowTooltip } from "../chat/ThreadDetailsUsage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveSidebarUsageModel, type SidebarUsagePiece } from "./SidebarUsageLimits.logic";

function SidebarUsagePieceItem({
  piece,
  compact,
  now,
  onOpenUsage,
}: {
  readonly piece: SidebarUsagePiece;
  readonly compact: boolean;
  readonly now: number;
  readonly onOpenUsage?: (() => void) | undefined;
}) {
  const gt = useGT();
  const { entry } = piece;
  const left =
    entry.kind === "pool" ? entry.window.remainingPercent : remainingPercent(entry.window);
  const tick = entry.kind === "pool" ? null : paceRemainingPercent(entry.window, now);
  const tone = limitTone(left);
  const percentOnLeft = piece.slot === "5h";

  const percent = (
    <span
      data-sidebar-usage-percent
      className={cn(
        "shrink-0 text-2xs font-medium tabular-nums",
        percentOnLeft ? "text-start" : "text-end",
        tone === "error"
          ? "text-error-foreground"
          : tone === "warning"
            ? "text-warning-foreground"
            : "text-sidebar-foreground/85",
      )}
    >
      {left}%
    </span>
  );

  const bar = (
    <span
      data-sidebar-usage-bar
      className="relative h-[3px] min-w-3 flex-1 rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20"
    >
      {left > 0 ? (
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            tone === "error" ? "bg-error" : tone === "warning" ? "bg-warning" : "bg-foreground/80",
          )}
          style={{ width: `max(${left}%, 3px)` }}
        />
      ) : null}
      {tick !== null ? (
        <span
          aria-hidden
          className="absolute -top-[2px] h-[7px] w-px -translate-x-1/2 bg-foreground/75"
          style={{ left: `clamp(0.5px, ${tick}%, calc(100% - 0.5px))` }}
        />
      ) : null}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/usage"
            onClick={onOpenUsage}
            aria-label={gt("{label}: {left}% left", { label: entry.window.label, left })}
            data-sidebar-usage-piece={piece.slot}
            className={cn(
              "group flex h-5 min-w-0 cursor-pointer items-center rounded-md px-1 outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-sidebar-row-active data-popup-open:bg-sidebar-row-hover",
              compact ? "gap-1" : "gap-1.5",
            )}
          />
        }
      >
        {percentOnLeft ? (
          <>
            {percent}
            {bar}
          </>
        ) : (
          <>
            {bar}
            {percent}
          </>
        )}
      </TooltipTrigger>
      <TooltipPopup side="top" sideOffset={8}>
        <div className="flex flex-col gap-0.5">
          {entry.kind === "pool" ? (
            <PoolWindowTooltip window={entry.window} now={now} />
          ) : (
            <LimitWindowTooltip window={entry.window} now={now} accountLabel={entry.accountLabel} />
          )}
          <span className="text-muted-foreground">{gt("Open usage")}</span>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** Compact paired usage-limit lines anchored at the bottom of the main sidebar. */
export function SidebarUsageLimits({
  providerInstanceId,
  model,
  providers,
  sources,
  onOpenUsage,
}: ActiveThreadUsage & {
  readonly onOpenUsage?: (() => void) | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const defaultTitle = gt("Usage limits");
  const resolved = resolveSidebarUsageModel(
    { providerInstanceId, model, providers, sources, now, defaultTitle },
    m,
  );
  if (!resolved) return null;

  const unavailableTitle = resolved.providerTitle ?? defaultTitle;

  return (
    <section
      aria-label={defaultTitle}
      className="shrink-0 border-t border-sidebar-border px-2 pt-2 pb-2.5"
      data-sidebar-usage
    >
      {resolved.lines.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {resolved.lines.map((line) => (
            <div
              key={line.key}
              className="flex min-w-0 flex-col gap-0.5 px-1.5"
              data-sidebar-usage-line
            >
              <div
                className="truncate px-1 text-2xs font-medium text-sidebar-muted-foreground"
                data-sidebar-usage-title
              >
                {line.title}
              </div>
              <div
                className={cn(
                  "grid",
                  line.pieces.length >= 3
                    ? "grid-cols-3 gap-1"
                    : line.pieces.length === 2
                      ? "grid-cols-2 gap-1.5"
                      : "grid-cols-1",
                )}
                data-sidebar-usage-pieces
              >
                {line.pieces.map((piece) => (
                  <SidebarUsagePieceItem
                    key={piece.entry.key}
                    piece={piece}
                    compact={line.pieces.length >= 3}
                    now={now}
                    onOpenUsage={onOpenUsage}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : resolved.notice !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/usage"
                onClick={onOpenUsage}
                aria-label={gt("{label}: {value}", {
                  label: unavailableTitle,
                  value: gt("Unavailable"),
                })}
                className="group flex h-6 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-xs outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-sidebar-row-active data-popup-open:bg-sidebar-row-hover"
              />
            }
          >
            <span className="min-w-0 truncate text-sidebar-muted-foreground group-hover:text-sidebar-foreground">
              {unavailableTitle}
            </span>
            <span className="shrink-0 font-medium text-sidebar-muted-foreground">
              {gt("Unavailable")}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top" sideOffset={8}>
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground">{resolved.notice}</span>
              <span className="text-muted-foreground">{gt("Open usage")}</span>
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </section>
  );
}
