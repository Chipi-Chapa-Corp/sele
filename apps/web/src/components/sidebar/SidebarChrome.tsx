import { ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useGT } from "gt-react";
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  actions,
}: {
  isElectron: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleUsageClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/usage" });
  };

  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant="ghost"
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      <div className="relative z-10 flex h-8 min-w-0 flex-1 items-center justify-end gap-0.5 md:ml-[var(--workspace-titlebar-content-left)]">
        {actions}
        <SidebarHeaderIconButton
          label={gt("Usage")}
          className="[-webkit-app-region:no-drag]"
          onClick={handleUsageClick}
        >
          <ChartNoAxesColumnIcon />
        </SidebarHeaderIconButton>
        <SidebarHeaderIconButton
          label={gt("Settings")}
          className="[-webkit-app-region:no-drag]"
          onClick={handleSettingsClick}
        >
          <SettingsIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
});
