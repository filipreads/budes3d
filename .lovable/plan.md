# Kvalita náhledu, jednotný profil a doručovací adresa

## 1. Ruční přepínač kvality 3D náhledu

Dnes se kvalita detekuje podle zařízení a přepnout ji lze jen malým tlačítkem v překryvu prohlížeče. Doplním plnohodnotnou volbu:

- Tři stavy místo dvou: **Automaticky** (detekce zařízení, výchozí), **Standardní**, **Úsporná**. Volba se ukládá lokálně a platí ve všech náhledech (editor, objednávky, sdílený odkaz).
- V nastavení účtu přibude sekce „3D náhled" s popiskem, co úsporný režim vypíná (stíny, antialiasing, automatické otáčení, nižší rozlišení).
- Tlačítko v prohlížeči zůstane, ale bude cyklovat mezi standardní a úspornou a jasně ukáže, že jde o ruční volbu (přebije detekci).

## 2. Sjednocení uživatelských profilů

Údaje o uživateli se dnes načítají na několika místech zvlášť (přehled účtu, nastavení, hlavička). Sjednotím je:

- Jeden sdílený hook `useProfile` nad existující serverovou funkcí `getAccountProfile`, jedna cache pro celou aplikaci, jedno místo pro invalidaci po uložení.
- Hlavička webu bude zobrazovat avatar a jméno ze stejného zdroje (dnes tam profil chybí).
- Přehled účtu i nastavení přestanou volat profil duplicitně; jazyk (`preferred_locale`) se bude načítat z profilu po přihlášení konzistentně.

## 3. Uložená doručovací adresa

- Do profilu se doplní výchozí doručovací adresa (jméno, ulice, doplněk, město, PSČ, země, telefon volitelně) — nová tabulka/sloupce chráněné RLS tak, aby k nim měl přístup jen vlastník.
- V nastavení účtu nová karta „Doručovací adresa" s formulářem a uložením.
- V pokladně se adresa předvyplní z profilu, s volbou „Použít jinou adresu" a zaškrtávátkem „Uložit jako výchozí". Validace zůstává na serveru — u tištěných produktů je adresa dál povinná.
- Vše v EN i CS.

## Technické detaily

- `src/lib/viewer-quality.ts`: typ rozšířit na `"auto" | "high" | "low"`, `detectViewerQuality()` rozdělit na uloženou preferenci vs. detekci; `ModelStage.tsx` čte efektivní kvalitu.
- Nový `src/hooks/useProfile.ts` (TanStack Query, klíč `["account-profile", userId]`), použitý v `SiteHeader`, `account.index`, `account.settings`.
- Migrace: přidat do `public.profiles` sloupec `shipping_address jsonb` (stávající RLS „own profile" už stačí, GRANTy tabulka má).
- `src/lib/account.functions.ts`: `getAccountProfile` vrátí adresu, `updateAccountProfile` ji umí uložit (validace přes zod).
- `src/routes/checkout.tsx`: předvyplnění z profilu, volitelné uložení přes `updateAccountProfile`.
- Nové klíče v `src/lib/i18n.tsx` (EN/CS).
