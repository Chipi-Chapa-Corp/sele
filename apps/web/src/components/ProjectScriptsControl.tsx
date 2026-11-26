import { m } from "../i18n/messages";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { ComposerControl } from "./chat/ComposerControl";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectScript,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScriptsCopy";
import { ChevronDownIcon, DownloadIcon, PlusIcon, SettingsIcon, WrenchIcon } from "lucide-react";
import React, { useState } from "react";
import { T, useGT, useMessages, Var } from "gt-react";

import { commandForProjectScript, primaryProjectScript } from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";
import { Button } from "./ui/button";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { cn } from "~/lib/utils";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./chat/threadDetailsPanelStyles";

export type { NewProjectScriptInput, ProjectScriptActionResult };

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

interface ProjectScriptsControlProps {
  displayMode?: "toolbar" | "panel";
  presentation?: "toolbar" | "menu";
  onRequestMenuClose?: () => void;
  environmentId: EnvironmentId;
  scripts: ReadonlyArray<ProjectScript>;
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  onActionsMenuOpen?: () => void;
  preferredScriptId?: string | null;
  onRunScript?: ((script: ProjectScript) => void) | undefined;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export default function ProjectScriptsControl({
  displayMode = "toolbar",
  presentation = "toolbar",
  onRequestMenuClose,
  environmentId,
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  onActionsMenuOpen,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const gt = useGT();
  const messages = useMessages();
  const isPanel = displayMode === "panel";
  const groupAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const skipMenuFinalFocusRef = React.useRef(false);
  const keybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const [actionsMenuOpen, setActionsMenuOpen] = useState({
    presentation,
    scripts: false,
    imports: false,
  });
  if (actionsMenuOpen.presentation !== presentation) {
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
  }
  const openActionsMenu = (menus: { scripts: boolean; imports: boolean }) => {
    if (menus.scripts || menus.imports) onActionsMenuOpen?.();
    setActionsMenuOpen({ presentation, ...menus });
  };
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const editorRequestIdRef = React.useRef(0);

  const primaryScript =
    (preferredScriptId ? scripts.find((script) => script.id === preferredScriptId) : undefined) ??
    primaryProjectScript(scripts);
  const importableScripts = fileScripts.filter(
    (fileScript) =>
      !scripts.some(
        (script) =>
          script.command === fileScript.command ||
          script.name.toLowerCase() === fileScript.name.toLowerCase(),
      ),
  );

  const handleMenuFinalFocus = () => {
    if (!skipMenuFinalFocusRef.current) return true;
    skipMenuFinalFocusRef.current = false;
    return false;
  };

  const runScriptFromMenu = (script: ProjectScript) => {
    // Keep Base UI from restoring focus to the dropdown trigger after opening the terminal tab.
    skipMenuFinalFocusRef.current = true;
    onRunScript?.(script);
  };

  const openAddDialog = () => {
    editorRequestIdRef.current += 1;
    setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
  };

  const openEditDialog = (script: ProjectScript) => {
    editorRequestIdRef.current += 1;
    onRequestMenuClose?.();
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
    setEditorRequest(editorRequestForScript(script, keybindings));
  };

  const submitScript = (scriptId: string | null, input: NewProjectScriptInput) =>
    scriptId === null ? onAddScript(input) : onUpdateScript(scriptId, input);

  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const requestId = ++editorRequestIdRef.current;
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
      runOnSettle: fileScript.runOnSettle ?? false,
      stopOnSettle: fileScript.stopOnSettle ?? false,
      ...(readEnvironmentScope(environmentId, AuthSettingsWriteScope) ? { keybinding: null } : {}),
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await onAddScript(payload);
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;

    const message = thrownErrorMessage(squashAtomCommandFailure(result), m);
    if (requestId !== editorRequestIdRef.current) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to import {name}.", { name: fileScript.name }),
          ...(message ? { description: message } : {}),
        }),
      );
      return;
    }
    setEditorRequest({
      scriptId: null,
      initial: payload,
      error: message ?? gt("Failed to import action."),
    });
  };

  const importMenuItems = importableScripts.length > 0 && (
    <>
      {scripts.length > 0 && <MenuSeparator />}
      {importableScripts.map((fileScript) => (
        <MenuItem
          density={presentation === "menu" ? "touch" : "default"}
          key={`${fileScript.name} ${fileScript.command}`}
          onClick={() => void importFileScript(fileScript)}
        >
          <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
          <MenuItemLabel>{fileScript.name}</MenuItemLabel>
          <MenuShortcut>
            <DownloadIcon
              className="size-3.5"
              aria-label={gt("Import", { $context: "verb, import an action from t3.json" })}
            />
          </MenuShortcut>
        </MenuItem>
      ))}
    </>
  );

  const scriptItems = (
    <>
      {scripts.map((script) => {
        const shortcutLabel = shortcutLabelForCommand(
          keybindings,
          commandForProjectScript(script.id),
        );
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={script.id}
            className="group"
            disabled={!onRunScript}
            onClick={() => runScriptFromMenu(script)}
          >
            <ScriptIcon icon={script.icon} className="size-4" />
            <MenuItemLabel>{projectScriptMenuLabel(script, messages)}</MenuItemLabel>
            <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
              {shortcutLabel &&
                (presentation === "menu" ? (
                  <MenuShortcut className="ms-0 mr-7">{shortcutLabel}</MenuShortcut>
                ) : (
                  <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                    <MenuShortcut className="ms-0">{shortcutLabel}</MenuShortcut>
                  </span>
                ))}
              <span
                className={`absolute right-0 top-1/2 flex -translate-y-1/2 ${presentation === "menu" ? "" : "opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  aria-label={gt("Edit {name}", { name: script.name })}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openEditDialog(script);
                  }}
                >
                  <SettingsIcon className="size-3.5" />
                </Button>
              </span>
            </span>
          </MenuItem>
        );
      })}
      {importMenuItems}
      <MenuItem density={presentation === "menu" ? "touch" : "default"} onClick={openAddDialog}>
        <PlusIcon className="size-4" />
        <MenuItemLabel>{isPanel ? gt("Add project script") : gt("Add action")}</MenuItemLabel>
      </MenuItem>
    </>
  );

  return (
    <>
      {presentation === "menu" ? (
        <>
          {primaryScript && (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              disabled={!onRunScript}
              onClick={() => onRunScript?.(primaryScript)}
            >
              <ScriptIcon icon={primaryScript.icon} className="size-4" />
              <MenuItemLabel>
                <T>
                  Run <Var>{primaryScript.name}</Var>
                </T>
              </MenuItemLabel>
              <MenuShortcut>
                {shortcutLabelForCommand(keybindings, commandForProjectScript(primaryScript.id))}
              </MenuShortcut>
            </MenuItem>
          )}
          {scripts.length > 0 || importableScripts.length > 0 ? (
            <MenuSub
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) => openActionsMenu({ scripts: open, imports: false })}
            >
              <MenuSubTrigger density="touch">
                <ScriptIcon icon="play" className="size-4" />
                <MenuItemLabel>
                  <T>Project actions</T>
                </MenuItemLabel>
              </MenuSubTrigger>
              <MenuSubPopup>{scriptItems}</MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              onClick={openAddDialog}
            >
              <PlusIcon className="size-4" />
              <MenuItemLabel>
                <T>Add project action…</T>
              </MenuItemLabel>
            </MenuItem>
          )}
        </>
      ) : primaryScript ? (
        isPanel ? (
          <div
            role="group"
            aria-label={gt("Project scripts")}
            ref={groupAnchorRef}
            className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="xs"
                    variant="ghost"
                    part="primary"
                    panel
                    aria-label={gt("Run {name}", { name: primaryScript.name })}
                    // Tooltip replaces the button data-slot, so toolbar theming needs a separate hook.
                    data-toolbar-control=""
                    aria-disabled={!onRunScript || undefined}
                    onClick={() => onRunScript?.(primaryScript)}
                  />
                }
              >
                <ScriptIcon icon={primaryScript.icon} className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                  {primaryScript.name}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">
                {onRunScript
                  ? gt("Run {name}", { name: primaryScript.name })
                  : gt("Pair this client again with permission to run terminal commands.")}
              </TooltipPopup>
            </Tooltip>
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
            <Menu
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) => openActionsMenu({ scripts: open, imports: false })}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <ThreadDetailsControl
                          size="sm"
                          variant="ghost"
                          part="secondary"
                          panel
                          aria-label={gt("Script actions")}
                          data-toolbar-control=""
                        />
                      }
                    />
                  }
                >
                  <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  <T>Script actions</T>
                </TooltipPopup>
              </Tooltip>
              <MenuPopup
                align="end"
                anchor={groupAnchorRef}
                finalFocus={handleMenuFinalFocus}
                className="w-(--anchor-width)"
              >
                {scriptItems}
              </MenuPopup>
            </Menu>
          </div>
        ) : (
          <div
            role="group"
            aria-label={gt("Project scripts")}
            ref={groupAnchorRef}
            className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-(--control-radius) border border-border bg-transparent sm:h-7"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ComposerControl
                    size="sm"
                    className="h-full w-8 rounded-none border-0 px-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-100 sm:w-7"
                    aria-label={gt("Run {name}", { name: primaryScript.name })}
                    data-toolbar-control=""
                    aria-disabled={!onRunScript || undefined}
                    onClick={() => onRunScript?.(primaryScript)}
                  />
                }
              >
                <ScriptIcon icon={primaryScript.icon} className="size-4 sm:size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {onRunScript
                  ? gt("Run {name}", { name: primaryScript.name })
                  : gt("Pair this client again with permission to run terminal commands.")}
              </TooltipPopup>
            </Tooltip>
            <span aria-hidden="true" className="h-full w-px shrink-0 bg-border" />
            <Menu
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) => openActionsMenu({ scripts: open, imports: false })}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <ComposerControl
                          size="sm"
                          className="h-full w-6 rounded-none border-0 px-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-100 data-popup-open:bg-accent data-popup-open:text-foreground sm:w-5.5"
                          aria-label={gt("Script actions")}
                          data-toolbar-control=""
                        />
                      }
                    />
                  }
                >
                  <ChevronDownIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  <T>Script actions</T>
                </TooltipPopup>
              </Tooltip>
              <MenuPopup align="start" anchor={groupAnchorRef} finalFocus={handleMenuFinalFocus}>
                {scriptItems}
              </MenuPopup>
            </Menu>
          </div>
        )
      ) : scripts.length > 0 || importableScripts.length > 0 ? (
        isPanel ? (
          <div
            role="group"
            aria-label={gt("Project actions")}
            className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}
            ref={groupAnchorRef}
          >
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="primary"
              aria-label={gt("Project actions")}
              onClick={() => openActionsMenu({ scripts: false, imports: true })}
            >
              <WrenchIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                <T context="project actions menu">Actions</T>
              </span>
            </ThreadDetailsControl>
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
            <Menu
              highlightItemOnHover={false}
              open={actionsMenuOpen.imports}
              onOpenChange={(open) => openActionsMenu({ scripts: false, imports: open })}
            >
              <MenuTrigger
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="secondary"
                    aria-label={gt("Choose project action")}
                  />
                }
              >
                <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
              </MenuTrigger>
              <MenuPopup
                align="end"
                anchor={groupAnchorRef}
                finalFocus={handleMenuFinalFocus}
                className="w-(--anchor-width)"
              >
                {scriptItems}
              </MenuPopup>
            </Menu>
          </div>
        ) : (
          <Menu
            highlightItemOnHover={false}
            open={actionsMenuOpen.imports}
            onOpenChange={(open) => openActionsMenu({ scripts: false, imports: open })}
          >
            <MenuTrigger
              render={
                <ComposerControl
                  size="sm"
                  className="h-8 gap-1 border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground sm:h-7"
                  aria-label={gt("Project actions")}
                />
              }
            >
              <WrenchIcon className="size-3.5" />
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" finalFocus={handleMenuFinalFocus}>
              {scriptItems}
            </MenuPopup>
          </Menu>
        )
      ) : isPanel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="xs"
                variant="ghost"
                part="row"
                panel
                aria-label={gt("Add project script")}
                data-toolbar-control=""
                onClick={openAddDialog}
              />
            }
          >
            <PlusIcon className="size-4 sm:size-3.5" />
            <span className={cn("ml-0.5", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              {gt("Add project script")}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Add project script")}</TooltipPopup>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <ComposerControl
                size="sm"
                className="h-8 w-8 border-border px-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-7 sm:w-7"
                aria-label={gt("Add action")}
                data-toolbar-control=""
                onClick={openAddDialog}
              />
            }
          >
            <PlusIcon className="size-4 sm:size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Add action")}</TooltipPopup>
        </Tooltip>
      )}

      <ProjectScriptEditorDialog
        environmentId={environmentId}
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={(scriptId) => void onDeleteScript(scriptId)}
        onClose={() => setEditorRequest(null)}
      />
    </>
  );
}
