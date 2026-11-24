import {
  isLoginRunning,
  type SecureFoundationLogin,
  type SecureFoundationService,
} from "@codeden/contracts";
import { useEffect, useRef, useState } from "react";
import { useClient } from "@/lib/api";

/**
 * One service's login, run by the service's own command-line tool on the computer running the
 * app: start it, follow it, cancel it. The link and the code stay in the component that uses
 * this: no store, no cache.
 */
export function useServiceLogin(
  service: SecureFoundationService,
  /** A login ended: the checks are worth running again. */
  onChanged: () => void,
) {
  const client = useClient();
  const [login, setLogin] = useState<SecureFoundationLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = login !== null && isLoginRunning(login);
  const loginId = login?.id;
  // Poll while the login runs.
  useEffect(() => {
    if (!loginId || !running) return;
    const timer = setInterval(() => {
      void client.secureFoundation.login(loginId).then(
        (next) => {
          setLogin(next);
          if (!isLoginRunning(next)) onChanged();
        },
        () => setLogin(null),
      );
    }, 1500);
    return () => clearInterval(timer);
  }, [client, loginId, running, onChanged]);
  // Leaving the view stops a login that is still waiting.
  const latest = useRef(login);
  latest.current = login;
  useEffect(
    () => () => {
      const open = latest.current;
      if (open && isLoginRunning(open))
        void client.secureFoundation.cancelLogin(open.id).catch(() => {});
    },
    [client],
  );

  const start = () => {
    setError(null);
    client.secureFoundation.startLogin(service).then(setLogin, (e: Error) => setError(e.message));
  };
  const cancel = () => {
    if (login)
      void client.secureFoundation.cancelLogin(login.id).then(setLogin, () => setLogin(null));
  };
  return { login, error, running, start, cancel };
}
