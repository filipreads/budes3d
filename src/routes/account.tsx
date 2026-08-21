import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccountShell } from "@/components/account/AccountShell";

export const Route = createFileRoute("/account")({
  component: AccountLayout,
});

function AccountLayout() {
  return (
    <AccountShell>
      <Outlet />
    </AccountShell>
  );
}
