import type { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

export interface VcsWorkingTreeInvalidationTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

const revisionByWorkingTree = Atom.family((key: string) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:vcs:working-tree-revision:${key}`),
  ),
);

export function vcsWorkingTreeRevisionAtom(target: VcsWorkingTreeInvalidationTarget) {
  return revisionByWorkingTree(JSON.stringify([target.environmentId, target.cwd]));
}

export function invalidateVcsWorkingTree(
  registry: AtomRegistry.AtomRegistry,
  target: VcsWorkingTreeInvalidationTarget,
): void {
  registry.update(vcsWorkingTreeRevisionAtom(target), (revision) => revision + 1);
}
