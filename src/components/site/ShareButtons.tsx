import { useState } from "react";
import { Check, Copy, Facebook, Linkedin, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * One share row reused by the account order card and the public preview page,
 * so every share entry point offers the same options and wording.
 */
export function ShareButtons({ url, title, className }: { url: string; title?: string; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = title || t("shareButtons.text");

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({ title: text, url });
        return;
      } catch {
        /* user dismissed — fall through to copy */
      }
    }
    await copy();
  }

  const links = [
    { href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`, label: t("shareButtons.x"), icon: XIcon },
    { href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, label: t("shareButtons.facebook"), icon: Facebook },
    { href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`, label: t("shareButtons.linkedin"), icon: Linkedin },
  ];

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
        {copied ? <Check className="mr-1.5 size-4" aria-hidden /> : <Copy className="mr-1.5 size-4" aria-hidden />}
        {copied ? t("shareButtons.copied") : t("shareButtons.copy")}
      </Button>
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <Button key={link.label} asChild size="icon" variant="ghost" aria-label={link.label} title={link.label}>
            <a href={link.href} target="_blank" rel="noreferrer noopener">
              <Icon className="size-4" aria-hidden />
            </a>
          </Button>
        );
      })}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="sm:hidden"
        aria-label={t("shareButtons.native")}
        onClick={() => void nativeShare()}
      >
        <Share2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.5l-5.1-6.7L5.8 22H2.7l7.6-8.7L1.2 2h6.7l4.6 6.1L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" />
    </svg>
  );
}
