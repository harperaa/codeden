import { HARDEN_APP_SLUG, type SecureFoundationAccountId } from "@codeden/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AccountState {
  /** The accounts the person said they have, for those nothing on this computer can check. */
  confirmed: Partial<Record<SecureFoundationAccountId, true>>;
  setConfirmed: (id: SecureFoundationAccountId, has: boolean) => void;
}

/**
 * "I have an account", for a service whose sign-in can't be seen from this computer (Clerk).
 * Kept in this browser only, as the other small preferences are: the server never hears of it,
 * nothing checks or blocks on it, and nothing about the account is stored, only the yes.
 */
export const useSecureFoundationAccounts = create<AccountState>()(
  persist(
    (set) => ({
      confirmed: {},
      setConfirmed: (id, has) =>
        set((s) => {
          const { [id]: _was, ...rest } = s.confirmed;
          return { confirmed: has ? { ...rest, [id]: true } : rest };
        }),
    }),
    { name: `${HARDEN_APP_SLUG}.secure-foundation-accounts` },
  ),
);
