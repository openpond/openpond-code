import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

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
        `${CLI_SECRET}\n`,
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("openpond://secret/team_test/secret_test#v1");
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
    expect(result.stderr).toContain("sandbox secret values must be provided with --stdin or the masked prompt");
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
    expect(rejected.stderr).toContain("refusing plaintext value for secret-like env FOO_API_KEY");
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
        `${CLI_SECRET}\n`,
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
        `${CLI_SECRET}\n`,
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
        expect(result.stdout).toContain("openpond://secret/team_test/secret_test");
      }
      expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
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
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "openpond-cli-env-upload-"));
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
        "utf8",
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
        { cwd: projectDir },
      );

      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain(CLI_SECRET);
      expect(result.stderr).not.toContain(CLI_SECRET);
      expect(result.stderr).toContain("sandbox template uploads cannot include .env* files");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("sandbox template env requirements validate without raw values", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "openpond-cli-env-manifest-"));
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
          "      value: should-not-be-here",
        ),
        "utf8",
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
      const projectDir = await mkdtemp(path.join(os.tmpdir(), "openpond-cli-empty-inputs-"));
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
          "utf8",
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
          { cwd: projectDir },
        );

        expect(result.code).toBe(0);
        const scheduleRequest = requests.find(
          (request) =>
            request.method === "POST" &&
            request.url === "/v1/sandboxes/schedules",
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
});

async function withSandboxApi(
  requests: CapturedRequest[],
  callback: (sandboxApiUrl: string) => Promise<void>,
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
        }),
      );
      return;
    }

    if (request.url === "/v1/sandbox-secrets" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          secret: sandboxSecretRecord({ name: String(body.name ?? "FOO_API_KEY") }),
        }),
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
        }),
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
        }),
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
          secret: sandboxSecretRecord({ name: "FOO_API_KEY", status: "revoked" }),
        }),
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
          secret: sandboxSecretRecord({ name: "FOO_API_KEY", status: "deleted" }),
        }),
      );
      return;
    }

    if (request.url === "/v1/sandboxes" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ sandbox: sandboxRecord() }));
      return;
    }

    if (request.url === "/v1/sandboxes/sandbox_test/exec" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          command: sandboxCommandRecord(String(body.command ?? "true")),
        }),
      );
      return;
    }

    if (request.url === "/v1/sandboxes/sandbox_test/files" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          file: {
            path: body.path,
            sizeBytes: String(body.contentsBase64 ?? "").length,
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        }),
      );
      return;
    }

    if (request.url === "/v1/sandboxes/sandbox_test/processes" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord(),
          process: sandboxProcessRecord(String(body.command ?? "echo ok")),
        }),
      );
      return;
    }

    if (request.url === "/v1/sandboxes/schedules" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          schedule: sandboxScheduleRecord(body),
        }),
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function runCli(args: string[], stdin = "", options: { cwd?: string } = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "src/cli-package.ts"), ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        OPENPOND_API_KEY: "opk_test_cli",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
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

function sandboxRecord(): Record<string, unknown> {
  return {
    id: "sandbox_test",
    state: "running",
    runtimeDriver: "remote-firecracker",
    repo: null,
    teamId: "team_test",
    appId: null,
    visibility: "private",
    ownerUserId: "user_test",
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

function sandboxScheduleRecord(input: Record<string, unknown>): Record<string, unknown> {
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
