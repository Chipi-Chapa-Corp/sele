import { create } from "zustand";

import type { ThreadDetailsUsageInput } from "./components/chat/ThreadDetailsUsage";

export type ActiveThreadUsage = Omit<ThreadDetailsUsageInput, "contextWindow">;

/** The main view's thread usage, for the sidebar, which renders outside that view. */
export const useActiveThreadUsageStore = create<{ usage: ActiveThreadUsage | null }>(() => ({
  usage: null,
}));

export function publishActiveThreadUsage(usage: ActiveThreadUsage | null) {
  useActiveThreadUsageStore.setState({ usage });
}
