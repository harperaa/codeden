import { type DevPreviewSettings, hardenDocsUrl, type Project } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEV_PREVIEW_ANCHOR,
  SecureFoundationDevPreviewNotes,
  useSecureFoundationDevPreview,
} from "@/components/harden/secure-foundation/dev-preview-offer";
import { Segmented, SettingRow, SettingsSection } from "@/components/settings/settings-ui";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { DevPreviewActions } from "./actions";
import { DevPreviewConfirmDialog } from "./confirm-dialog";
import { formChanged, formHolds, formOf, type PreviewForm, settingsOf } from "./form";
import { DevPreviewRecommendedNotes } from "./recommended";
import { devPreviewKey } from "./use-dev-preview";

const mono = "h-8 font-mono text-xs";

/**
 * Project page > Settings > Dev preview: the commands the app may run for this project.
 * They are typed here and nowhere else, and the form's button (`actions.tsx`) asks before it
 * stores them: nothing is ever taken from the repository. On another device the form is read-only.
 *
 * For a project Secure Foundation set up, the empty form starts filled in with the values that
 * work for such a project (`secureFoundationDevPreview`). That changes the form only: the same
 * button and the same confirmation stand between those values and anything being stored or run.
 * The same goes for a checkout of this product's own repository, with the values the server
 * offers for it (`recommended`, the app's own constants).
 */
export function DevPreviewProjectSettings({ project }: { project: Project }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const key = [...devPreviewKey, "project", project.id] as const;
  const view = useQuery({ queryKey: key, queryFn: () => client.devPreview.project(project.id) });
  const config = view.data?.config ?? null;
  const [form, setForm] = useState<PreviewForm>(formOf(null));
  const [asking, setAsking] = useState<DevPreviewSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const confirmedAt = config?.confirmedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when what is stored changes
  useEffect(() => setForm(formOf(config)), [confirmedAt, config?.pmEnabled]);
  // Values to start from, for a Secure Foundation project that has no settings yet. After the
  // reset above on purpose, and only into a form nobody typed in.
  const offered = useSecureFoundationDevPreview(project.id)?.settings ?? null;
  const loaded = view.data !== undefined;
  const fillable = loaded && !view.data?.remote;
  // The same for a project the server recognised as a checkout of this product's repository.
  const recommended = view.data?.recommended ?? null;
  const startFrom = fillable && !config ? (offered ?? recommended?.settings ?? null) : null;
  useEffect(() => {
    if (startFrom) setForm((current) => (formChanged(current, null) ? current : formOf(startFrom)));
  }, [startFrom]);
  // A link that names this section (the PM thread's "Set up a dev preview"): the section
  // renders after the page did, so scroll to it once it is there.
  useEffect(() => {
    if (!loaded || window.location.hash !== `#${DEV_PREVIEW_ANCHOR}`) return;
    document.getElementById(DEV_PREVIEW_ANCHOR)?.scrollIntoView?.({ block: "start" });
  }, [loaded]);

  const stored = () => {
    void queryClient.invalidateQueries({ queryKey: devPreviewKey });
    setAsking(null);
  };
  const save = useMutation({
    mutationFn: (settings: DevPreviewSettings) =>
      client.devPreview.confirmProject(project.id, settings),
    onSuccess: () => {
      stored();
      toast.success("Dev preview saved");
    },
    onError: (e) => toast.error("Dev preview not saved", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: () => client.devPreview.removeProject(project.id),
    onSuccess: (view) => {
      stored();
      if (view.notice) toast.warning("Dev preview removed", { description: view.notice });
    },
    onError: (e) => toast.error("Dev preview not removed", { description: e.message }),
  });

  if (!view.data) return null;
  const { remote, suggestion, baseBranch } = view.data;
  // The app's own fixed commands for this project's lockfile, offered to fill the fields. Both
  // at the dev command while the form is empty; afterwards the prepare command alone, at its
  // own field, for as long as that is empty (stored settings without one included).
  const offersCommand = suggestion !== null && !config && !form.command && !remote;
  const offeredPrepare =
    !remote && !offersCommand && !form.prepareCommand.trim()
      ? (suggestion?.prepareCommand ?? null)
      : null;
  const set = (patch: Partial<PreviewForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setProblem(null);
  };
  const ask = () => {
    const result = settingsOf(form);
    if (result.ok) setAsking(result.settings);
    else setProblem(result.problem);
  };
  /** Offered values into the form. The PM thread's switch stays the person's own. */
  const fill = remote
    ? undefined
    : (settings: DevPreviewSettings) => set({ ...formOf(settings), pmEnabled: form.pmEnabled });

  return (
    <div id={DEV_PREVIEW_ANCHOR} className="scroll-mt-6" data-testid="dev-preview-settings">
      <SettingsSection
        title="Dev preview"
        description="Run this project's dev server for a session, in that session's own worktree, so the page reloads as the agent works. The PM thread can have one for the base branch. Each is switched on at the top of its thread."
      >
        <SecureFoundationDevPreviewNotes
          projectId={project.id}
          filled={offered !== null && formHolds(form, offered)}
          onFill={fill}
        />
        <DevPreviewRecommendedNotes
          recommended={recommended}
          config={config}
          form={form}
          onFill={fill}
        />
        <SettingRow
          label="Dev command"
          stacked
          help={
            <>
              Your shell runs it in the worktree, with free local ports in the variables below. You
              can also write <code>{"{port}"}</code> and <code>{"{port2}"}</code> in the command.{" "}
              <code>HOST=127.0.0.1</code> is passed too, but the dev server listens however this
              command makes it listen: keep it on this computer.{" "}
              <a
                href={hardenDocsUrl("dev-preview.md")}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                How it works
              </a>
            </>
          }
        >
          <Input
            aria-label="Dev command"
            data-testid="dev-preview-command"
            className={mono}
            placeholder="pnpm dev"
            value={form.command}
            disabled={remote}
            onChange={(e) => set({ command: e.target.value })}
          />
          {offersCommand && (
            <p className="text-2xs text-muted-foreground" data-testid="dev-preview-suggestion">
              This project looks like it uses <code>{suggestion.command}</code> ({suggestion.reason}
              )
              {suggestion.prepareCommand && (
                <>
                  , with <code>{suggestion.prepareCommand}</code> to install its dependencies
                </>
              )}
              .{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  set({
                    command: suggestion.command,
                    // What the person typed there already stays theirs.
                    prepareCommand: form.prepareCommand.trim()
                      ? form.prepareCommand
                      : (suggestion.prepareCommand ?? ""),
                  })
                }
              >
                Fill it in
              </button>
            </p>
          )}
        </SettingRow>
        <SettingRow
          label="Prepare command"
          stacked
          help="Optional. Runs before the first start in a worktree and again when its lockfile changes: a fresh worktree has no installed dependencies."
        >
          <Input
            aria-label="Prepare command"
            data-testid="dev-preview-prepare"
            className={mono}
            placeholder="pnpm install --frozen-lockfile"
            value={form.prepareCommand}
            disabled={remote}
            onChange={(e) => set({ prepareCommand: e.target.value })}
          />
          {offeredPrepare && (
            <p
              className="text-2xs text-muted-foreground"
              data-testid="dev-preview-prepare-suggestion"
            >
              There is no prepare command, and a fresh checkout has no installed dependencies. This
              project looks like it installs them with <code>{offeredPrepare}</code>.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => set({ prepareCommand: offeredPrepare })}
              >
                Fill it in
              </button>
            </p>
          )}
        </SettingRow>
        <SettingRow
          label="Port variables"
          help="Each gets a free port. The first is the one the link opens."
        >
          <Input
            aria-label="Port variables"
            data-testid="dev-preview-port-vars"
            className={`${mono} w-56`}
            placeholder="PORT"
            value={form.portVars}
            disabled={remote}
            onChange={(e) => set({ portVars: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Link"
          stacked={form.urlFrom === "output"}
          help={
            form.urlFrom === "port"
              ? "http://localhost on the first port, once something answers there."
              : "The first local URL the command prints, once something answers there. For dev servers that pick their own port. A pattern narrows it down: its first group is the URL."
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<PreviewForm["urlFrom"]>
              value={form.urlFrom}
              onChange={(urlFrom) => !remote && set({ urlFrom })}
              options={[
                { value: "port", label: "First port", disabled: remote },
                { value: "output", label: "From the output", disabled: remote },
              ]}
            />
            {form.urlFrom === "output" && (
              <Input
                aria-label="URL pattern"
                className={`${mono} w-64`}
                placeholder="Local:\s+(\S+)"
                value={form.urlPattern}
                disabled={remote}
                onChange={(e) => set({ urlPattern: e.target.value })}
              />
            )}
          </div>
        </SettingRow>
        <SettingRow
          label="On the PM thread"
          help={`Keep a preview of ${baseBranch ? `the base branch (${baseBranch})` : "the base branch"} running from a checkout of its own, updated as the branch moves. Off until you switch it on, here or at the top of the PM thread.`}
        >
          <Switch
            aria-label="Dev preview on the PM thread"
            data-testid="dev-preview-pm"
            checked={form.pmEnabled}
            disabled={remote}
            onCheckedChange={(pmEnabled) => set({ pmEnabled })}
          />
        </SettingRow>
        <DevPreviewActions
          projectId={project.id}
          view={view.data}
          form={form}
          problem={problem}
          saving={save.isPending}
          removing={remove.isPending}
          onAsk={ask}
          onRemove={() => remove.mutate()}
        />
      </SettingsSection>
      <DevPreviewConfirmDialog
        asking={asking}
        baseBranch={baseBranch}
        saving={save.isPending}
        onConfirm={(settings) => save.mutate(settings)}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
