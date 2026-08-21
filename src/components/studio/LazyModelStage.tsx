import { lazy, Suspense, type ComponentProps } from "react";

const ModelStage = lazy(() => import("./ModelStage"));

/** Defers the three.js bundle until a model viewer is actually rendered. */
export default function LazyModelStage(props: ComponentProps<typeof ModelStage>) {
  return (
    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg border border-border bg-muted" />}>
      <ModelStage {...props} />
    </Suspense>
  );
}
