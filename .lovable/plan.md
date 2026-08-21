# Mazání projektů + vylepšené studio

## 1. Smazání projektu

Nové tlačítko "Smazat" u každého projektu v **Moje projekty** (a v dashboardu) s potvrzovacím dialogem.

Pravidlo: projekt, na který navazuje objednávka, **smazat nelze**. Tlačítko je v tom případě neaktivní a zobrazí se vysvětlení ("Projekt je součástí objednávky ORD-… a kvůli fakturaci a stahování souborů ho nelze smazat").

Co se při mazání odstraní:
- řádek projektu v databázi,
- nahraná zdrojová fotka a vygenerovaný 3D model v úložišti (aby nezůstávaly osiřelé soubory).

## 2. Studio (editor) — vylepšení

**Práce s fotkou**
- Drag & drop nahrávání + náhled "před / po" retuši (přepínač).
- Ořez a otočení fotky (čtvercový/portrétní rám, rotace po 90°, jemné doladění).
- Kontrola kvality snímku: varování při malém rozlišení, rozmazání nebo velmi tmavé fotce, ještě před generováním.

**3D náhled**
- Přehlednější ovládání kamery: přednastavené pohledy (zepředu / bok / shora), reset, zoom, fullscreen.
- Přepínač wireframe / materiál a světla (už částečně existuje, sjednotí se do jednoho panelu).
- Zobrazení měřítka: rozměry v mm podle zvolené velikosti a referenční objekt pro představu.

**Pozicování modelu**
- Ruční doladění modelu vůči podstavci: otočení kolem svislé osy, náklon, posun nahoru/dolů a měřítko.
- Tlačítko "Automaticky vycentrovat" a "Vrátit původní".
- Zvolené pozicování se ukládá k projektu a použije se i pro export STL/GLB a pro sdílený náhled, aby zákazník dostal přesně to, co schválil.

**Průběh a chyby**
- Odhad zbývajícího času a jasnější popis každé fáze.
- Tlačítka "Zrušit" a "Zkusit znovu" u běžícího/selhaného generování.
- Automatické uložení rozpracovaného projektu (fotka, retuš, konfigurace), aby se po zavření karty nic neztratilo.

**Konfigurátor a ceny**
- Trvale viditelné shrnutí ceny (sticky panel) s rozpisem položek, které se aktualizuje okamžitě.
- Porovnání materiálů a velikostí s rozdílem ceny přímo u výběru.

Vše dvojjazyčně (EN/CS).

## Technické poznámky

- `deleteProject` server function (`src/lib/studio.functions.ts`) pod `requireSupabaseAuth`: ověří vlastnictví, odmítne projekt s navázanou objednávkou, smaže soubory z bucketů `portrait-uploads` / `portrait-models` a pak řádek projektu.
- `projects` už má RLS `own projects ALL`, takže není potřeba migrace pro mazání; přidá se sloupec pro pozicování modelu (uloží se do stávajícího `config` / `edit_settings` JSON, bez nové migrace).
- Ořez/rotace se doplní do `src/lib/image-edits.ts` (canvas, klientsky), kontrola kvality také klientsky.
- Pozicování a měřítko se přidá do `src/components/studio/ModelStage.tsx` a promítne do `src/lib/mesh-export.ts` při exportu STL/GLB.
- Průběh, autosave a sticky cenový panel v `src/routes/editor.tsx`; nové klíče v `src/lib/i18n.tsx`.
