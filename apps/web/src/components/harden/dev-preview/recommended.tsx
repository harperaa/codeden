import {
  type DevPreviewConfig,
  type DevPreviewRecommended,
  type DevPreviewSettings,
  devPreviewNeedsRecommendedPorts,
} from "@codeden/contracts";
import { formHolds, type PreviewForm } from "./form";

/**
 * In the dev preview's settings form of a project the app recognised (a checkout of its own
 * repository): that the fields are filled in with the settings that work for it, or, when the
 * stored settings run its dev command without the port variables it reads, that they can't work
 * and a button that puts the recommended ones in the form.
 *
 * Filling in only changes the form: the form's own button and its confirmation stand between
 * these values and anything being stored or run. Renders nothing for any other project, and
 * nothing when the stored settings are fine.
 */
export function DevPreviewRecommendedNotes({
  recommended,
  config,
  form,
  onFill,
}: {
  recommended: DevPreviewRecommended | null;
  /** What is stored, or null. */
  config: DevPreviewConfig | null;
  form: PreviewForm;
  /** Put the recommended values in the form; absent where the form is read-only. */
  onFill?: (settings: DevPreviewSettings) => void;
}) {
  if (!recommended) return null;
  const { settings, reason } = recommended;
  const filled = formHolds(form, settings);
  const fill = (label: string) =>
    !filled &&
    onFill && (
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:text-foreground"
        onClick={() => onFill(settings)}
        data-testid="dev-preview-recommended-fill"
      >
        {label}
      </button>
    );
  if (!config) {
    return (
      <p className="px-4 py-3.5 text-2xs" data-testid="dev-preview-recommended">
        <span className="font-medium">{reason}.</span>{" "}
        <span className="text-muted-foreground">
          {filled
            ? "The fields below are filled in with the values that work for it. Nothing is stored or run until you confirm them."
            : "The fields below can be filled in with the values that work for it. Nothing is stored or run until you confirm them."}
        </span>{" "}
        {fill("Fill them in")}
      </p>
    );
  }
  if (!devPreviewNeedsRecommendedPorts(config, settings)) return null;
  return (
    <p className="px-4 py-3.5 text-2xs" data-testid="dev-preview-recommended-ports" role="status">
      <span className="font-medium text-status-failed">These settings can't start a preview.</span>{" "}
      <span className="text-muted-foreground">
        This dev command reads its ports from <code>{settings.portVars.join(", ")}</code>, in that
        order, and the stored port variables are <code>{config.portVars.join(", ")}</code>.{" "}
        {filled &&
          "The fields now hold the recommended settings. Press Save changes… to confirm them."}
      </span>{" "}
      {fill("Use the recommended settings")}
    </p>
  );
}
