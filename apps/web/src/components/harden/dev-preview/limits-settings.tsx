import { DevPreviewLimits } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { NumberField } from "@/components/common/number-field";
import { SettingRow, SettingsSection } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { devPreviewKey } from "./use-dev-preview";

const field = { wrapperClassName: "w-24", className: "h-8 text-xs" };

/**
 * Settings > Dev previews: how many previews may run at once, the ports they are given, and
 * one button that stops them all. The dev commands themselves are set per project.
 */
export function DevPreviewLimitsSettings() {
  const client = useClient();
  const queryClient = useQueryClient();
  const key = [...devPreviewKey, "limits"] as const;
  const view = useQuery({ queryKey: key, queryFn: () => client.devPreview.limits() });
  const save = useMutation({
    mutationFn: (limits: DevPreviewLimits) => client.devPreview.setLimits(limits),
    // The form already shows what was sent. An answer isn't written back over it: by the
    // time it arrives the person may have typed on, and the newer edit is on its way.
    onError: (e) => {
      toast.error("Setting not saved", { description: e.message });
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const stopAll = useMutation({
    mutationFn: () => client.devPreview.stopAll(),
    onSuccess: ({ stopped, failed }) => {
      toast.success(stopped === 1 ? "Stopped 1 preview" : `Stopped ${stopped} previews`);
      if (failed.length > 0) {
        // The Dev Servers page lists them by name, each with its state.
        toast.error(
          failed.length === 1 ? "1 preview not stopped" : `${failed.length} not stopped`,
          {
            description: failed.map((f) => f.message).join("\n"),
          },
        );
      }
      void queryClient.invalidateQueries({ queryKey: devPreviewKey });
    },
    onError: (e) => toast.error("Previews not stopped", { description: e.message }),
  });
  const [problem, setProblem] = useState<string | null>(null);
  if (!view.data) return null;
  const { limits, remote } = view.data;
  const update = (patch: Partial<DevPreviewLimits>) => {
    const next = { ...limits, ...patch };
    queryClient.setQueryData(key, { limits: next, remote });
    // Half-typed ranges stay in the form and are saved once they make sense.
    const checked = DevPreviewLimits.safeParse(next);
    setProblem(checked.success ? null : (checked.error.issues[0]?.message ?? "Not valid"));
    if (checked.success) save.mutate(checked.data);
  };
  return (
    <div data-testid="dev-preview-limits">
      <SettingsSection
        title="Dev previews"
        description={
          remote
            ? "A project's dev server, run for a session or for the PM thread. Change these on the computer running the app."
            : "A project's dev server, run for a session or for the PM thread. The commands are set in each project's settings."
        }
      >
        <SettingRow
          label="At once in a project"
          help="Starting one more stops the oldest idle preview of that project."
        >
          <NumberField
            {...field}
            min={1}
            max={20}
            aria-label="Previews at once in a project"
            disabled={remote}
            value={limits.perProject}
            onChange={(perProject) => update({ perProject })}
          />
        </SettingRow>
        <SettingRow label="At once in all projects" help="The PM threads' previews count too.">
          <NumberField
            {...field}
            min={1}
            max={50}
            aria-label="Previews at once in all projects"
            disabled={remote}
            value={limits.total}
            onChange={(total) => update({ total })}
          />
        </SettingRow>
        <SettingRow
          label="Ports"
          help="Previews get free ports from this range, on this computer only. The app's own ports are never given out."
        >
          <div className="flex items-center gap-2 text-xs">
            <NumberField
              {...field}
              min={1024}
              max={65535}
              aria-label="First port"
              disabled={remote}
              value={limits.portFrom}
              onChange={(portFrom) => update({ portFrom })}
            />
            <span className="text-muted-foreground">to</span>
            <NumberField
              {...field}
              min={1024}
              max={65535}
              aria-label="Last port"
              disabled={remote}
              value={limits.portTo}
              onChange={(portTo) => update({ portTo })}
            />
          </div>
        </SettingRow>
        {problem && (
          <p className="px-4 py-2 text-2xs text-status-failed" role="alert">
            {problem}. Not saved yet.
          </p>
        )}
        <SettingRow label="Stop all previews" help="Ends every running preview in every project.">
          <Button
            size="sm"
            variant="outline"
            disabled={stopAll.isPending}
            onClick={() => stopAll.mutate()}
            data-testid="dev-preview-stop-all"
          >
            Stop all
          </Button>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
