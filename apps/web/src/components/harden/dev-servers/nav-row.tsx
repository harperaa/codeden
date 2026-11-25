import { MonitorPlay } from "lucide-react";
import { NavRow } from "@/components/shell/sidebar/nav-row";
import { devServerActive, useDevServerList } from "./use-dev-servers";

/**
 * The sidebar's entry for the Dev Servers page, with the number of dev servers that are coming
 * up or running. The count asks rarely by itself and is refreshed whenever a preview is
 * switched on or off in this window.
 */
export function DevServersNavRow() {
  const { data } = useDevServerList({ background: true });
  const running = data?.servers.filter(devServerActive).length ?? 0;
  return (
    <NavRow href="/dev-servers" link={{ to: "/dev-servers" }}>
      <MonitorPlay className="size-4 text-muted-foreground" />
      <span className="flex-1">Dev Servers</span>
      {running > 0 && (
        <span
          className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sidebar-accent px-1.5 text-3xs font-semibold text-sidebar-foreground tabular-nums"
          title={`${running} running`}
          data-testid="dev-servers-count"
        >
          {running}
        </span>
      )}
    </NavRow>
  );
}
