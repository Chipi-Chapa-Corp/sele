import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The end of the right panel's nested tab row, where the shown surface puts its own controls. */
export const RightPanelTabActionsSlot = createContext<HTMLElement | null>(null);

export function useRightPanelTabActionsSlot() {
  return use(RightPanelTabActionsSlot);
}

export function RightPanelTabActions(props: { slot: HTMLElement; children: ReactNode }) {
  return createPortal(props.children, props.slot);
}
