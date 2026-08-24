# Studio upgrade, positioning controls a vizuální kvalita

## Co se změní

### 1. Umístění modelu i podstavce (hlavní novinka)
- **Tažení přímo v 3D náhledu**: sochu i podstavec bude možné chytit myší/prstem a posunout po ploše. Držení modifikátoru (nebo přepínač v panelu) přepne tažení na svislý posun (výška/lift). Během tažení se automaticky vypne auto-rotace, aby se dalo mířit přesně.
- **Nezávislý podstavec**: nové ovládání pro posun podstavce (X/Z), jeho rotaci a jemné doladění výšky. Podstavec se tak dá vysunout stranou nebo natočit hranou dopředu.
- **Přesné číselné vstupy**: u každého posuvníku bude i pole s hodnotou (mm/stupně), takže jde nastavit přesně, ne jen odhadem.
- **Předvolby a snap**: rychlé volby „na střed“, „usadit na podstavec“ (automatické dosednutí spodní hrany sochy na desku), „srovnat na osu“ a reset.
- **Kolizní/„visí ve vzduchu“ hlídač**: upozornění, když socha přesahuje okraj podstavce nebo se do něj zanořuje.
- Vše se ukládá do konfigurace projektu a zapéká se do STL/GLB exportu stejně jako dnes.

### 2. Vizuální kvalita náhledu
- Studiové osvětlení s prostředím (soft HDRI-like rig), jemný rim light a měkčí kontaktní stíny.
- Realističtější materiály podle zvoleného materiálu a povrchu (matný sádrový, leštěný, kov), správná odezva na světlo.
- Podstavec dostane vlastní materiál podle druhu (ořech, mramor, černý kámen) místo jednotné barvy.
- Volitelná podlaha/grid a jemný vignette pro „výstavní“ dojem.

### 3. Měřítko a kontrola tisku
- Reálné rozměry: viditelná stopa výšky/šířky/hloubky v mm podle objednané velikosti.
- Volitelná lidská/mincová referenční silueta vedle sochy pro představu velikosti.
- Kontrola tisknutelnosti: odhad tenkých míst, převisů a stability (těžiště vůči ploše podstavce) s jasným varováním v panelu.

### 4. Rychlost a plynulost
- Náhled se nevykresluje, když stojí (render on demand), a pozastaví se mimo obrazovku.
- Chytřejší úsporný režim: nižší DPR, méně stínů, jednodušší materiály; ruční přepínač zůstává.
- Rychlejší načtení modelu (progresivní zobrazení + uvolňování paměti při přepnutí projektu).

### 5. Celková vizuální úroveň aplikace
- Sjednocení designového jazyka napříč landing / ceník / účet / studio: konzistentní odsazení, karty, stavové čipy, tlačítka a typografická škála.
- Landing a ceník dostanou čistší hierarchii a výraznější hlavní akci; účet a studio jednotné hlavičky sekcí.
- Lepší prázdné a chybové stavy, jednotné načítací skeletony.
- Kontrola na mobilu (390 px) — ovládací lišty studia posuvné, panely sbalitelné, žádné vodorovné přetečení.

## Technické poznámky
- `src/lib/pricing.ts`: rozšíření typu `Placement` o `baseOffsetX/baseOffsetZ/baseYaw` + sanitizace a výchozí hodnoty, aby staré uložené konfigurace zůstaly platné.
- `src/components/studio/ModelStage.tsx`: drag přes pointer události na raycast rovině, nezávislé transformace skupiny sochy a podstavce, nové světelné a materiálové nastavení, render-on-demand.
- `src/routes/editor.tsx`: rozšířený panel umístění (posuvníky + číselná pole + předvolby), varování o stabilitě, propojení s undo/redo historií a ukládáním konceptu.
- `src/lib/mesh-export.ts`: zapečení posunu/rotace podstavce a sochy do exportu, zachování převodu na mm.
- `src/styles.css`: doladění tokenů (povrchy, stíny, radiusy) — žádné hardcoded barvy v komponentách.
- i18n: nové klíče v CS i EN.
