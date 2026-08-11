import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/pricing", label: "Pricing" },
  { to: "/editor", label: "Studio" },
] as const;

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground font-display text-lg">
            R
          </span>
          <span className="font-display text-lg tracking-tight">Relievo Studio</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-sm text-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
          {!loading && user ? (
            <>
              <Link to="/account" className="text-sm text-muted-foreground hover:text-foreground">
                Account
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
          )}
          <Link to="/editor">
            <Button size="sm">Start a portrait</Button>
          </Link>
        </nav>

        <button
          className="md:hidden rounded-sm border border-border p-2"
          aria-label="Toggle menu"
          onClick={() => setOpen((value) => !value)}
        >
          <Menu className="size-4" />
        </button>
      </div>

      {open ? (
        <div className="border-t border-border/70 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} onClick={() => setOpen(false)} className="text-sm">
                {item.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link to="/account" onClick={() => setOpen(false)} className="text-sm">
                  Account
                </Link>
                <button className="text-left text-sm text-muted-foreground" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/auth" onClick={() => setOpen(false)} className="text-sm">
                Sign in
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
