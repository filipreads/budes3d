import { describe, expect, it } from "vitest";
import { ENGINE_TO_PROVIDER, isEngineId, neutralStage } from "../photo3d";
import { buildCreatePayload, DEFAULT_MESHY_PROFILE, mapTaskStatus, mergeProfile, pickGlbUrl } from "../meshy.server";

describe("provider routing", () => {
  it("maps engine ids to providers", () => {
    expect(ENGINE_TO_PROVIDER.meshy).toBe("meshy");
    expect(ENGINE_TO_PROVIDER.trellis).toBe("trellis2");
    expect(isEngineId("meshy")).toBe(true);
    expect(isEngineId("nope")).toBe(false);
  });

  it("maps raw stages onto neutral stages", () => {
    expect(neutralStage("queued")).toBe("preparing");
    expect(neutralStage("sculpting")).toBe("generating");
    expect(neutralStage("extracting")).toBe("finalizing");
    expect(neutralStage("storing")).toBe("printcheck");
  });
});

describe("meshy payload", () => {
  it("builds a valid image-to-3d payload", () => {
    const payload = buildCreatePayload("https://example.test/photo.jpg", DEFAULT_MESHY_PROFILE);
    expect(payload['image_url']).toBe("https://example.test/photo.jpg");
    expect(payload['should_texture']).toBe(true);
    expect(payload['target_formats']).toEqual(["glb"]);
  });

  it("rejects invalid profile overrides and keeps defaults", () => {
    const profile = mergeProfile({ texture_resolution: "16k", should_texture: "yes" });
    expect(profile.texture_resolution).toBe(DEFAULT_MESHY_PROFILE.texture_resolution);
    expect(profile.should_texture).toBe(DEFAULT_MESHY_PROFILE.should_texture);
  });
});

describe("meshy status mapping", () => {
  it("maps provider states", () => {
    expect(mapTaskStatus({ status: "SUCCEEDED", progress: 100 }).state).toBe("succeeded");
    expect(mapTaskStatus({ status: "IN_PROGRESS", progress: 40 }).state).toBe("running");
    expect(mapTaskStatus({ status: "PENDING" }).state).toBe("queued");
    const failed = mapTaskStatus({ status: "FAILED", task_error: { message: "boom" } });
    expect(failed.state).toBe("failed");
    expect(failed.error).toContain("boom");
  });

  it("picks only a glb output", () => {
    expect(pickGlbUrl({ model_urls: { glb: "https://x/a.glb", fbx: "https://x/a.fbx" } })).toBe("https://x/a.glb");
    expect(pickGlbUrl({ model_urls: { fbx: "https://x/a.fbx" } })).toBeNull();
  });
});
