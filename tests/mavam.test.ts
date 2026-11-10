import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

interface Request {
  job: string;
  profile?: string;
  name?: string;
  model?: string;
  thinking?: string;
  after?: string[];
}

interface Spec {
  job: string;
  profile?: string;
  model?: { provider: string; modelId: string };
  thinking?: string;
  tools?: string[];
  instructions?: string;
}

interface Resolver {
  resolveSpawn(request: Request, ctx: unknown, sources: unknown): Promise<Spec>;
  resolveHelper(request: Request, ctx: unknown, defaults: unknown, skills: unknown): Promise<Spec>;
}

test("published mavam resolver consumes direct single and graph routes without starting agents", async () => {
  const root = mkdtempSync(join(process.cwd(), ".mavam-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  try {
    const project = join(root, "project");
    const profiles = join(project, ".pi", "agents");
    mkdirSync(profiles, { recursive: true });
    mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
    const { harness } = await import("./harness.ts");
    const h = harness();
    const nativeModel = h.config.profiles.balanced.main!.model;
    for (const role of ["implementer", "reviewer"]) {
      writeFileSync(join(profiles, `${role}.md`), `---\nname: ${role}\ndescription: Test profile\nmodel: ${nativeModel}\nthinking: low\ntools: [read, grep]\n---\nProject instructions for ${role}.\n`);
    }

    // Load the published source by absolute path: its internal .js imports map to TS via jiti.
    const jiti = createJiti(import.meta.url);
    const modulePath = fileURLToPath(new URL("../node_modules/pi-agents/src/pi/spawn.ts", import.meta.url));
    const { resolveSpawn, resolveHelper } = await jiti.import<Resolver>(modulePath);
    const ctx = { ...h.ctx, cwd: project, isProjectTrusted: () => true };
    const skills = async () => [];
    await h.emit("session_start");

    for (const agents of [
      [{ profile: "implementer", job: "single", model: nativeModel, thinking: "low" }],
      [{ name: "first", profile: "implementer", job: "first" }, { name: "second", profile: "reviewer", job: "second", after: ["first"] }],
    ]) {
      const input: { agents: Request[] } = { agents };
      const requested = structuredClone(agents);
      assert.equal(await h.emit("tool_call", { toolName: "agent_spawn", input }), undefined);
      for (const [index, request] of input.agents.entries()) {
        const spec = await resolveSpawn(request, ctx, { skills, thinking: "low" });
        // Explicit model/thinking in the request win; otherwise the profile route applies.
        const original = requested[index] as Request;
        const route = original.model ? { model: original.model, thinking: original.thinking! } : h.config.profiles.balanced.agents[request.profile!];
        const slash = route.model.indexOf("/");
        assert.deepEqual(spec.model, { provider: route.model.slice(0, slash), modelId: route.model.slice(slash + 1) });
        assert.equal(spec.thinking, route.thinking);
        assert.equal(spec.instructions, `Project instructions for ${request.profile}.`);
        assert.deepEqual(spec.tools, ["read", "grep"]);
      }
      if (agents.length > 1) assert.deepEqual(input.agents[1].after, ["first"]);
    }

    // Nested helpers bypass the orchestrator's tool_call hook and retain native profile defaults.
    const helper = await resolveHelper({ job: "nested", profile: "reviewer" }, ctx, { cwd: project }, skills);
    const slash = nativeModel.indexOf("/");
    assert.deepEqual(helper.model, { provider: nativeModel.slice(0, slash), modelId: nativeModel.slice(slash + 1) });
    assert.equal(helper.thinking, "low");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
