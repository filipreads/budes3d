import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-stone-deep">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="font-display text-xl">Relievo Studio</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Portrait photographs turned into sculpted 3D objects — download the file or receive the printed
            piece, cast and finished by hand.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Studio</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/editor" className="hover:text-foreground">
                Start a portrait
              </Link>
            </li>
            <li>
              <Link to="/pricing" className="hover:text-foreground">
                Pricing
              </Link>
            </li>
            <li>
              <Link to="/account" className="hover:text-foreground">
                Your orders
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Support</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>hello@relievo.studio</li>
            <li>Mon–Fri, 9–17 CET</li>
            <li>Worldwide shipping</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70 px-5 py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Relievo Studio. All rights reserved.
      </div>
    </footer>
  );
}
