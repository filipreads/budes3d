export type DeliveryType = "digital" | "print";

/** The studio bills in Czech koruna and euro; amounts are stored in minor units. */
export type Currency = "czk" | "eur";

export const CURRENCIES: { id: Currency; code: string; label: string; locale: string }[] = [
  { id: "czk", code: "CZK", label: "Kč", locale: "cs-CZ" },
  { id: "eur", code: "EUR", label: "€", locale: "de-DE" },
];

/** Price per currency, in minor units (haléř / cent). */
export type Money = Record<Currency, number>;

export const MATERIALS = [
  { id: "resin", label: "Studio resin", multiplier: 1, hint: "Fine detail, matte ivory" },
  { id: "marble", label: "Cast marble", multiplier: 1.25, hint: "Cool stone, soft veining" },
  { id: "bronze", label: "Bronze finish", multiplier: 1.35, hint: "Hand-polished metallic" },
  { id: "fullcolor", label: "Full colour", multiplier: 1.4, hint: "Photoreal sandstone print" },
] as const;

export const FINISHES = [
  { id: "matte", label: "Matte", multiplier: 1 },
  { id: "satin", label: "Satin", multiplier: 1.05 },
  { id: "gloss", label: "Gloss", multiplier: 1.08 },
] as const;

export const BASES = [
  { id: "none", label: "No base", price: { czk: 0, eur: 0 } },
  { id: "walnut", label: "Walnut plinth", price: { czk: 59000, eur: 2500 } },
  { id: "marble", label: "Marble plinth", price: { czk: 79000, eur: 3500 } },
] as const;

export const SIZES = [
  { id: "s", label: "Desk", heightMm: 100, price: { czk: 199000, eur: 8900 } },
  { id: "m", label: "Shelf", heightMm: 150, price: { czk: 299000, eur: 13900 } },
  { id: "l", label: "Statement", heightMm: 220, price: { czk: 499000, eur: 21900 } },
  { id: "xl", label: "Gallery", heightMm: 300, price: { czk: 799000, eur: 34900 } },
] as const;

export const DIGITAL_PRICE: Money = { czk: 89000, eur: 3900 };
export const ENGRAVING_PRICE: Money = { czk: 35000, eur: 1500 };
export const SHIPPING_PRICE: Money = { czk: 29000, eur: 1200 };
/** Default charge for one completed premium (Tripo3D) generation. */
export const PREMIUM_GENERATION_PRICE: Money = { czk: 24900, eur: 990 };
export const RUSH_RATE = 0.3;

export function amount(price: Money, currency: Currency): number {
  return price[currency] ?? price.eur;
}

export type Placement = {
  /** Rotation around the vertical axis, degrees. */
  yaw: number;
  /** Forward/back tilt, degrees. */
  tilt: number;
  /** Vertical offset relative to the plinth, in scene units. */
  lift: number;
  /** Left/right offset on the plinth, in scene units. */
  offsetX: number;
  /** Front/back offset on the plinth, in scene units. */
  offsetZ: number;
  /** Relative scale against the auto-fitted size. */
  scale: number;
  /** Left/right offset of the plinth itself, in scene units. */
  baseOffsetX: number;
  /** Front/back offset of the plinth itself, in scene units. */
  baseOffsetZ: number;
  /** Rotation of the plinth around the vertical axis, degrees. */
  baseYaw: number;
};

export const DEFAULT_PLACEMENT: Placement = {
  yaw: 0,
  tilt: 0,
  lift: 0,
  offsetX: 0,
  offsetZ: 0,
  scale: 1,
  baseOffsetX: 0,
  baseOffsetZ: 0,
  baseYaw: 0,
};


/** Physical proportions of each plinth, used by the viewer and the exporter. */
export const BASE_GEOMETRY: Record<string, { radius: number; height: number; color: string }> = {
  none: { radius: 0, height: 0, color: "#000000" },
  walnut: { radius: 0.95, height: 0.22, color: "#3c2f24" },
  marble: { radius: 1.02, height: 0.28, color: "#cfc8ba" },
};


export type StudioConfig = {
  delivery: DeliveryType;
  sizeId: (typeof SIZES)[number]["id"];
  materialId: (typeof MATERIALS)[number]["id"];
  finishId: (typeof FINISHES)[number]["id"];
  baseId: (typeof BASES)[number]["id"];
  engraving: string;
  rush: boolean;
  quantity: number;
  placement: Placement;
};

export const DEFAULT_CONFIG: StudioConfig = {
  delivery: "print",
  sizeId: "m",
  materialId: "resin",
  finishId: "matte",
  baseId: "walnut",
  engraving: "",
  rush: false,
  quantity: 1,
  placement: DEFAULT_PLACEMENT,
};

export type LineItem = { label: string; cents: number };

export type Quote = {
  lineItems: LineItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
};

function pick<T extends { id: string }>(list: readonly T[], id: string, fallback: T): T {
  return list.find((entry) => entry.id === id) ?? fallback;
}

export function quote(config: StudioConfig, currency: Currency = "czk", extras: LineItem[] = []): Quote {
  const quantity = Math.min(Math.max(Math.round(config.quantity || 1), 1), 25);
  const lineItems: LineItem[] = [];

  if (config.delivery === "digital") {
    lineItems.push({ label: "Digital 3D file (GLB + STL)", cents: amount(DIGITAL_PRICE, currency) });
  } else {
    const size = pick(SIZES, config.sizeId, SIZES[1]);
    const material = pick(MATERIALS, config.materialId, MATERIALS[0]);
    const finish = pick(FINISHES, config.finishId, FINISHES[0]);
    const base = pick(BASES, config.baseId, BASES[0]);

    const sculptureCents = Math.round(amount(size.price, currency) * material.multiplier * finish.multiplier);
    lineItems.push({
      label: `${size.label} print · ${size.heightMm}mm · ${material.label} ${finish.label.toLowerCase()}`,
      cents: sculptureCents,
    });
    const baseCents = amount(base.price, currency);
    if (baseCents > 0) lineItems.push({ label: base.label, cents: baseCents });
    lineItems.push({ label: "Digital 3D file included", cents: 0 });
  }

  if (config.engraving.trim().length > 0) {
    lineItems.push({
      label: `Engraving: "${config.engraving.trim().slice(0, 40)}"`,
      cents: amount(ENGRAVING_PRICE, currency),
    });
  }

  let unitCents = lineItems.reduce((sum, item) => sum + item.cents, 0);
  if (config.rush) {
    const rushCents = Math.round(unitCents * RUSH_RATE);
    lineItems.push({ label: "Rush production (5 days)", cents: rushCents });
    unitCents += rushCents;
  }

  const subtotalCents = unitCents * quantity;
  const shippingCents = config.delivery === "print" ? amount(SHIPPING_PRICE, currency) : 0;

  // Extras (e.g. premium engine usage) are charged once per order, never per unit.
  const extrasCents = extras.reduce((sum, item) => sum + item.cents, 0);

  return {
    lineItems: [
      ...lineItems,
      ...(quantity > 1 ? [{ label: `Quantity × ${quantity}`, cents: 0 }] : []),
      ...extras,
    ],
    subtotalCents: subtotalCents + extrasCents,
    shippingCents,
    totalCents: subtotalCents + extrasCents + shippingCents,
  };
}

/** Formats a minor-unit amount in the studio currency. */
export function formatPrice(cents: number, currency: Currency = "czk", locale?: string) {
  const meta = CURRENCIES.find((entry) => entry.id === currency) ?? CURRENCIES[0]!;
  return new Intl.NumberFormat(locale ?? meta.locale, {
    style: "currency",
    currency: meta.code,
    maximumFractionDigits: currency === "czk" ? 0 : 2,
    minimumFractionDigits: currency === "czk" ? 0 : 2,
  }).format(cents / 100);
}

export function sanitizeCurrency(value: unknown): Currency {
  return value === "eur" ? "eur" : "czk";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

export function sanitizePlacement(input: unknown): Placement {
  const raw = (input ?? {}) as Partial<Placement>;
  return {
    yaw: clampNumber(raw.yaw, -180, 180, 0),
    tilt: clampNumber(raw.tilt, -30, 30, 0),
    lift: clampNumber(raw.lift, -0.5, 0.5, 0),
    offsetX: clampNumber(raw.offsetX, -0.6, 0.6, 0),
    offsetZ: clampNumber(raw.offsetZ, -0.6, 0.6, 0),
    scale: clampNumber(raw.scale, 0.6, 1.6, 1),
    baseOffsetX: clampNumber(raw.baseOffsetX, -0.8, 0.8, 0),
    baseOffsetZ: clampNumber(raw.baseOffsetZ, -0.8, 0.8, 0),
    baseYaw: clampNumber(raw.baseYaw, -180, 180, 0),
  };
}

export function sanitizeConfig(input: unknown): StudioConfig {
  const raw = (input ?? {}) as Partial<StudioConfig>;
  return {
    delivery: raw.delivery === "digital" ? "digital" : "print",
    sizeId: pick(SIZES, String(raw.sizeId ?? ""), SIZES[1]).id,
    materialId: pick(MATERIALS, String(raw.materialId ?? ""), MATERIALS[0]).id,
    finishId: pick(FINISHES, String(raw.finishId ?? ""), FINISHES[0]).id,
    baseId: pick(BASES, String(raw.baseId ?? ""), BASES[0]).id,
    engraving: String(raw.engraving ?? "").slice(0, 40),
    rush: Boolean(raw.rush),
    quantity: Math.min(Math.max(Math.round(Number(raw.quantity) || 1), 1), 25),
    placement: sanitizePlacement(raw.placement),
  };
}
