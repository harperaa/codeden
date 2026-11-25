import {
  CreateSecureFoundationRequest,
  type CreateSecureFoundationResponse,
  type SecureFoundationTemplate,
} from "@codeden/contracts";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useClient } from "@/lib/api";
import { createRequestOf, type FormAnswers } from "./answers";
import {
  canGo,
  runVerification,
  type Verification,
  withAnswersChanged,
  withCreateFailure,
} from "./verify";

export interface Go {
  /** The last run's results; null before the first. */
  result: Verification | null;
  busy: null | "checking" | "creating";
  /** Run the checks and show them. */
  check: () => Promise<void>;
  /**
   * Check, then create when everything allows it. False: nothing was created, see `result`.
   * An attempt ends with the dialog: closed while it checks, it creates nothing.
   */
  go: (from: "form" | "view") => Promise<boolean>;
}

/**
 * Go: verify first, then create. One pass of checks, no request to create while one of them
 * holds, and a create the server refuses comes back as a failed check with its reason.
 */
export function useGo({
  answers,
  setAnswers,
  shownCommit,
  onTemplate,
  onCreated,
}: {
  answers: FormAnswers;
  setAnswers: Dispatch<SetStateAction<FormAnswers>>;
  /** The commit the form shows now. */
  shownCommit: string | undefined;
  /** The checks resolved the template: the form shows this commit from now on. */
  onTemplate: (template: SecureFoundationTemplate) => void;
  onCreated: (created: CreateSecureFoundationResponse) => void;
}): Go {
  const client = useClient();
  const [result, setResult] = useState<Verification | null>(null);
  const [busy, setBusy] = useState<Go["busy"]>(null);
  const running = useRef(false);
  const latest = useRef({ answers, shownCommit, onTemplate, onCreated });
  latest.current = { answers, shownCommit, onTemplate, onCreated };
  // Closing the dialog ends an attempt: checks still in flight never lead to a create.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const verify = useCallback(async () => {
    const now = latest.current;
    const verification = await runVerification(client, now.answers, now.shownCommit);
    if (!open.current) return null;
    // What was checked is what gets created: answers edited meanwhile are checked again first.
    const changed = latest.current.answers !== now.answers;
    const answered = { ...now.answers, ...verification.patch };
    if (!changed && Object.keys(verification.patch).length > 0) {
      setAnswers((a) => ({ ...a, ...verification.patch }));
    }
    if (verification.template) now.onTemplate(verification.template);
    const shown = changed
      ? { ...verification, items: withAnswersChanged(verification.items) }
      : verification;
    setResult(shown);
    return { verification: shown, answered };
  }, [client, setAnswers]);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy("checking");
    try {
      await verify();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, [verify]);

  const go = useCallback(
    async (from: "form" | "view") => {
      if (running.current) return false;
      running.current = true;
      setBusy("checking");
      try {
        const checked = await verify();
        // Closed meanwhile: nothing is created and nothing is shown.
        if (!checked) return true;
        const { verification, answered } = checked;
        if (!canGo(verification, from) || !verification.template) return false;
        setBusy("creating");
        try {
          const request = createRequestOf(answered, verification.template.commit);
          const created = await client.secureFoundation.create(
            CreateSecureFoundationRequest.parse(request),
          );
          if (open.current) latest.current.onCreated(created);
          return true;
        } catch (error) {
          setResult({ ...verification, items: withCreateFailure(verification.items, error) });
          return false;
        }
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [client, verify],
  );

  return { result, busy, check, go };
}
