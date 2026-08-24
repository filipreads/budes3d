/**
 * Real-world measurements for the studio placement controls.
 *
 * The viewer works in unit-less scene units; the ordered print height is the
 * only physical dimension we know, so it is used as the conversion anchor:
 * a sculpture at scale 1 is `MODEL_SCENE_HEIGHT` units tall and `heightMm` tall
 * in reality. Everything else (edge clearance, floating gap, snapping grid) is
 * derived from that ratio so the numbers shown to the customer are millimetres,
 * not abstract slider ticks.
 */
import { BASE_GEOMETRY, DEFAULT_PLACEMENT, type Placement } from "@/lib/pricing";

/** Height of the framed sculpture in scene units at scale 1. */
export const MODEL_SCENE_HEIGHT = 2;
/** Approximate footprint radius of a bust in scene units at scale 1. */
const MODEL_FOOTPRINT_RADIUS = 0.42;

/** Default grid step (mm) used when snapping is on, plus the fine keyboard step. */
export const SNAP_STEP_MM = 5;
export const FINE_STEP_MM = 1;
export const COARSE_STEP_MM = 10;

export function mmPerUnit(heightMm?: number | null): number {
  return heightMm && heightMm > 0 ? heightMm / MODEL_SCENE_HEIGHT : 0;
}

export function unitsPerMm(heightMm?: number | null): number {
  const perUnit = mmPerUnit(heightMm);
  return perUnit > 0 ? 1 / perUnit : 0;
}

/** Converts a scene-unit distance into millimetres (0 when the size is unknown). */
export function toMm(units: number, heightMm?: number | null): number {
  return units * mmPerUnit(heightMm);
}

/** Rounds a scene-unit value onto a millimetre grid; falls back to a unit grid. */
export function snapToGrid(units: number, stepMm: number, heightMm?: number | null): number {
  const step = unitsPerMm(heightMm) * stepMm;
  const effective = step > 0 ? step : 0.01;
  return Math.round(units / effective) * effective;
}

export type PlacementLevel = "ok" | "warn" | "error";

export type PlacementMetrics = {
  hasBase: boolean;
  /** Whether millimetre values are meaningful (an ordered size is known). */
  measured: boolean;
  /** Distance from the sculpture footprint to the plinth edge; negative = overhang. */
  clearanceMm: number;
  /** Gap between the sculpture and the plinth top; positive = floating, negative = sunk. */
  floatMm: number;
  /** Radial offset of the sculpture from the plinth centre. */
  offsetMm: number;
  level: PlacementLevel;
};

export function placementMetrics(
  placement: Placement = DEFAULT_PLACEMENT,
  baseId = "walnut",
  heightMm?: number | null,
): PlacementMetrics {
  const geometry = BASE_GEOMETRY[baseId] ?? BASE_GEOMETRY["walnut"]!;
  const hasBase = baseId !== "none" && geometry.height > 0;
  const perUnit = mmPerUnit(heightMm);

  const offsetUnits = Math.hypot(
    (placement.offsetX ?? 0) - (placement.baseOffsetX ?? 0),
    (placement.offsetZ ?? 0) - (placement.baseOffsetZ ?? 0),
  );
  const footprint = MODEL_FOOTPRINT_RADIUS * placement.scale;
  const clearanceUnits = geometry.radius - (offsetUnits + footprint);
  const floatUnits = placement.lift;

  const clearanceMm = clearanceUnits * perUnit;
  const floatMm = floatUnits * perUnit;
  const offsetMm = offsetUnits * perUnit;

  let level: PlacementLevel = "ok";
  if (hasBase) {
    const overhang = clearanceUnits < 0;
    const badFloat = Math.abs(floatUnits) > 0.08;
    const tight = clearanceUnits < 0.06;
    const slightFloat = Math.abs(floatUnits) > 0.02;
    if (overhang || badFloat) level = "error";
    else if (tight || slightFloat) level = "warn";
  }

  return { hasBase, measured: perUnit > 0, clearanceMm, floatMm, offsetMm, level };
}

/** "+12 mm" / "-4 mm" with a stable sign, for compact readouts. */
export function formatMm(value: number, withSign = false): string {
  const rounded = Math.round(value);
  const sign = withSign && rounded > 0 ? "+" : "";
  return `${sign}${rounded} mm`;
}
