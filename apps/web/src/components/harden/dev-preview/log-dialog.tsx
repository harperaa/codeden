import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClient } from "@/lib/api";
import { devPreviewKey } from "./use-dev-preview";

/**
 * What a preview's commands printed, fetched while the dialog is open. It is the project's
 * own output, like a terminal's: it stays out of the transcript and is never stored.
 */
export function DevPreviewLogDialog({
  previewKey,
  onClose,
}: {
  previewKey: string;
  onClose: () => void;
}) {
  const client = useClient();
  const log = useQuery({
    queryKey: [...devPreviewKey, "log", previewKey],
    queryFn: () => client.devPreview.log(previewKey),
    refetchInterval: 2_000,
    gcTime: 0,
  });
  const lines = log.data?.lines ?? [];
  const end = useRef<HTMLPreElement>(null);
  const count = lines.length;
  // Follow the output, as a terminal does.
  useEffect(() => {
    if (count > 0 && end.current) end.current.scrollTop = end.current.scrollHeight;
  }, [count]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dev preview log</DialogTitle>
          <DialogDescription>
            The output of the prepare and dev commands since the preview was last started.
          </DialogDescription>
        </DialogHeader>
        <pre
          ref={end}
          data-testid="dev-preview-log"
          className="max-h-[60vh] min-h-32 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap wrap-anywhere text-muted-foreground scroll-thin"
        >
          {log.isPending ? "Loading…" : lines.length > 0 ? lines.join("\n") : "Nothing yet."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
