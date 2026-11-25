import type { EnvironmentId, ProjectScript } from "@t3tools/contracts";

import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";

export interface ComposerProjectActionsProps {
  environmentId: EnvironmentId;
  cwd: string | null;
  scripts: ReadonlyArray<ProjectScript>;
  preferredScriptId: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function ComposerProjectActions(props: ComposerProjectActionsProps) {
  const t3File = useT3ProjectFileState(props.environmentId, props.cwd);
  return (
    <ProjectScriptsControl
      environmentId={props.environmentId}
      scripts={props.scripts}
      fileScripts={t3File.scripts}
      onActionsMenuOpen={t3File.refresh}
      preferredScriptId={props.preferredScriptId}
      onRunScript={props.onRunScript}
      onAddScript={props.onAddScript}
      onUpdateScript={props.onUpdateScript}
      onDeleteScript={props.onDeleteScript}
    />
  );
}
