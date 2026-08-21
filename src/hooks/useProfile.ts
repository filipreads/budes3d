import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAccountProfile, type AccountProfile } from "@/lib/account.functions";

/**
 * Single source of truth for the signed-in customer's profile. Header, account
 * overview, settings and checkout all read this one cache entry so the name,
 * avatar, language and shipping address never drift apart.
 */
export function useProfile() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<AccountProfile>({
    queryKey: ["account-profile", user?.id],
    queryFn: () => getAccountProfile(),
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  return {
    profile: query.data ?? null,
    isLoading: loading || query.isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["account-profile", user?.id] }),
  };
}
