import { useRef, useState } from 'react'
import type { AppProject, AppProjectIcon } from '../../../../shared/app'
import type { ProviderCwdNote } from '../../../../shared/provider'
import { readStoredCollapsedProjectGroups } from '../../collapsedProjectGroups'
import { usePreferenceState } from '../../usePreferenceState'
import {
  allDoneProjectsValue,
  readChatGroupingPreference,
  type ChatGroupingPreference
} from '../controllerTypes'

export function useWorkspaceProjectState() {
  const [projects, setProjects] = useState<AppProject[]>([])

  const [deletedProjectCwds, setDeletedProjectCwds] = useState<Set<string>>(() => new Set())

  const [deletingProject, setDeletingProject] = useState(false)

  const deletingProjectRef = useRef(false)

  const [projectDialogOpen, setProjectDialogOpen] = useState(false)

  const [editingProjectCwd, setEditingProjectCwd] = useState<string | null>(null)

  const [chatGroupingPreference, setChatGroupingPreference] =
    usePreferenceState<ChatGroupingPreference>(readChatGroupingPreference)

  const [collapsedCwdGroups, setCollapsedCwdGroups] = usePreferenceState<Record<string, boolean>>(
    readStoredCollapsedProjectGroups
  )

  const [draggedProjectGroupKey, setDraggedProjectGroupKey] = useState<string | null>(null)

  const [projectDropInsertionIndex, setProjectDropInsertionIndex] = useState<number | null>(null)

  const [visibleChatPageCountsByGroup, setVisibleChatPageCountsByGroup] = useState<
    Record<string, number>
  >({})

  const [doneProjectFilterValue, setDoneProjectFilterValue] = useState(allDoneProjectsValue)

  const [cwdNotesByGroup, setCwdNotesByGroup] = useState<Record<string, ProviderCwdNote[]>>({})

  const [projectIconsByGroup, setProjectIconsByGroup] = useState<
    Record<string, AppProjectIcon | null>
  >({})

  const projectOrderMutationRef = useRef(0)

  const expandedProjectGroupsBeforeDragRef = useRef<Set<string> | null>(null)

  const draggedProjectGroupKeyRef = useRef<string | null>(null)

  const projectDropInsertionIndexRef = useRef<number | null>(null)

  const projectCollapseFrameRef = useRef<number | null>(null)

  const loadingCwdNotesRef = useRef(new Set<string>())

  const loadingProjectIconsRef = useRef(new Set<string>())
  return {
    projects,
    setProjects,
    deletedProjectCwds,
    setDeletedProjectCwds,
    deletingProject,
    setDeletingProject,
    deletingProjectRef,
    projectDialogOpen,
    setProjectDialogOpen,
    editingProjectCwd,
    setEditingProjectCwd,
    chatGroupingPreference,
    setChatGroupingPreference,
    collapsedCwdGroups,
    setCollapsedCwdGroups,
    draggedProjectGroupKey,
    setDraggedProjectGroupKey,
    projectDropInsertionIndex,
    setProjectDropInsertionIndex,
    visibleChatPageCountsByGroup,
    setVisibleChatPageCountsByGroup,
    doneProjectFilterValue,
    setDoneProjectFilterValue,
    cwdNotesByGroup,
    setCwdNotesByGroup,
    projectIconsByGroup,
    setProjectIconsByGroup,
    projectOrderMutationRef,
    expandedProjectGroupsBeforeDragRef,
    draggedProjectGroupKeyRef,
    projectDropInsertionIndexRef,
    projectCollapseFrameRef,
    loadingCwdNotesRef,
    loadingProjectIconsRef
  }
}
