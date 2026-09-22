# Rychlejší editor + nové 3D funkce (podstavce, nápisy, dutý model)

Dvě etapy: nejdřív výkon editoru, pak nové tiskové funkce, které se opírají o stejný výpočetní základ.

## Etapa 1 — Výkon editoru

**Výpočty mimo hlavní vlákno**
- Krájení na vrstvy i kontrola sítě se přesunou do odděleného vlákna prohlížeče. Posuvníky vrstev, výplně a podpor zůstanou plynulé i u velkých modelů; ovládání se nezasekne.
- Stavy „Počítám…" s možností přerušit; poslední výsledek zůstane na obrazovce, dokud nedorazí nový.
- Rychlé přetahování posuvníku spustí přepočet až po ustálení, takže se nehromadí zbytečné výpočty.

**Okamžitý náhled**
- Po dokončení generování se vedle plného modelu uloží i zjednodušená, výrazně menší verze pro rychlé zobrazení.
- Editor otevře nejdřív lehkou verzi (viditelná během okamžiku) a plný model dotáhne na pozadí; přepnutí je plynulé.
- Ke stažení, kontrole tisku i objednávce se vždy použije plná verze — lehká slouží jen k prohlížení.

**Drobnosti**
- Uvolňování paměti při přepnutí projektu, aby se v dlouhé relaci nehromadily načtené modely.
- Ukazatel načítání s procenty místo prázdné plochy.

## Etapa 2 — Nové 3D funkce

**Podstavce**
- Volba tvaru (kruhový, hranatý, oválný), výšky a průměru s okamžitým náhledem pod sochou.
- Materiál podstavce (ořech, mramor, černý kámen) se promítne do náhledu i do ceny.
- Podstavec se spojí s modelem při exportu; kontrola stability a přesahu, kterou už máme, ho zahrne.

**Nápisy a gravírování**
- Textové pole (jméno, datum, krátký vzkaz) umístěné na podstavec, s volbou fontu, velikosti a hloubky.
- Volba vyryto / vystouplé, náhled v reálném čase, upozornění při příliš jemném písmu pro tisk.
- Text se zapéká do exportovaných souborů STL/3MF/OBJ.

**Odlehčení (dutý model)**
- Přepínač „dutý model" se zadáním tloušťky stěny a otvorů pro odtok materiálu.
- Ukazuje úsporu materiálu i odhad ceny tisku, propojený se stávajícím odhadem hmotnosti.
- Kontrola minimální tloušťky stěny brání vytvoření netisknutelného modelu.

Ceník podstavců, gravírování a odlehčení bude nastavitelný v administraci, ne natvrdo v kódu.

## Technické poznámky

- Nový `src/workers/mesh.worker.ts`: přesun `prepareModel`/`computeStats`/`createSlicer` (`src/lib/slicing.ts`) a `src/lib/mesh-repair.ts` do workeru, přenos typed arrays přes transferables; `SlicePreview.tsx` a editor dostanou tenkou promise-based obálku s podporou zrušení.
- Zjednodušený náhled: decimace geometrie po dokončení generování (server-side v `generation.functions.ts`, cíl < 150k trojúhelníků), uložení do `portrait-models` jako `preview.glb`, nový sloupec `projects.preview_model_url`; `ModelStage.tsx` načte preview a pak plný model.
- Podstavec/nápis/dutost jako součást `config` projektu (rozšíření typů v `src/lib/pricing.ts`), generování geometrie v `src/lib/base-geometry.ts` a `src/lib/engrave.ts`; zapečení do exportu v `src/lib/mesh-export.ts` (STL/3MF/OBJ) — stejná cesta jako dnešní placement.
- Dutost: offsetová vnitřní skořepina nad `BufferGeometry` ve workeru, kontrola minimální tloušťky navázaná na `printability`/`slicing` odhady.
- Ceny: klíče `base_prices`, `engraving_price`, `hollow_discount` v `app_settings`, serverový přepočet v `studio.functions.ts`; klient jen zobrazuje.
- i18n: nové klíče v CS i EN; barvy jen přes tokeny v `src/styles.css`.
