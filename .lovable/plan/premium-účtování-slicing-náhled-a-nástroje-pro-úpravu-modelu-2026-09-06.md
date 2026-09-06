# Premium účtování, slicing náhled a nástroje pro úpravu modelu

## 1. Měna: přechod na CZK a EUR

- Celý ceník se přepíše do dvou měnových sad: **CZK** a **EUR** (ne přepočet kurzem — pevné, hezky zaokrouhlené ceny pro každou měnu).
- Přepínač měny v hlavičce; výchozí podle jazyka (čeština → CZK, angličtina → EUR), volba se pamatuje.
- Objednávka si měnu uloží při vytvoření a už se nemění; platba, účtenka i PDF faktura běží v této měně.
- Ceník, studio, košík i účet zobrazují ceny ve zvolené měně se správným formátem (1 890 Kč / 79,00 €).

## 2. Premium engine (Tripo3D): platba za skutečné použití

- Každá **dokončená** Premium generace se u projektu započítá. Nezdařená generace se nepočítá.
- Sazba za jednu Premium generaci je nastavitelná v administraci zvlášť pro CZK a EUR (výchozí návrh 249 Kč / 9,90 €).
- V objednávce přibude samostatná položka „Premium 3D generování × N“ — cenu počítá server podle skutečného počtu generací, ne prohlížeč.
- Ve studiu je vidět průběžně: „Premium generace: 2 × 249 Kč = 498 Kč“ ještě před objednáním, plus varování před spuštěním další placené generace s potvrzením.
- Standardní engine zůstává zdarma; když není Premium nastavený, nic z toho se nezobrazuje.
- V administraci a v detailu objednávky bude rozpis: počet generací, sazba, celkem — aby náklady seděly na fakturu.

## 3. Náhled slicingu před stažením

- Nový krok „Kontrola tisku“ v editoru: model se rozřeže na vrstvy přímo v prohlížeči a zobrazí se obrysy vrstev.
- Posuvník vrstev + přehrání zdola nahoru, u každé vrstvy číslo a výška v mm.
- Nastavitelné parametry: **výška vrstvy** (0,05–0,3 mm), **výplň** (0–100 %), **podpory** (vypnuto / jen z podložky / všude) a úhel převisu.
- Odhady: počet vrstev, objem materiálu a hmotnost, orientační čas tisku, plocha vyžadující podpory, upozornění na tenké stěny a nestabilní těžiště.
- Parametry se ukládají ke konfiguraci projektu a promítnou se do poznámky pro výrobu u tiskových objednávek.

## 4. Nástroje pro úpravu sítě v editoru

- Rozšíření stávajícího panelu umístění o přehledný „mesh“ režim: otáčení ve všech osách, posun, škálování s uzamčením poměru i s přesnými hodnotami v mm.
- Jemné zarovnání: usadit na podložku, vycentrovat, automatické narovnání do svislé osy, srovnání pohledu zepředu.
- Volitelná **oprava sítě** ve dvou úrovních:
  - *Lehká* — sloučení duplicitních vrcholů, odstranění degenerovaných trojúhelníků, sjednocení normál, uzavření drobných děr.
  - *Plná rekonstrukce* — přepočet na vodotěsné těleso; pomalejší, může ubrat jemné detaily, proto vždy s náhledem „před / po“ (počet trojúhelníků, otevřené hrany) a možností vrátit zpět.
- Vše se aplikuje před schválením; schválená verze je přesně to, co se exportuje do GLB/STL/OBJ/3MF.

## Technické poznámky

- `src/lib/pricing.ts`: `Currency = "czk" | "eur"`, ceníkové tabulky per měna, `quote(config, currency)`, `formatPrice(cents, currency, locale)`, `PREMIUM_GENERATION_CENTS` jako výchozí hodnota přebitelná z `app_settings`.
- Migrace: `projects.premium_generations integer not null default 0`; `orders` už měnu má (`currency`). Klíč `premium_generation_rate` v `app_settings` (JSON `{czk, eur}`), čtený server-side.
- `src/lib/generation.functions.ts`: inkrement `premium_generations` až v `storeModelFromUrl` u provideru `tripo3d`.
- `src/lib/studio.functions.ts`: serverový výpočet objednávky přičte Premium položku podle `projects.premium_generations` × sazba z `app_settings`; klient hodnotu jen zobrazuje.
- Nový `src/lib/slicing.ts`: řezání načtené geometrie rovinami (trojúhelník × rovina → segmenty, spojení do obrysů), odhad objemu/hmotnosti, detekce převisů podle normál; `src/components/studio/SlicePreview.tsx` kreslí vrstvy na canvas/Three.
- Nový `src/lib/mesh-repair.ts`: weld/degenerate/normals/hole-fill nad `BufferGeometry`; plná rekonstrukce voxelizací + marching cubes, běží ve Web Workeru, aby UI nezamrzlo.
- `src/components/studio/ModelStage.tsx` + `src/routes/editor.tsx`: mesh panel, zarovnávací akce, napojení na stávající undo/redo a `sanitizePlacement`.
- i18n: nové klíče v CS i EN; žádné natvrdo psané barvy, jen tokeny z `src/styles.css`.
