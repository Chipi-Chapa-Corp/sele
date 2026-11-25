import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  TextWrapIcon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

import type { DraftId } from "~/composerDraftStore";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { useNativeTitlebarHeight } from "~/lib/windowControlsOverlay";

import { DiffStatLabel } from "../chat/DiffStatLabel";
import { DiffFilePathCopyButton } from "../DiffFilePathCopyButton";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AnnotatableCodeView } from "./AnnotatableCodeView";
import { DiffFileStatus } from "./DiffFileStatus";
import { DiffFileTree, type DiffFileTreeEntry, type DiffFileTreeHandle } from "./DiffFileTree";
import {
  clampDiffPopupSize,
  computeCenteredPopupResize,
  splitFileDisplayPath,
} from "./diffFilePopup.logic";

const DIFF_POPUP_SIZE_STORAGE_KEY = "t3code:diff-popup-size";
const DIFF_POPUP_TREE_OPEN_STORAGE_KEY = "t3code:diff-popup-tree-open";
const DIFF_POPUP_TREE_WIDTH_STORAGE_KEY = "t3code:diff-popup-tree-width";
const POPUP_TREE_MIN_WIDTH = 180;
const POPUP_TREE_DEFAULT_WIDTH = 240;
const POPUP_TREE_MAX_WIDTH = 420;

const PopupSizeSchema = Schema.Struct({
  width: Schema.Finite,
  height: Schema.Finite,
});
const StoredPopupSizeSchema = Schema.NullOr(PopupSizeSchema);

export interface DiffPopupFileEntry {
  readonly fileDiff: FileDiffMetadata;
  readonly filePath: string;
  readonly fileKey: string;
  readonly fileVersion: number;
}

export interface DiffFilePopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly filePath: string | null;
  readonly onSelectFile: (filePath: string) => void;
  readonly entries: ReadonlyArray<DiffFileTreeEntry>;
  readonly fileEntry: DiffPopupFileEntry | null;
  readonly fileStat: { readonly additions: number; readonly deletions: number } | undefined;
  readonly fileState: { readonly error: boolean; readonly truncated: boolean } | undefined;
  readonly isLoading: boolean;
  readonly environmentId: EnvironmentId | undefined;
  readonly projectId: ProjectId | null | undefined;
  readonly workspaceRoot: string | undefined;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly diffLayout: "stacked" | "split";
  readonly onDiffLayoutChange: (layout: "stacked" | "split") => void;
  readonly wordWrap: boolean;
  readonly onWordWrapChange: (wrap: boolean) => void;
  readonly ignoreWhitespace: boolean;
  readonly onIgnoreWhitespaceChange: (ignore: boolean) => void;
  readonly resolvedTheme: "light" | "dark";
  readonly loadDiffFiles?: FileDiffContentsLoader | undefined;
  readonly onRetry: (path: string) => void;
  readonly onFileContextMenu: (filePath: string, event: ReactMouseEvent<HTMLElement>) => void;
}

export function DiffFilePopup({
  open,
  onClose,
  filePath,
  onSelectFile,
  entries,
  fileEntry,
  fileStat,
  fileState,
  isLoading,
  environmentId,
  projectId,
  workspaceRoot,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  diffLayout,
  onDiffLayoutChange,
  wordWrap,
  onWordWrapChange,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
  resolvedTheme,
  loadDiffFiles,
  onRetry,
  onFileContextMenu,
}: DiffFilePopupProps) {
  const gt = useGT();
  const nativeTitlebarHeight = useNativeTitlebarHeight();
  const popupRef = useRef<HTMLDivElement>(null);
  const popupTreeRef = useRef<DiffFileTreeHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const [allFoldersExpanded, setAllFoldersExpanded] = useState(true);
  const [savedSize, setSavedSize] = useLocalStorage(
    DIFF_POPUP_SIZE_STORAGE_KEY,
    null,
    StoredPopupSizeSchema,
  );
  const [treeSidebarOpen, setTreeSidebarOpen] = useLocalStorage(
    DIFF_POPUP_TREE_OPEN_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const {
    width: treeWidth,
    setWidth: setTreeWidth,
    handlers: treeResizeHandlers,
  } = useResizableWidth({
    storageKey: DIFF_POPUP_TREE_WIDTH_STORAGE_KEY,
    defaultWidth: POPUP_TREE_DEFAULT_WIDTH,
    minWidth: POPUP_TREE_MIN_WIDTH,
    maxWidth: POPUP_TREE_MAX_WIDTH,
    edge: "right",
  });

  const displayPath = filePath ?? "";
  const { fileName, directoryName } = splitFileDisplayPath(displayPath);
  const showTreeSidebar = treeSidebarOpen && entries.length > 0;
  const hasTreeDirectories = entries.some((entry) => entry.path.includes("/"));

  const popupStyle: CSSProperties | undefined = expanded
    ? undefined
    : savedSize !== null
      ? {
          width: `min(${savedSize.width}px, calc(100vw - 1.5rem))`,
          height: `min(${savedSize.height}px, calc(100vh - 1.5rem))`,
        }
      : undefined;

  const handleCornerResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || expanded) return;
    const handle = event.currentTarget;
    const popup = popupRef.current;
    if (!popup) return;

    event.preventDefault();
    event.stopPropagation();

    const bounds = popup.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let latestSize = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    let moved = false;

    handle.setPointerCapture(pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moved = true;
      latestSize = computeCenteredPopupResize({
        startWidth: bounds.width,
        startHeight: bounds.height,
        deltaX: moveEvent.clientX - startX,
        deltaY: moveEvent.clientY - startY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      popup.style.width = `${latestSize.width}px`;
      popup.style.height = `${latestSize.height}px`;
    };

    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      handle.removeEventListener("lostpointercapture", onEnd);
      if (moved) {
        setSavedSize(latestSize);
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    handle.addEventListener("lostpointercapture", onEnd);
  };

  const handleCornerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (expanded || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 64 : 24;
    let deltaWidth = 0;
    let deltaHeight = 0;
    switch (event.key) {
      case "ArrowRight":
        deltaWidth = step;
        break;
      case "ArrowLeft":
        deltaWidth = -step;
        break;
      case "ArrowDown":
        deltaHeight = step;
        break;
      case "ArrowUp":
        deltaHeight = -step;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const bounds = popupRef.current?.getBoundingClientRect();
    const baseWidth = savedSize?.width ?? bounds?.width ?? 1024;
    const baseHeight = savedSize?.height ?? bounds?.height ?? 720;
    setSavedSize(
      clampDiffPopupSize(
        { width: baseWidth + deltaWidth, height: baseHeight + deltaHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  const singleFile =
    fileEntry !== null
      ? [
          {
            fileDiff: fileEntry.fileDiff,
            filePath: fileEntry.filePath,
            fileKey: fileEntry.fileKey,
            fileVersion: fileEntry.fileVersion,
            collapsed: false,
          },
        ]
      : [];

  return (
    <DialogPrimitive.Root
      open={open && filePath !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          forceRender
          className="dialog-backdrop fixed inset-0 z-50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
          data-slot="diff-popup-backdrop"
        />
        <DialogPrimitive.Viewport
          className={cn(
            "fixed inset-0 z-50 grid place-items-center [-webkit-app-region:no-drag]",
            expanded ? "p-0" : "p-3",
          )}
          style={
            expanded && nativeTitlebarHeight > 0
              ? { paddingTop: `${nativeTitlebarHeight}px` }
              : undefined
          }
          data-slot="diff-popup-viewport"
        >
          <DialogPrimitive.Popup
            ref={popupRef}
            data-slot="diff-popup"
            style={popupStyle}
            className={cn(
              "dialog-glass relative flex min-h-0 min-w-0 flex-col overflow-hidden text-popover-foreground outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]",
              expanded
                ? "size-full rounded-none border-0"
                : "h-[min(50rem,calc(100vh-2rem))] w-[min(72rem,calc(100vw-2rem))] min-h-[min(18rem,calc(100vh-1.5rem))] min-w-[min(24rem,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] rounded-2xl border",
            )}
          >
            <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {entries.length > 0 ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={
                            treeSidebarOpen ? gt("Hide changed files") : gt("Show changed files")
                          }
                          aria-expanded={treeSidebarOpen}
                          onClick={() => setTreeSidebarOpen(!treeSidebarOpen)}
                        />
                      }
                    >
                      {treeSidebarOpen ? (
                        <PanelLeftCloseIcon className="size-3.5" />
                      ) : (
                        <PanelLeftOpenIcon className="size-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">
                      {treeSidebarOpen ? gt("Hide changed files") : gt("Show changed files")}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                {showTreeSidebar && hasTreeDirectories ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={
                            allFoldersExpanded
                              ? gt("Collapse all folders")
                              : gt("Expand all folders")
                          }
                          onClick={() =>
                            popupTreeRef.current?.setAllDirectoriesExpanded(!allFoldersExpanded)
                          }
                        />
                      }
                    >
                      {allFoldersExpanded ? (
                        <ChevronsDownUpIcon className="size-3.5" />
                      ) : (
                        <ChevronsUpDownIcon className="size-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">
                      {allFoldersExpanded ? gt("Collapse all folders") : gt("Expand all folders")}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                <div
                  className="flex min-w-0 items-center gap-1.5"
                  onContextMenu={(event) => {
                    if (!displayPath) return;
                    event.preventDefault();
                    onFileContextMenu(displayPath, event);
                  }}
                >
                  <DialogPrimitive.Title className="truncate text-xs font-medium text-foreground">
                    {fileName}
                  </DialogPrimitive.Title>
                  {directoryName ? (
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                      {directoryName}
                    </span>
                  ) : null}
                  {displayPath ? (
                    <DiffFilePathCopyButton filePath={displayPath} workspaceRoot={workspaceRoot} />
                  ) : null}
                  {displayPath && fileStat !== undefined ? (
                    <DiffFileStatus
                      error={fileState?.error ?? false}
                      truncated={fileState?.truncated ?? false}
                      retry={() => onRetry(displayPath)}
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {fileStat ? (
                  <DiffStatLabel
                    additions={fileStat.additions}
                    deletions={fileStat.deletions}
                    className="mr-1 text-2xs"
                    layout="inline"
                  />
                ) : null}
                <span className="hidden sm:contents">
                  <ToggleGroup
                    aria-label={gt("Diff layout")}
                    variant="segmented"
                    value={[diffLayout]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (next === "stacked" || next === "split") {
                        onDiffLayoutChange(next);
                      }
                    }}
                  >
                    <Toggle aria-label={gt("Stacked diff view")} value="stacked">
                      <Rows3Icon className="size-3.5" />
                    </Toggle>
                    <Toggle aria-label={gt("Split diff view")} value="split">
                      <Columns2Icon className="size-3.5" />
                    </Toggle>
                  </ToggleGroup>
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toggle
                        aria-label={
                          wordWrap
                            ? gt("Disable diff line wrapping")
                            : gt("Enable diff line wrapping")
                        }
                        variant="ghost"
                        size="sm"
                        pressed={wordWrap}
                        onPressedChange={(pressed) => onWordWrapChange(Boolean(pressed))}
                      />
                    }
                  >
                    <TextWrapIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {wordWrap ? gt("Disable line wrapping") : gt("Enable line wrapping")}
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toggle
                        aria-label={
                          ignoreWhitespace
                            ? gt("Show whitespace changes")
                            : gt("Hide whitespace changes")
                        }
                        variant="ghost"
                        size="sm"
                        pressed={ignoreWhitespace}
                        onPressedChange={(pressed) => onIgnoreWhitespaceChange(Boolean(pressed))}
                      />
                    }
                  >
                    <PilcrowIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {ignoreWhitespace
                      ? gt("Show whitespace changes")
                      : gt("Hide whitespace changes")}
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={
                          expanded ? gt("Restore diff popup size") : gt("Maximize diff popup")
                        }
                        onClick={() => setExpanded((current) => !current)}
                      />
                    }
                  >
                    {expanded ? (
                      <Minimize2Icon className="size-3.5" />
                    ) : (
                      <Maximize2Icon className="size-3.5" />
                    )}
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {expanded ? gt("Restore size") : gt("Maximize")}
                  </TooltipPopup>
                </Tooltip>
                <DialogPrimitive.Close
                  aria-label={gt("Close diff popup")}
                  render={<Button type="button" size="icon-sm" variant="ghost" />}
                >
                  <XIcon className="size-3.5" />
                </DialogPrimitive.Close>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
              {showTreeSidebar ? (
                <aside
                  aria-label={gt("Changed files")}
                  className="relative hidden min-h-0 min-w-0 shrink-0 border-r border-border/60 bg-background sm:flex"
                  style={
                    {
                      [RESIZABLE_WIDTH_PROPERTY]: `${treeWidth}px`,
                      width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
                    } as CSSProperties
                  }
                >
                  <DiffFileTree
                    ariaLabel={gt("Changed files")}
                    entries={entries}
                    selectedPath={filePath}
                    onSelectFile={onSelectFile}
                    showHeader={false}
                    treeRef={popupTreeRef}
                    onAllDirectoriesExpandedChange={setAllFoldersExpanded}
                  />
                  <div
                    role="separator"
                    aria-label={gt("Resize changed files sidebar")}
                    aria-orientation="vertical"
                    aria-valuenow={treeWidth}
                    aria-valuemin={POPUP_TREE_MIN_WIDTH}
                    aria-valuemax={POPUP_TREE_MAX_WIDTH}
                    tabIndex={0}
                    className="group absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize touch-none select-none"
                    onKeyDown={(event) => {
                      if (event.altKey || event.ctrlKey || event.metaKey) return;
                      let nextWidth: number;
                      switch (event.key) {
                        case "ArrowRight":
                          nextWidth = treeWidth + 16;
                          break;
                        case "ArrowLeft":
                          nextWidth = treeWidth - 16;
                          break;
                        case "Home":
                          nextWidth = POPUP_TREE_MIN_WIDTH;
                          break;
                        case "End":
                          nextWidth = POPUP_TREE_MAX_WIDTH;
                          break;
                        default:
                          return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      setTreeWidth(nextWidth);
                    }}
                    {...treeResizeHandlers}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-focus-visible:bg-primary/60 group-active:bg-primary/60"
                    />
                  </div>
                </aside>
              ) : null}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {isLoading ? (
                  <DiffPanelLoadingState label={gt("Loading diff...")} />
                ) : fileState?.error ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
                    <p>
                      <T>Could not load the diff for this file.</T>
                    </p>
                    {displayPath ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => onRetry(displayPath)}
                      >
                        <RefreshCwIcon className="size-3" />
                        <T>Retry</T>
                      </Button>
                    ) : null}
                  </div>
                ) : singleFile.length > 0 ? (
                  <AnnotatableCodeView
                    key={`${sectionId}:${fileEntry!.fileKey}`}
                    environmentId={environmentId}
                    projectId={projectId}
                    codeViewKey={`${sectionId}:${fileEntry!.fileKey}`}
                    className="h-full min-h-0 overflow-auto"
                    files={singleFile}
                    pendingFiles={[]}
                    sectionId={sectionId}
                    sectionTitle={sectionTitle}
                    composerDraftTarget={composerDraftTarget}
                    renderHeaderFilenameSuffix={() => null}
                    onFileCollapsedChange={() => {}}
                    renderHeaderPrefix={() => null}
                    options={{
                      disableFileHeader: true,
                      diffStyle: diffLayout === "split" ? "split" : "unified",
                      lineDiffType: "none",
                      overflow: wordWrap ? "wrap" : "scroll",
                      theme: resolveDiffThemeName(resolvedTheme),
                      preferredHighlighter: PREFERRED_HIGHLIGHTER,
                      themeType: resolvedTheme,
                      stickyHeaders: false,
                      ...(loadDiffFiles ? { loadDiffFiles } : {}),
                    }}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
                    <T>No diff available for this file.</T>
                  </div>
                )}
              </div>
            </div>

            {!expanded ? (
              <div
                role="separator"
                aria-label={gt("Resize diff popup")}
                tabIndex={0}
                data-slot="diff-popup-resize-handle"
                onPointerDown={handleCornerResizePointerDown}
                onKeyDown={handleCornerResizeKeyDown}
                className="absolute right-1 bottom-1 z-20 flex size-4 cursor-nwse-resize touch-none items-end justify-end select-none text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground [-webkit-app-region:no-drag]"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 12 12"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                >
                  <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
                  <line x1="10.5" y1="7.5" x2="7.5" y2="10.5" />
                </svg>
              </div>
            ) : null}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
