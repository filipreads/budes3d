import { lazy, Suspense, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";

const ModelStage = lazy(() => import("./ModelStage"));

/** Defers the three.js bundle until a model viewer is actually rendered. */
export default function LazyModelStage(props: ComponentProps<typeof ModelStage>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-muted/40">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      }
    >
      <ModelStage {...props} />
    </Suspense>
  );
}
