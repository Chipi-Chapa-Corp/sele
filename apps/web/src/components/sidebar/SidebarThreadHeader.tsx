import { useGT } from "gt-react";
import { MessageSquareDashedIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarHeaderActionsProps {
  searchOpen: boolean;
  onToggleSearch: () => void;
  onNewWithoutProject: () => void;
  newWithoutProjectDisabled: boolean;
  newWithoutProjectShortcutLabel: string | null | undefined;
  onNewThread: () => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
}

export function SidebarHeaderActions({
  searchOpen,
  onToggleSearch,
  onNewWithoutProject,
  newWithoutProjectDisabled,
  newWithoutProjectShortcutLabel,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
}: SidebarHeaderActionsProps) {
  const gt = useGT();
  const newWithoutProjectLabel = newWithoutProjectShortcutLabel
    ? gt("New chat without project ({shortcut})", { shortcut: newWithoutProjectShortcutLabel })
    : gt("New chat without project");
  const newThreadLabel = newThreadShortcutLabel
    ? gt("New thread ({shortcut})", { shortcut: newThreadShortcutLabel })
    : gt("New thread");

  return (
    <>
      <SidebarHeaderIconButton
        label={gt("Search threads")}
        tooltip={gt("Search", { $context: "search field placeholder" })}
        active={searchOpen}
        aria-expanded={searchOpen}
        className="[-webkit-app-region:no-drag]"
        onClick={onToggleSearch}
      >
        <SearchIcon />
      </SidebarHeaderIconButton>
      <SidebarHeaderIconButton
        label={gt("New chat without project")}
        tooltip={newWithoutProjectLabel}
        className="[-webkit-app-region:no-drag]"
        disabled={newWithoutProjectDisabled}
        onClick={onNewWithoutProject}
      >
        <MessageSquareDashedIcon />
      </SidebarHeaderIconButton>
      <SidebarHeaderIconButton
        label={gt("New thread")}
        tooltip={newThreadLabel}
        className="[-webkit-app-region:no-drag]"
        disabled={newThreadDisabled}
        onClick={onNewThread}
      >
        <SquarePenIcon />
      </SidebarHeaderIconButton>
    </>
  );
}

export interface SidebarThreadSearchPanelProps {
  open: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadSearchPanel({
  open,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadSearchPanelProps) {
  const gt = useGT();
  const resultsVisible = open && isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;

  return (
    <div
      data-sidebar-search-panel=""
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        <div
          className={cn(
            "px-2 pb-1.5 pt-0.5 transition-transform duration-200 ease-out",
            open ? "translate-y-0" : "-translate-y-2",
          )}
        >
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring/70">
            <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
            <SidebarInput
              ref={searchInputRef}
              nativeInput
              type="search"
              tabIndex={open ? 0 : -1}
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={gt("Search", { $context: "search field placeholder" })}
              aria-label={gt("Search threads")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={resultsVisible}
              aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
              aria-activedescendant={
                activeResultExists
                  ? `sidebar-thread-search-result-${activeSearchResultIndex}`
                  : undefined
              }
              className="min-w-0 flex-1"
            />
            {isSearching ? (
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                className="shrink-0"
                tabIndex={open ? 0 : -1}
                aria-label={gt("Clear thread search")}
                onClick={() => {
                  onClearSearch();
                  searchInputRef.current?.focus();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  tooltipSide = "bottom",
  active = false,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  tooltipSide?: "top" | "bottom";
  active?: boolean;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            isActive={active}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side={tooltipSide}>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
