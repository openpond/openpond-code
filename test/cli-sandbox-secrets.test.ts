import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { createOpenPondSandboxClient } from "../src/sandbox/client";

const CLI_SECRET = "cli-secret-value-that-must-not-echo";

type CapturedRequest = {
  method: string;
  url: string;
  body: Record<string, unknown>;
  apiKey: string | null;
};

describe("sandbox secret CLI output redaction", () => {
  test("secret-create reads stdin and never echoes plaintext", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const result = await runCli(
        [
          "sandbox",
          "secret-create",
          "--name",
          "FOO_API_KEY",
          "--stdin",
          "--sandbox-api-url",
          sandboxApiUrl,
        ],
        `${CLI_SECRET}\n`
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        "openpond://secret/team_test/secret_test#v1"
      );
      expect(result.stdout).not.toContain(CLI_SECRET);
      expect(result.stderr).not.toContain(CLI_SECRET);
      expect(requests[0]?.url).toBe("/v1/sandbox-secrets");
      expect(requests[0]?.body).toMatchObject({
        name: "FOO_API_KEY",
        value: CLI_SECRET,
      });
      expect(requests[0]?.apiKey).toBe("opk_test_cli");
    });
  });

  test("secret-create rejects argv values without echoing plaintext", async () => {
    const result = await runCli([
      "sandbox",
      "secret-create",
      "--name",
      "FOO_API_KEY",
      "--value",
      CLI_SECRET,
      "--sandbox-api-url",
      "http://127.0.0.1:9/v1/sandboxes",
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain(CLI_SECRET);
    expect(result.stderr).not.toContain(CLI_SECRET);
    expect(result.stderr).toContain(
      "sandbox secret values must be provided with --stdin or the masked prompt"
    );
  });

  test("sandbox create sends secret refs and refuses secret-like literals without echoing plaintext", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const result = await runCli([
        "sandbox",
        "create",
        "--env-ref",
        "FOO_API_KEY=openpond://secret/team_test/secret_test#v1",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain(CLI_SECRET);
      expect(requests[0]?.url).toBe("/v1/sandboxes");
      expect(requests[0]?.body).toMatchObject({
        env: [
          {
            name: "FOO_API_KEY",
            secretRef: "openpond://secret/team_test/secret_test#v1",
          },
        ],
      });
    });

    const rejected = await runCli([
      "sandbox",
      "create",
      "--env-literal",
      `FOO_API_KEY=${CLI_SECRET}`,
      "--sandbox-api-url",
      "http://127.0.0.1:9/v1/sandboxes",
    ]);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stdout).not.toContain(CLI_SECRET);
    expect(rejected.stderr).not.toContain(CLI_SECRET);
    expect(rejected.stderr).toContain(
      "refusing plaintext value for secret-like env FOO_API_KEY"
    );
  });

  test("sandbox create sends low-level sandbox runtime options", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const result = await runCli([
        "sandbox",
        "create",
        "--runtime-mode",
        "feature",
        "--runtime-project-id",
        "project_test",
        "--runtime-agent-id",
        "agent_test",
        "--runtime-base-branch",
        "master",
        "--runtime-promotion-policy",
        "manual",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(result.code).toBe(0);
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/runtimes",
        "/v1/runtimes/workspace_test/sandbox",
      ]);
      expect(requests[0]?.body).toMatchObject({
        projectId: "project_test",
        agentId: "agent_test",
        mode: "feature",
        baseBranch: "master",
        promotionPolicy: "manual",
      });
      expect(requests[1]?.body).toMatchObject({
        projectId: "project_test",
        agentId: "agent_test",
      });
      expect("sandboxRuntime" in (requests[1]?.body ?? {})).toBe(false);
      expect("workspacePurpose" in (requests[0]?.body ?? {})).toBe(false);
    });
  });

  test("project and agent commands use first-class sandbox API resources", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const projectList = await runCli([
        "project",
        "list",
        "--team-id",
        "team_test",
        "--json",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const projectCreate = await runCli([
        "project",
        "create",
        "--team-id",
        "team_test",
        "--name",
        "Demo Project",
        "--source-type",
        "internal_repo",
        "--git-owner",
        "openpond",
        "--git-repo",
        "demo-project",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const projectUpdate = await runCli([
        "project",
        "update",
        "project_test",
        "--team-id",
        "team_test",
        "--description",
        "Updated Project",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentCreate = await runCli([
        "agent",
        "create",
        "--team-id",
        "team_test",
        "--project-id",
        "project_test",
        "--name",
        "Daily Report",
        "--entrypoint-scope",
        "action",
        "--entrypoint-name",
        "hello",
        "--trigger-type",
        "manual",
        "--runtime-mode",
        "attempt",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentUpdate = await runCli([
        "agent",
        "update",
        "agent_test",
        "--team-id",
        "team_test",
        "--trigger-type",
        "background",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentRun = await runCli([
        "agent",
        "run",
        "agent_test",
        "--team-id",
        "team_test",
        "--idempotency-key",
        "run_key",
        "--input",
        '{"message":"hello"}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(projectList.code).toBe(0);
      expect(projectCreate.code).toBe(0);
      expect(projectUpdate.code).toBe(0);
      expect(agentCreate.code).toBe(0);
      expect(agentUpdate.code).toBe(0);
      expect(agentRun.code).toBe(0);
      expect(JSON.parse(projectList.stdout).projects[0]).toMatchObject({
        id: "project_test",
        teamId: "team_test",
      });
      expect(JSON.parse(projectCreate.stdout).project).toMatchObject({
        id: "project_test",
        sourceType: "internal_repo",
      });
      expect(JSON.parse(projectUpdate.stdout).project).toMatchObject({
        id: "project_test",
        description: "Updated Project",
      });
      expect(JSON.parse(agentCreate.stdout).agent).toMatchObject({
        id: "agent_test",
        projectId: "project_test",
        selectedEntrypoint: { scope: "action", name: "hello" },
      });
      expect(JSON.parse(agentUpdate.stdout).agent).toMatchObject({
        id: "agent_test",
        triggerType: "background",
      });
      expect(JSON.parse(agentRun.stdout).run).toMatchObject({
        id: "agent_run_test",
        agentId: "agent_test",
        runtimeId: "workspace_test",
      });
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/projects?teamId=team_test",
        "/v1/projects",
        "/v1/projects/project_test?teamId=team_test",
        "/v1/agents",
        "/v1/agents/agent_test?teamId=team_test",
        "/v1/agents/agent_test/run",
      ]);
      expect(requests[1]?.body).toMatchObject({
        teamId: "team_test",
        name: "Demo Project",
        sourceType: "internal_repo",
        gitOwner: "openpond",
        gitRepo: "demo-project",
      });
      expect(requests[2]?.body).toMatchObject({
        description: "Updated Project",
      });
      expect(requests[3]?.body).toMatchObject({
        teamId: "team_test",
        projectId: "project_test",
        selectedEntrypoint: { scope: "action", name: "hello" },
      });
      expect(requests[4]?.body).toMatchObject({
        triggerType: "background",
      });
      expect(requests[5]?.body).toMatchObject({
        teamId: "team_test",
        idempotencyKey: "run_key",
        input: { message: "hello" },
      });
    });
  });

  test("sdk exposes project and agent handles without requiring app ids", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const client = createOpenPondSandboxClient({
        apiKey: "opk_test_cli",
        sandboxApiUrl,
      });

      const project = await client.projects.upsert({
        teamId: "team_test",
        name: "SDK Project",
        sourceType: "manual",
      });
      const projectAgain = await client.projects.upsert({
        teamId: "team_test",
        name: "SDK Project",
        sourceType: "manual",
      });
      const projectUpdated = await client.projects.update(project.id, {
        teamId: "team_test",
        description: "Updated SDK Project",
      });
      const agent = await client.agents.upsert({
        teamId: "team_test",
        projectId: project.id,
        name: "SDK Agent",
        selectedEntrypoint: { scope: "entire_manifest" },
      });
      const agentAgain = await client.agents.upsert({
        teamId: "team_test",
        projectId: project.id,
        name: "SDK Agent",
        selectedEntrypoint: { scope: "entire_manifest" },
      });
      const agentUpdated = await client.agents.update(agent.id, {
        teamId: "team_test",
        triggerType: "background",
      });
      const result = await client.agents.run(agent.id, {
        teamId: "team_test",
        idempotencyKey: "sdk_run",
      });

      expect(project).toMatchObject({
        id: "project_test",
        teamId: "team_test",
      });
      expect(projectAgain.id).toBe(project.id);
      expect(projectUpdated.description).toBe("Updated SDK Project");
      expect(agent).toMatchObject({
        id: "agent_test",
        projectId: "project_test",
      });
      expect(agentAgain.id).toBe(agent.id);
      expect(agentUpdated.triggerType).toBe("background");
      expect(result.run).toMatchObject({
        id: "agent_run_test",
        agentId: "agent_test",
      });
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/projects",
        "/v1/projects",
        "/v1/projects/project_test?teamId=team_test",
        "/v1/agents",
        "/v1/agents",
        "/v1/agents/agent_test?teamId=team_test",
        "/v1/agents/agent_test/run",
      ]);
      expect(requests[0]?.body).not.toHaveProperty("appId");
      expect(requests[1]?.body).not.toHaveProperty("appId");
      expect(requests[2]?.body).toMatchObject({
        description: "Updated SDK Project",
      });
      expect(requests[2]?.body).not.toHaveProperty("appId");
      expect(requests[3]?.body).not.toHaveProperty("appId");
      expect(requests[4]?.body).not.toHaveProperty("appId");
      expect(requests[5]?.body).toMatchObject({ triggerType: "background" });
      expect(requests[5]?.body).not.toHaveProperty("appId");
    });
  });

  test("sandbox runtime inspection commands read runtime status and events", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const list = await runCli([
        "sandbox",
        "runtime-list",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const runtime = await runCli([
        "sandbox",
        "runtime-get",
        "workspace_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const events = await runCli([
        "sandbox",
        "runtime-events",
        "workspace_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const eventWrite = await runCli([
        "sandbox",
        "runtime-event",
        "workspace_test",
        "--type",
        "workflow.checkpoint_hint",
        "--summary",
        "checkpoint",
        "--payload",
        '{"artifact":"conversation-state"}',
        "--lifecycle-hint",
        '{"kind":"checkpoint","reason":"no_user_reply_timeout"}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const statusWrite = await runCli([
        "sandbox",
        "runtime-status",
        "workspace_test",
        "--status",
        "waiting_for_user",
        "--expected-version",
        "2",
        "--summary",
        "waiting",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(list.code).toBe(0);
      expect(runtime.code).toBe(0);
      expect(events.code).toBe(0);
      expect(eventWrite.code).toBe(0);
      expect(statusWrite.code).toBe(0);
      expect(JSON.parse(list.stdout).runtimes).toContainEqual(
        expect.objectContaining({
          id: "workspace_test",
          status: "waiting_for_user",
        })
      );
      expect(JSON.parse(runtime.stdout).runtime).toMatchObject({
        id: "workspace_test",
        status: "waiting_for_user",
      });
      expect(JSON.parse(events.stdout).events).toEqual([
        expect.objectContaining({
          type: "workflow.waiting_for_user",
        }),
      ]);
      expect(JSON.parse(eventWrite.stdout).event).toMatchObject({
        type: "workflow.checkpoint_hint",
      });
      expect(JSON.parse(statusWrite.stdout).runtime).toMatchObject({
        id: "workspace_test",
        status: "waiting_for_user",
      });
      expect(requests.map((request) => request.url)).toContain("/v1/runtimes");
      expect(requests.map((request) => request.url)).toContain(
        "/v1/runtimes/workspace_test"
      );
      expect(requests.map((request) => request.url)).toContain(
        "/v1/runtimes/workspace_test/events"
      );
      expect(
        requests.some(
          (request) =>
            request.method === "PATCH" &&
            request.url === "/v1/runtimes/workspace_test/status"
        )
      ).toBe(true);
    });
  });

  test("sdk project runtime helpers materialize and resume attached sandboxes", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const client = createOpenPondSandboxClient({
        apiKey: "opk_test_cli",
        sandboxApiUrl,
      });

      const createdRuntime = await client.runtimes.create({
        projectId: "project_test",
        agentId: "agent_test",
        mode: "feature",
      });
      const runtime = client.runtimes.handle(createdRuntime.id, createdRuntime);
      await runtime.createSandbox({
        projectId: "project_test",
        agentId: "agent_test",
        command: "echo ready",
      });
      const exec = await runtime.commands.run("echo hi");
      const fileWrite = await runtime.files.write(
        "src/message.txt",
        "hello from runtime files"
      );
      const fileRead = await runtime.files.read("src/message.txt");
      const waiting = await runtime.waitForUser({
        reason: "awaiting_next_prompt",
      });
      const rawSandbox = await client.sandboxes.create({
        command: "echo raw",
      });

      expect(runtime.id).toBe("workspace_test");
      expect(exec.command.command).toBe("echo hi");
      expect(fileWrite.file.path).toBe("src/message.txt");
      expect(fileRead).toBe("hello from runtime files");
      expect(waiting.status).toBe("waiting_for_user");
      expect(rawSandbox.runtimeId).toBeNull();
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/runtimes",
        "/v1/runtimes/workspace_test/sandbox",
        "/v1/runtimes/workspace_test",
        "/v1/sandboxes/sandbox_test",
        "/v1/sandboxes/sandbox_test/exec",
        "/v1/runtimes/workspace_test",
        "/v1/sandboxes/sandbox_test",
        "/v1/sandboxes/sandbox_test/files",
        "/v1/runtimes/workspace_test",
        "/v1/sandboxes/sandbox_test",
        "/v1/sandboxes/sandbox_test/files?path=src%2Fmessage.txt",
        "/v1/runtimes/workspace_test/events",
        "/v1/runtimes/workspace_test",
        "/v1/sandboxes",
      ]);
      expect(requests[0]?.body).toMatchObject({
        projectId: "project_test",
        agentId: "agent_test",
        mode: "feature",
      });
      expect(requests[1]?.body).toMatchObject({
        projectId: "project_test",
        agentId: "agent_test",
        command: "echo ready",
      });
      expect(requests[4]?.body).toMatchObject({
        command: "echo hi",
      });
      expect(requests[7]?.body).toMatchObject({
        path: "src/message.txt",
      });
      expect(requests[11]?.body).toMatchObject({
        type: "workflow.waiting_for_user",
        lifecycleHint: {
          kind: "waiting_for_user",
          reason: "awaiting_next_prompt",
        },
      });
    });
  });

  test("sandbox pricing and costs expose tier and runner slot accounting", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const pricing = await runCli([
        "sandbox",
        "pricing",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const costs = await runCli([
        "sandbox",
        "costs",
        "--team-id",
        "team_test",
        "--summary",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(pricing.code).toBe(0);
      expect(costs.code).toBe(0);
      expect(JSON.parse(pricing.stdout).pricing).toMatchObject({
        currency: "USD",
        tiers: [
          expect.objectContaining({
            key: "default",
            keepRunningEstimate: expect.objectContaining({
              monthlyUsd: "41.990400",
            }),
          }),
        ],
      });
      expect(JSON.parse(costs.stdout).costs).toMatchObject({
        teamId: "team_test",
        summary: {
          activeRunnerSlots: 1,
          runningCount: 1,
          stoppedCount: 2,
        },
        lineItems: [
          expect.objectContaining({
            label: "vCPU",
            amountUsd: "0.000042",
          }),
        ],
      });
      expect(requests.map((request) => request.url)).toContain(
        "/v1/sandboxes/pricing"
      );
      expect(requests.map((request) => request.url)).toContain(
        "/v1/sandboxes/costs?teamId=team_test"
      );
    });
  });

  test("created secret refs can be reused to launch a sandbox without echoing plaintext", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const created = await runCli(
        [
          "sandbox",
          "secret-create",
          "--name",
          "FOO_API_KEY",
          "--stdin",
          "--sandbox-api-url",
          sandboxApiUrl,
        ],
        `${CLI_SECRET}\n`
      );
      expect(created.code).toBe(0);
      expect(created.stdout).not.toContain(CLI_SECRET);
      expect(created.stderr).not.toContain(CLI_SECRET);

      const secretRef = (
        JSON.parse(created.stdout) as { secret: { secretRef: string } }
      ).secret.secretRef;
      const launched = await runCli([
        "sandbox",
        "create",
        "--env-ref",
        `FOO_API_KEY=${secretRef}`,
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(launched.code).toBe(0);
      expect(launched.stdout).not.toContain(CLI_SECRET);
      expect(launched.stderr).not.toContain(CLI_SECRET);
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/sandbox-secrets",
        "/v1/sandboxes",
      ]);
      expect(requests[1]?.body).toMatchObject({
        env: [{ name: "FOO_API_KEY", secretRef }],
      });
    });
  });

  test("secret list, attach, rotate, revoke, and delete stay metadata-only", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const listed = await runCli([
        "sandbox",
        "secrets",
        "--json",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const attached = await runCli([
        "sandbox",
        "secret-attach",
        "secret_test",
        "--env-name",
        "FOO_API_KEY",
        "--target-type",
        "sandbox",
        "--target-id",
        "sandbox_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const rotated = await runCli(
        [
          "sandbox",
          "secret-rotate",
          "secret_test",
          "--stdin",
          "--sandbox-api-url",
          sandboxApiUrl,
        ],
        `${CLI_SECRET}\n`
      );
      const revoked = await runCli([
        "sandbox",
        "secret-revoke",
        "secret_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const deleted = await runCli([
        "sandbox",
        "secret-delete",
        "secret_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      for (const result of [listed, attached, rotated, revoked, deleted]) {
        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain(CLI_SECRET);
        expect(result.stderr).not.toContain(CLI_SECRET);
        expect(result.stdout).toContain(
          "openpond://secret/team_test/secret_test"
        );
      }
      expect(
        requests.map((request) => `${request.method} ${request.url}`)
      ).toEqual([
        "GET /v1/sandbox-secrets",
        "POST /v1/sandbox-secrets/secret_test/attach",
        "POST /v1/sandbox-secrets/secret_test/rotate",
        "POST /v1/sandbox-secrets/secret_test/revoke",
        "DELETE /v1/sandbox-secrets/secret_test",
      ]);
      expect(requests[1]?.body).toMatchObject({
        envName: "FOO_API_KEY",
        targetType: "sandbox",
        targetId: "sandbox_test",
      });
      expect(requests[2]?.body).toMatchObject({
        value: CLI_SECRET,
      });
    });
  });

  test("sandbox template uploads reject .env files before reading them", async () => {
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "openpond-cli-env-upload-")
    );
    try {
      await writeFile(
        path.join(projectDir, "openpond.yaml"),
        [
          "schemaVersion: 1",
          "name: env-upload-test",
          "version: 0.0.1",
          "useCase: sandbox-template-example",
          "description: Upload guard test.",
          "runtime:",
          "  base: node-bun-workspace",
          "resources:",
          "  cpu: 1",
          "  memoryGb: 1",
          "  diskGb: 4",
          "start:",
          "  command: bun run index.ts",
          "actions: []",
          "services: []",
          "validation:",
          "  commands:",
          "    - test -f openpond.yaml",
          "inputs:",
          "  schema:",
          "    type: object",
          "    required:",
          "      - credentials",
          "    properties:",
          "      credentials:",
          "        type: string",
          "        x-openpond-upload:",
          "          targetPath: uploads",
          "",
        ].join("\n"),
        "utf8"
      );

      const result = await runCli(
        [
          "sandbox-template",
          "start",
          "--input-file",
          "credentials=.env.local",
          "--sandbox-api-url",
          "http://127.0.0.1:9/v1/sandboxes",
        ],
        "",
        { cwd: projectDir }
      );

      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain(CLI_SECRET);
      expect(result.stderr).not.toContain(CLI_SECRET);
      expect(result.stderr).toContain(
        "sandbox template uploads cannot include .env* files"
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("sandbox template env requirements validate without raw values", async () => {
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "openpond-cli-env-manifest-")
    );
    try {
      const manifestPath = path.join(projectDir, "openpond.yaml");
      const baseManifest = [
        "schemaVersion: 1",
        "name: env-manifest-test",
        "version: 0.0.1",
        "useCase: sandbox-template-example",
        "description: Env manifest guard test.",
        "runtime:",
        "  base: node-bun-workspace",
        "resources:",
        "  cpu: 1",
        "  memoryGb: 1",
        "  diskGb: 4",
        "start:",
        "  command: bun run index.ts",
        "actions: []",
        "services: []",
        "validation:",
        "  commands:",
        "    - test -f openpond.yaml",
        "inputs:",
        "  schema:",
        "    type: object",
        "  env:",
        "    - name: FOO_API_KEY",
        "      required: true",
        "      secret: true",
        "      description: API key for FOO.",
        "",
      ].join("\n");
      await writeFile(manifestPath, baseManifest, "utf8");

      const valid = await runCli(["sandbox-template", "validate"], "", {
        cwd: projectDir,
      });
      expect(valid.code).toBe(0);

      await writeFile(
        manifestPath,
        baseManifest.replace(
          "      description: API key for FOO.",
          "      value: should-not-be-here"
        ),
        "utf8"
      );
      const invalid = await runCli(["sandbox-template", "validate"], "", {
        cwd: projectDir,
      });
      expect(invalid.code).not.toBe(0);
      expect(invalid.stdout).not.toContain(CLI_SECRET);
      expect(invalid.stderr).not.toContain(CLI_SECRET);
      expect(invalid.stderr).toContain('Unrecognized key: "value"');
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("sandbox template start accepts input object schemas without properties", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const projectDir = await mkdtemp(
        path.join(os.tmpdir(), "openpond-cli-empty-inputs-")
      );
      try {
        await writeFile(
          path.join(projectDir, "openpond.yaml"),
          [
            "schemaVersion: 1",
            "name: empty-input-start",
            "version: 0.0.1",
            "useCase: sandbox-template-example",
            "description: Empty input schema start test.",
            "runtime:",
            "  base: node-bun-workspace",
            "resources:",
            "  cpu: 1",
            "  memoryGb: 1",
            "  diskGb: 4",
            "start:",
            "  command: echo scheduled",
            "actions: []",
            "services: []",
            "validation:",
            "  commands:",
            "    - test -f openpond.yaml",
            "inputs:",
            "  schema:",
            "    type: object",
            "schedules:",
            "  - name: daily-start",
            "    rate: 1 day",
            "    target:",
            "      kind: start",
            "",
          ].join("\n"),
          "utf8"
        );

        const result = await runCli(
          [
            "sandbox-template",
            "start",
            "--repo",
            "https://github.com/octocat/Hello-World",
            "--enable-schedules",
            "daily-start",
            "--sandbox-api-url",
            sandboxApiUrl,
          ],
          "",
          { cwd: projectDir }
        );

        expect(result.code).toBe(0);
        const scheduleRequest = requests.find(
          (request) =>
            request.method === "POST" &&
            request.url === "/v1/sandboxes/schedules"
        );
        expect(scheduleRequest?.body).toMatchObject({
          sourceSandboxId: "sandbox_test",
          name: "daily-start",
          scheduleType: "rate",
          scheduleExpression: "rate(1 day)",
          target: {
            kind: "command",
            command: "echo scheduled",
          },
        });
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    });
  });

  test("sandbox template start sends network, env refs, and sandbox runtime options", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const projectDir = await mkdtemp(
        path.join(os.tmpdir(), "openpond-cli-template-agent-")
      );
      try {
        await writeFile(
          path.join(projectDir, "openpond.yaml"),
          [
            "schemaVersion: 1",
            "name: agent-template-start",
            "version: 0.0.1",
            "useCase: sandbox-template-example",
            "description: Sandbox runtime template start test.",
            "runtime:",
            "  base: node-bun-workspace",
            "resources:",
            "  cpu: 1",
            "  memoryGb: 1",
            "  diskGb: 4",
            "start:",
            "  command: echo ok",
            "actions: []",
            "services: []",
            "validation:",
            "  commands:",
            "    - test -f openpond.yaml",
            "inputs:",
            "  schema:",
            "    type: object",
            "  env:",
            "    - name: FOO_API_KEY",
            "      required: true",
            "      secret: true",
            "network:",
            "  egress: allow",
            "",
          ].join("\n"),
          "utf8"
        );

        const result = await runCli(
          [
            "sandbox-template",
            "start",
            "--repo",
            "https://github.com/octocat/Hello-World",
            "--env-ref",
            "FOO_API_KEY=openpond://secret/team_test/secret_test#v1",
            "--runtime-mode",
            "attempt",
            "--runtime-project-id",
            "project_test",
            "--runtime-agent-id",
            "agent_test",
            "--runtime-base-branch",
            "master",
            "--runtime-promotion-policy",
            "manual",
            "--sandbox-api-url",
            sandboxApiUrl,
          ],
          "",
          { cwd: projectDir }
        );

        expect(result.code).toBe(0);
        const workspaceRequest = requests.find(
          (request) =>
            request.method === "POST" && request.url === "/v1/runtimes"
        );
        expect(workspaceRequest?.body).toMatchObject({
          projectId: "project_test",
          agentId: "agent_test",
          mode: "attempt",
          baseBranch: "master",
          promotionPolicy: "manual",
        });
        const createRequest = requests.find(
          (request) =>
            request.method === "POST" &&
            request.url === "/v1/runtimes/workspace_test/sandbox"
        );
        expect(createRequest?.body).toMatchObject({
          projectId: "project_test",
          agentId: "agent_test",
          env: [
            {
              name: "FOO_API_KEY",
              secretRef: "openpond://secret/team_test/secret_test#v1",
            },
          ],
          networkPolicy: {
            internetEgress: "allow",
          },
        });
        expect("sandboxRuntime" in (createRequest?.body ?? {})).toBe(false);
        const processRequest = requests.find(
          (request) =>
            request.method === "POST" &&
            request.url === "/v1/sandboxes/sandbox_test/processes"
        );
        expect(processRequest?.body.command).toContain(
          "OPENPOND_SANDBOX_RUNTIME_ID='workspace_test'"
        );
        expect(processRequest?.body.command).toContain(
          "OPENPOND_SANDBOX_ID='sandbox_test'"
        );
        expect(result.stdout).not.toContain(CLI_SECRET);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    });
  });
});

async function withSandboxApi(
  requests: CapturedRequest[],
  callback: (sandboxApiUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "",
      body,
      apiKey: request.headers["openpond-api-key"]?.toString() ?? null,
    });

    if (request.url === "/v1/sandbox-secrets" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secrets: [sandboxSecretRecord({ name: "FOO_API_KEY" })],
        })
      );
      return;
    }

    if (request.url === "/v1/sandboxes/pricing" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ pricing: sandboxPricingRateCard() }));
      return;
    }

    if (
      request.url === "/v1/sandboxes/costs?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          costs: {
            teamId: "team_test",
            ownerUserId: "user_test",
            pricing: sandboxPricingRateCard(),
            summary: {
              sandboxCount: 3,
              runningCount: 1,
              stoppedCount: 2,
              archivedCount: 0,
              receiptCount: 1,
              totalUsd: "0.000042",
              totalDurationSeconds: 42,
              activeReservedUsd: "0.050000",
              activeRemainingBudgetUsd: "0.049958",
              activeRunnerSlots: 1,
            },
            lineItems: [
              {
                label: "vCPU",
                unit: "vCPU-second",
                quantity: 1,
                amountUsd: "0.000042",
              },
            ],
            sandboxes: [
              {
                sandboxId: "sandbox_test",
                state: "running",
                repo: null,
                createdAt: "2026-05-20T00:00:00.000Z",
                updatedAt: "2026-05-20T00:00:01.000Z",
                receiptCount: 1,
                totalUsd: "0.000042",
                durationSeconds: 42,
                latestReceiptRef: "receipt_test",
                latestReceiptAt: "2026-05-20T00:00:01.000Z",
              },
            ],
            recentReceipts: [],
            generatedAt: "2026-05-20T00:00:01.000Z",
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/projects?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ projects: [sandboxProjectRecord()] }));
      return;
    }

    if (request.url === "/v1/projects" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          project: sandboxProjectRecord({
            name: String(body.name ?? "Demo Project"),
            sourceType: String(body.sourceType ?? "manual"),
            gitOwner: typeof body.gitOwner === "string" ? body.gitOwner : null,
            gitRepo: typeof body.gitRepo === "string" ? body.gitRepo : null,
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/projects/project_test?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ project: sandboxProjectRecord() }));
      return;
    }

    if (
      request.url === "/v1/projects/project_test?teamId=team_test" &&
      request.method === "PATCH"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          project: sandboxProjectRecord({
            description:
              typeof body.description === "string" ? body.description : null,
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/projects/project_test?teamId=team_test" &&
      request.method === "DELETE"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          project: sandboxProjectRecord({ status: "archived" }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agents: [sandboxAgentRecord()] }));
      return;
    }

    if (request.url === "/v1/agents" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agent: sandboxAgentRecord({
            name: String(body.name ?? "Daily Report"),
            selectedEntrypoint:
              typeof body.selectedEntrypoint === "object" &&
              body.selectedEntrypoint
                ? (body.selectedEntrypoint as Record<string, unknown>)
                : undefined,
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent: sandboxAgentRecord() }));
      return;
    }

    if (
      request.url === "/v1/agents/agent_test?teamId=team_test" &&
      request.method === "PATCH"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agent: sandboxAgentRecord({
            triggerType:
              body.triggerType === "background" ? "background" : "manual",
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test?teamId=team_test" &&
      request.method === "DELETE"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agent: sandboxAgentRecord({ status: "archived" }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test/run" &&
      request.method === "POST"
    ) {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agent: sandboxAgentRecord(),
          run: sandboxAgentRunRecord(body),
        })
      );
      return;
    }

    if (request.url === "/v1/runtimes" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ runtimes: [sandboxRuntimeRecord()] }));
      return;
    }

    if (
      request.url === "/v1/runtimes/workspace_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ runtime: sandboxRuntimeRecord() }));
      return;
    }

    if (
      request.url === "/v1/runtimes/workspace_test/events" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          events: [
            {
              id: "event_test",
              runtimeId: "workspace_test",
              sequence: 1,
              type: "workflow.waiting_for_user",
              summary: "waiting",
              actorType: "agent",
              actorId: "agent_test",
              payload: {},
              commitSha: null,
              snapshotId: null,
              logRef: null,
              artifactRefs: [],
              eventHash: "hash_test",
              previousEventHash: null,
              createdAt: "2026-05-20T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        })
      );
      return;
    }

    if (
      request.url === "/v1/runtimes/workspace_test/events" &&
      request.method === "POST"
    ) {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          runtime: sandboxRuntimeRecord(),
          event: {
            id: "event_written",
            runtimeId: "workspace_test",
            sequence: 2,
            type: body.type,
            summary: body.summary ?? null,
            payload: body.payload ?? {},
            lifecycleHint: body.lifecycleHint ?? null,
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/runtimes/workspace_test/status" &&
      request.method === "PATCH"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          runtime: {
            ...sandboxRuntimeRecord(),
            status: body.status,
          },
        })
      );
      return;
    }

    if (request.url === "/v1/sandbox-secrets" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({
            name: String(body.name ?? "FOO_API_KEY"),
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandbox-secrets/secret_test/attach" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({
            name: "FOO_API_KEY",
            attachments: [
              {
                envName: body.envName,
                targetType: body.targetType,
                targetId: body.targetId,
                attachedAt: "2026-05-20T00:00:00.000Z",
                detachedAt: null,
              },
            ],
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandbox-secrets/secret_test/rotate" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({
            name: "FOO_API_KEY",
            secretRef: "openpond://secret/team_test/secret_test#v2",
            currentVersion: 2,
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandbox-secrets/secret_test/revoke" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({
            name: "FOO_API_KEY",
            status: "revoked",
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandbox-secrets/secret_test" &&
      request.method === "DELETE"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({
            name: "FOO_API_KEY",
            status: "deleted",
          }),
        })
      );
      return;
    }

    if (request.url === "/v1/runtimes" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          runtime: sandboxRuntimeRecord({
            projectId:
              typeof body.projectId === "string" ? body.projectId : null,
            agentId: typeof body.agentId === "string" ? body.agentId : null,
          }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/runtimes/workspace_test/sandbox" &&
      request.method === "POST"
    ) {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          runtime: sandboxRuntimeRecord({
            projectId:
              typeof body.projectId === "string" ? body.projectId : null,
            agentId: typeof body.agentId === "string" ? body.agentId : null,
          }),
          sandbox: sandboxRecord({ runtimeId: "workspace_test" }),
        })
      );
      return;
    }

    if (request.url === "/v1/sandboxes" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord({ runtimeId: null }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/sandbox_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord({ runtimeId: "workspace_test" }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/sandbox_test/start" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord({ runtimeId: "workspace_test" }),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/sandbox_test/exec" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          command: sandboxCommandRecord(String(body.command ?? "true")),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/sandbox_test/files" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          file: {
            path: body.path,
            sizeBytes: String(body.contentsBase64 ?? "").length,
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/sandboxes/sandbox_test/files?path=src%2Fmessage.txt" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          file: {
            path: "src/message.txt",
            contentsBase64: Buffer.from(
              "hello from runtime files",
              "utf-8"
            ).toString("base64"),
            sizeBytes: "24",
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/sandbox_test/processes" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          process: sandboxProcessRecord(String(body.command ?? "echo ok")),
        })
      );
      return;
    }

    if (
      request.url === "/v1/sandboxes/schedules" &&
      request.method === "POST"
    ) {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          schedule: sandboxScheduleRecord(body),
        })
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("test server did not bind to a TCP port");
  }
  try {
    await callback(`http://127.0.0.1:${address.port}/v1/sandboxes`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function readJsonBody(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function runCli(
  args: string[],
  stdin = "",
  options: { cwd?: string } = {}
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "src/cli/main.ts"), ...args],
      {
        cwd: options.cwd ?? process.cwd(),
        env: {
          ...process.env,
          OPENPOND_API_KEY: "opk_test_cli",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function sandboxRecord(
  overrides: { runtimeId?: string | null } = {}
): Record<string, unknown> {
  return {
    id: "sandbox_test",
    state: "running",
    runtimeDriver: "remote-firecracker",
    repo: null,
    teamId: "team_test",
    projectId: null,
    agentId: null,
    visibility: "private",
    ownerUserId: "user_test",
    runtimeId: overrides.runtimeId ?? null,
    billingAccountId: "billing_test",
    resources: { cpu: 1, memoryGb: 1, diskGb: 4 },
    budget: { maxUsd: "0.05" },
    quotas: {},
    reservation: {
      capturedUsd: "0",
      mpp: null,
    },
    commands: [],
    integrationLeases: [],
    previewPorts: [],
    snapshots: [],
    archive: null,
    receipts: [],
    logs: [],
    metadata: {},
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    startedAt: "2026-05-20T00:00:00.000Z",
    stoppedAt: null,
    deletedAt: null,
  };
}

function sandboxRuntimeRecord(
  overrides: {
    projectId?: string | null;
    agentId?: string | null;
  } = {}
): Record<string, unknown> {
  return {
    id: "workspace_test",
    teamId: "team_test",
    userId: "user_test",
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    sandboxId: "sandbox_test",
    mode: "attempt",
    status: "waiting_for_user",
    baseBranch: "master",
    baseSha: null,
    currentSha: null,
    sourceRef: null,
    rootfsSnapshotId: null,
    dependencySnapshotId: null,
    checkpointSnapshotIds: [],
    artifactRefs: [],
    lifecyclePolicy: {
      mode: "auto",
      idleTimeoutSeconds: 900,
      archiveStoppedAfterSeconds: null,
      deleteAfterSeconds: null,
      retentionClass: "ephemeral",
    },
    checkpointPolicy: {
      workflow: "on_idle",
      source: "if_dirty",
      rootfs: "if_dirty",
      volumes: "explicit",
    },
    lifecycleState: {
      status: "waiting_for_user",
      lastInteractionAt: "2026-05-20T00:00:00.000Z",
      lastDirtyAt: null,
      lastCheckpointAt: null,
      lifecycleReason: "waiting_for_user",
    },
    promotionPolicy: "manual",
    permissions: {},
    metadata: {},
    version: 2,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function sandboxProjectRecord(
  overrides: {
    name?: string;
    description?: string | null;
    status?: string;
    sourceType?: string;
    gitOwner?: string | null;
    gitRepo?: string | null;
  } = {}
): Record<string, unknown> {
  return {
    id: "project_test",
    teamId: "team_test",
    createdByUserId: "user_test",
    name: overrides.name ?? "Demo Project",
    slug: "demo-project",
    description: overrides.description ?? null,
    status: overrides.status ?? "active",
    sourceType: overrides.sourceType ?? "internal_repo",
    sourceConfig: {},
    normalizedSourceIdentity: "internal_repo:openpond.ai:openpond/demo-project",
    externalId: null,
    gitProvider: null,
    gitHost: "openpond.ai",
    gitOwner: overrides.gitOwner ?? "openpond",
    gitRepo: overrides.gitRepo ?? "demo-project",
    gitBranch: null,
    defaultBranch: "master",
    internalRepoPath: null,
    templateSourceProjectId: null,
    templateRepoUrl: null,
    templateBranch: null,
    templateRemoteSha: null,
    sandboxManifest: null,
    sandboxActionRegistry: null,
    sandboxManifestHash: null,
    sandboxManifestPath: null,
    sandboxManifestSyncedAt: null,
    sandboxManifestError: null,
    metadata: {},
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    archivedAt:
      overrides.status === "archived" ? "2026-05-20T00:00:00.000Z" : null,
  };
}

function sandboxAgentRecord(
  overrides: {
    name?: string;
    status?: string;
    triggerType?: string;
    selectedEntrypoint?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  return {
    id: "agent_test",
    teamId: "team_test",
    createdByUserId: "user_test",
    name: overrides.name ?? "Daily Report",
    slug: "daily-report",
    description: null,
    status: overrides.status ?? "active",
    projectId: "project_test",
    workflowIntent: null,
    selectedEntrypoint: overrides.selectedEntrypoint ?? {
      scope: "entire_manifest",
      name: null,
    },
    triggerType: overrides.triggerType ?? "manual",
    endpointPolicy: {},
    backgroundTaskPolicy: {},
    defaultRuntimeMode: "attempt",
    defaultBranch: null,
    sourceRefOverride: null,
    defaultPromotionPolicy: "manual",
    defaultResourcePolicy: {},
    defaultLifecyclePolicy: {},
    defaultCheckpointPolicy: {},
    requiredIntegrationRefs: [],
    requiredEnvironmentVariableRefs: [],
    schedulePolicy: {},
    externalId: null,
    metadata: {},
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    archivedAt:
      overrides.status === "archived" ? "2026-05-20T00:00:00.000Z" : null,
  };
}

function sandboxAgentRunRecord(
  input: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: "agent_run_test",
    teamId: "team_test",
    projectId: "project_test",
    agentId: "agent_test",
    requestedByUserId: "user_test",
    idempotencyKey: input.idempotencyKey ?? null,
    triggerType: input.triggerType ?? "manual",
    status: "running",
    runtimeId: "workspace_test",
    sandboxId: "sandbox_test",
    selectedEntrypoint: { scope: "action", name: "hello" },
    input: input.input ?? {},
    metadata: input.metadata ?? {},
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    completedAt: null,
  };
}

function sandboxCommandRecord(command: string): Record<string, unknown> {
  return {
    id: "command_test",
    command,
    status: "succeeded",
    output: "",
    exitCode: 0,
    startedAt: "2026-05-20T00:00:00.000Z",
    completedAt: "2026-05-20T00:00:01.000Z",
  };
}

function sandboxProcessRecord(command: string): Record<string, unknown> {
  return {
    id: "process_test",
    command,
    status: "succeeded",
    output: "",
    exitCode: 0,
    startedAt: "2026-05-20T00:00:00.000Z",
    completedAt: "2026-05-20T00:00:01.000Z",
    durationMs: 1000,
    outputBytes: 0,
  };
}

function sandboxScheduleRecord(
  input: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: "schedule_test",
    teamId: "team_test",
    ownerUserId: "user_test",
    createdByUserId: "user_test",
    name: input.name,
    description: input.description ?? null,
    scheduleType: input.scheduleType,
    scheduleExpression: input.scheduleExpression,
    enabled: input.enabled ?? true,
    timezone: input.timezone ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    maxRuns: input.maxRuns ?? null,
    executionCount: 0,
    lifecycleStatus: "active",
    lifecycleReason: null,
    runtimePolicy: input.runtimePolicy ?? "run_and_stop",
    sourceSandboxId: input.sourceSandboxId ?? null,
    snapshotId: input.snapshotId ?? null,
    templateId: input.templateId ?? null,
    target: input.target ?? {
      kind: "command",
      actionName: null,
      command: null,
      requiresStart: false,
    },
    budget: input.budget ?? null,
    resources: input.resources ?? null,
    quotas: input.quotas ?? null,
    lifecycle: input.lifecycle ?? null,
    retentionPolicy: input.retentionPolicy ?? null,
    env: input.env ?? [],
    integrationLeases: input.integrationLeases ?? [],
    metadata: input.metadata ?? {},
    managementSource: input.managementSource ?? "api",
    manifestPath: input.manifestPath ?? null,
    awsScheduleProvider: null,
    awsScheduleName: null,
    awsScheduleArn: null,
    syncStatus: "pending",
    syncError: null,
    syncRequestedAt: null,
    lastSyncedAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function sandboxPricingRateCard(): Record<string, unknown> {
  return {
    currency: "USD",
    source: "openpond_poc_config",
    effectiveAt: "2026-05-20T00:00:00.000Z",
    rates: [
      {
        key: "cpu",
        label: "vCPU",
        unit: "vCPU-second",
        unitPriceUsd: "0.000010",
        unitPriceHourlyUsd: "0.036000",
        unitPriceMonthlyUsd: null,
      },
      {
        key: "memory",
        label: "Memory",
        unit: "GiB-second",
        unitPriceUsd: "0.000003",
        unitPriceHourlyUsd: "0.010800",
        unitPriceMonthlyUsd: null,
      },
      {
        key: "disk",
        label: "VM disk",
        unit: "GiB-second",
        unitPriceUsd: "0.000000",
        unitPriceHourlyUsd: "0.000072",
        unitPriceMonthlyUsd: null,
      },
      {
        key: "durable_volume_storage",
        label: "Durable volume storage",
        unit: "GiB-second",
        unitPriceUsd: "0.000000",
        unitPriceHourlyUsd: "0.000072",
        unitPriceMonthlyUsd: "0.051840",
      },
    ],
    tiers: [
      {
        key: "default",
        label: "Default",
        description:
          "Normal app workspaces, small dev servers, and basic test runs.",
        resources: {
          cpu: 1,
          memoryGb: 2,
          diskGb: 10,
        },
        goodFit: ["normal app workspace"],
        poorFit: ["large dependency installs"],
        keepRunningEstimate: {
          resources: {
            cpu: 1,
            memoryGb: 2,
            diskGb: 10,
          },
          matchedTierKey: "default",
          hourlyUsd: "0.058320",
          monthlyUsd: "41.990400",
          durationDays: 30,
          pricingSource: "openpond_poc_config",
          lineItems: [
            {
              label: "vCPU",
              quantity: 1,
              unit: "vCPU",
              hourlyUsd: "0.036000",
              monthlyUsd: "25.920000",
            },
            {
              label: "Memory",
              quantity: 2,
              unit: "GiB",
              hourlyUsd: "0.021600",
              monthlyUsd: "15.552000",
            },
            {
              label: "VM disk",
              quantity: 10,
              unit: "GiB",
              hourlyUsd: "0.000720",
              monthlyUsd: "0.518400",
            },
          ],
        },
      },
    ],
  };
}

function sandboxSecretRecord(input: {
  name: string;
  status?: string;
  secretRef?: string;
  currentVersion?: number;
  attachments?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    id: "secret_test",
    teamId: "team_test",
    ownerUserId: "user_test",
    name: input.name,
    description: null,
    scope: "team",
    status: input.status ?? "active",
    secretRef: input.secretRef ?? "openpond://secret/team_test/secret_test#v1",
    currentVersion: input.currentVersion ?? 1,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    lastUsedAt: null,
    deletedAt: input.status === "deleted" ? "2026-05-20T00:01:00.000Z" : null,
    attachments: input.attachments ?? [],
  };
}
