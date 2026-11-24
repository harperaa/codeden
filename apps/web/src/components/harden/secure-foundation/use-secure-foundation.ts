import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/api";

export const secureFoundationKey = ["secure-foundation"] as const;

/** Whether this build has the option, the providers that can run it and the form's defaults. */
export function useSecureFoundationOptions(enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: [...secureFoundationKey, "options"],
    queryFn: () => client.secureFoundation.options(),
    staleTime: 60_000,
    enabled,
  });
}

/** The template's current commit and modules; fetched when the form opens. */
export function useSecureFoundationTemplate(enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: [...secureFoundationKey, "template"],
    queryFn: () => client.secureFoundation.template(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled,
  });
}

/** Suggestions for the form. Never cached past the form: it is the person's own data. */
export function useSecureFoundationPrefill(enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: [...secureFoundationKey, "prefill"],
    queryFn: () => client.secureFoundation.prefill(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled,
  });
}

/**
 * The tools and sign-ins every setup needs, checked on the computer running the app when the
 * dialog opens and again on "Check again". Never kept past the dialog.
 */
export function useSecureFoundationRequirements(enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: [...secureFoundationKey, "requirements"],
    queryFn: () => client.secureFoundation.requirements(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    enabled,
  });
}
