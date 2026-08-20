import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { cp, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { createOpenPondSandboxClient } from "../src/sandbox/client";

const CLI_SECRET = "cli-secret-value-that-must-not-echo";
const LARGE_RAW_MARKER = "raw-large-payload-that-must-not-echo";
const AGENT_SDK_PILOT_NAMES = [
  "blank-agent",
  "customer-reply-agent",
  "water-estimator-agent",
  "integration-heavy-agent",
] as const;
const TEST_AGENT_SDK_ROOT = path.resolve(
  process.env.OPENPOND_AGENT_SDK_PATH ??
    path.resolve(process.cwd(), "../openpond-agent-sdk")
);
const HAS_TEST_AGENT_SDK_SOURCE = existsSync(
  path.join(TEST_AGENT_SDK_ROOT, "package.json")
);

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
        "--workflow-mode",
        "feature",
        "--runtime-project-id",
        "project_test",
        "--runtime-agent-id",
        "agent_test",
        "--runtime-base-branch",
        "master",
        "--runtime-promotion-policy",
        "manual",
        "--runtime-profile-id",
        "openpond-coding-core-v1",
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
        workflowMode: "feature",
        baseBranch: "master",
        promotionPolicy: "manual",
        runtimeProfileId: "openpond-coding-core-v1",
      });
      expect(requests[1]?.body).toMatchObject({
        projectId: "project_test",
        agentId: "agent_test",
        runtimeProfileId: "openpond-coding-core-v1",
      });
      expect("sandboxRuntime" in (requests[1]?.body ?? {})).toBe(false);
      expect("workspacePurpose" in (requests[0]?.body ?? {})).toBe(false);
    });
  });

  test("sandbox create sends image and Dockerfile workload sources", async () => {
    const imageRequests: CapturedRequest[] = [];
    await withSandboxApi(imageRequests, async (sandboxApiUrl) => {
      const result = await runCli([
        "sandbox",
        "create",
        "--image",
        "python:3.12-slim-bookworm",
        "--image-digest",
        `sha256:${"a".repeat(64)}`,
        "--registry-secret-ref",
        "openpond://secret/team_test/registry#v1",
        "--command",
        "python --version",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(result.code).toBe(0);
      expect(imageRequests[0]?.url).toBe("/v1/sandboxes");
      expect(imageRequests[0]?.body).toMatchObject({
        command: "python --version",
        workloadSource: {
          image: {
            ref: "python:3.12-slim-bookworm",
            digest: `sha256:${"a".repeat(64)}`,
            registrySecretRef: "openpond://secret/team_test/registry#v1",
            platform: "linux/amd64",
          },
        },
      });
    });

    const dockerfileRequests: CapturedRequest[] = [];
    const dockerContext = await mkdtemp(
      path.join(os.tmpdir(), "openpond-cli-dockerfile-create-")
    );
    try {
      await writeFile(
        path.join(dockerContext, "Dockerfile"),
        "FROM python:3.12-slim-bookworm\nCOPY app.py /workspace/app.py\n"
      );
      await writeFile(path.join(dockerContext, "app.py"), "print('ok')\n");
      await writeFile(path.join(dockerContext, ".env.local"), "SECRET=skip\n");

      await withSandboxApi(dockerfileRequests, async (sandboxApiUrl) => {
        const result = await runCli(
          [
            "sandbox",
            "create",
            "--dockerfile",
            "Dockerfile",
            "--dockerfile-context",
            ".",
            "--dockerfile-target",
            "runtime",
            "--docker-build-args",
            '{"NODE_VERSION":"20"}',
            "--docker-registry-secret-refs",
            "openpond://secret/team_test/registry#v1",
            "--runtime-workspace-root",
            "/workspace/app",
            "--sandbox-api-url",
            sandboxApiUrl,
          ],
          "",
          { cwd: dockerContext }
        );

        expect(result.code).toBe(0);
        expect(dockerfileRequests[0]?.url).toBe("/v1/sandboxes");
        expect(dockerfileRequests[0]?.body).toMatchObject({
          workloadSource: {
            dockerfile: {
              path: "Dockerfile",
              context: ".",
              target: "runtime",
              buildArgs: { NODE_VERSION: "20" },
              registrySecretRefs: ["openpond://secret/team_test/registry#v1"],
              workspaceRoot: "/workspace/app",
              platform: "linux/amd64",
            },
          },
          sourceArchive: {
            source: "client_upload",
            ref: "client-upload",
          },
        });
        const sourceArchive = dockerfileRequests[0]?.body
          .sourceArchive as Record<string, unknown> | undefined;
        const archive = sourceArchive?.archive as
          | Record<string, unknown>
          | undefined;
        const entries = archive?.entries as
          | Array<Record<string, unknown>>
          | undefined;
        expect(entries?.map((entry) => entry.path).sort()).toEqual([
          "Dockerfile",
          "app.py",
        ]);
      });
    } finally {
      await rm(dockerContext, { recursive: true, force: true });
    }
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
        "--workflow-mode",
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
      const agentBindSource = await runCli([
        "agent",
        "bind-source",
        "agent_test",
        "--team-id",
        "team_test",
        "--source-mode",
        "published_snapshot",
        "--published-snapshot-id",
        "snapshot_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentSourceDeployPlan = await runCli([
        "agent",
        "source",
        "deploy-plan",
        "agent_test",
        "--team-id",
        "team_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentSourceChecks = await runCli([
        "agent",
        "source",
        "checks",
        "agent_test",
        "--team-id",
        "team_test",
        "--check-kind",
        "validate",
        "--source-ref",
        "master",
        "--metadata",
        '{"reason":"phase3"}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentSourceSnapshots = await runCli([
        "agent",
        "source",
        "manifest-snapshots",
        "agent_test",
        "--team-id",
        "team_test",
        "--limit",
        "2",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentSourcePublish = await runCli([
        "agent",
        "source",
        "publish",
        "agent_test",
        "--team-id",
        "team_test",
        "--expected-manifest-hash",
        "hash_test",
        "--work-item-id",
        "work_item_test",
        "--eval-status",
        "passed",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditOpen = await runCli([
        "agent",
        "edit",
        "open",
        "agent_test",
        "--team-id",
        "team_test",
        "--project-id",
        "project_test",
        "--message",
        "Update the agent",
        "--source-ref",
        "draft/ref",
        "--base-sha",
        "base_sha_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditChat = await runCli([
        "agent",
        "edit",
        "chat",
        "work_item_test",
        "--team-id",
        "team_test",
        "--message",
        "Please update copy",
        "--payload",
        '{"mode":"builder"}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditActivity = await runCli([
        "agent",
        "edit",
        "activity",
        "work_item_test",
        "--team-id",
        "team_test",
        "--limit",
        "2",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditBackground = await runCli([
        "agent",
        "edit",
        "background",
        "work_item_test",
        "--team-id",
        "team_test",
        "--prompt",
        "Run checks",
        "--agent-edit",
        '{"policyDiscovery":{"command":"openpond agent inspect --json","runAfter":"source-materialized"},"requiredChecks":["openpond agent validate"]}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditRequestChecks = await runCli([
        "agent",
        "edit",
        "request-checks",
        "agent_test",
        "--team-id",
        "team_test",
        "--check-kind",
        "eval",
        "--source-ref",
        "draft/ref",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentSourceCheckStatus = await runCli([
        "agent",
        "source",
        "check-status",
        "work_item_test",
        "--team-id",
        "team_test",
        "--limit",
        "2",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditCheckStatus = await runCli([
        "agent",
        "edit",
        "check-status",
        "work_item_test",
        "--team-id",
        "team_test",
        "--limit",
        "2",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditFailedSetupStatus = await runCli([
        "agent",
        "edit",
        "check-status",
        "work_item_failed_setup",
        "--team-id",
        "team_test",
        "--limit",
        "2",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditCheckpointResult = await runCli([
        "agent",
        "edit",
        "checkpoint-result",
        "work_item_test",
        "--team-id",
        "team_test",
        "--ref",
        "source_ref_test",
        "--metadata",
        '{"sourceHash":"hash_test"}',
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditCommitResult = await runCli([
        "agent",
        "edit",
        "commit-result",
        "work_item_test",
        "--team-id",
        "team_test",
        "--ref",
        "commit_ref_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const agentEditPrResult = await runCli([
        "agent",
        "edit",
        "pr-result",
        "work_item_test",
        "--team-id",
        "team_test",
        "--ref",
        "pr_ref_test",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(projectList.code).toBe(0);
      expect(projectCreate.code).toBe(0);
      expect(projectUpdate.code).toBe(0);
      expect(agentCreate.code).toBe(0);
      expect(agentUpdate.code).toBe(0);
      expect(agentRun.code).toBe(0);
      expect(agentBindSource.code).toBe(0);
      expect(agentSourceDeployPlan.code).toBe(0);
      expect(agentSourceChecks.code).toBe(0);
      expect(agentSourceSnapshots.code).toBe(0);
      expect(agentSourcePublish.code).toBe(0);
      expect(agentEditOpen.code).toBe(0);
      expect(agentEditChat.code).toBe(0);
      expect(agentEditActivity.code).toBe(0);
      expect(agentEditBackground.code).toBe(0);
      expect(agentEditRequestChecks.code).toBe(0);
      expect(agentSourceCheckStatus.code).toBe(0);
      expect(agentEditCheckpointResult.code).toBe(0);
      expect(agentEditCommitResult.code).toBe(0);
      expect(agentEditPrResult.code).toBe(0);
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
      expect(JSON.parse(agentBindSource.stdout).agentSource).toMatchObject({
        mode: "published_snapshot",
        publishedSnapshotId: "snapshot_test",
      });
      expect(
        JSON.parse(agentSourceDeployPlan.stdout).deployPlan
      ).toMatchObject({
        agentId: "agent_test",
        status: "ready",
      });
      expect(JSON.parse(agentSourceChecks.stdout)).toMatchObject({
        workItem: { id: "work_item_test" },
        activity: { id: "activity_checks" },
      });
      expect(
        JSON.parse(agentSourceSnapshots.stdout).manifestSnapshots[0]
      ).toMatchObject({
        id: "snapshot_test",
        manifestHash: "hash_test",
      });
      expect(JSON.parse(agentSourcePublish.stdout)).toMatchObject({
        activeManifestSnapshot: { id: "snapshot_test" },
        publishedAt: "2026-05-20T00:00:00.000Z",
      });
      expect(JSON.parse(agentEditOpen.stdout)).toMatchObject({
        workItem: { id: "work_item_test", projectId: "project_test" },
        created: true,
      });
      expect(JSON.parse(agentEditChat.stdout)).toMatchObject({
        userMessage: { id: "message_user" },
        assistantMessage: { id: "message_assistant" },
      });
      expect(JSON.parse(agentEditActivity.stdout).activity[0]).toMatchObject({
        id: "activity_checks",
        payload: {
          traceArtifactRef: "artifacts/openpond-trace.jsonl",
          evalResultArtifactRef: "artifacts/openpond-eval-results.json",
        },
      });
      expect(JSON.parse(agentEditBackground.stdout)).toMatchObject({
        activity: { id: "activity_background" },
      });
      expect(JSON.parse(agentEditRequestChecks.stdout)).toMatchObject({
        workItem: { id: "work_item_test" },
        activity: { id: "activity_checks" },
      });
      expect(
        JSON.parse(agentSourceCheckStatus.stdout).sourceCheckStatus
      ).toMatchObject({
        workItemId: "work_item_test",
        latestTaskRunId: "task_run_test",
        latestRuntimeId: "runtime_test",
        latestSandboxId: "sandbox_test",
        sourceMaterialization: {
          status: "completed",
          sourceCommitSha: "source_sha_test",
        },
        sourceUploadMetadata: {
          sourceTreeMode: "typescript_agent_sdk",
          commands: {
            inspect: "bun run agent:inspect",
            build: "bun run agent:build",
            validate: "bun run agent:validate",
            eval: "bun run agent:eval",
          },
          generatedManifestPath: ".openpond/openpond-manifest.preview.yaml",
          synthesizedOpenPondYaml: true,
          openPondYamlMode: "synthesized",
          uploadMetadataHash: {
            sha256:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            sizeBytes: 2816,
          },
          artifactHashes: {
            ".openpond/openpond-manifest.preview.yaml": {
              sha256:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
            "openpond.yaml": {
              sha256:
                "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            },
          },
          dependencySetup: {
            required: true,
            installCommand: "bun install --offline",
            expectedBinaryPath: "node_modules/.bin/openpond-agent",
            sdkPackage: {
              path: ".openpond/vendor/openpond-agent-sdk.tgz",
            },
            dependencyPackages: [
              {
                packageName: "yaml",
                path: ".openpond/vendor/npm/yaml.tgz",
              },
              {
                packageName: "zod",
                path: ".openpond/vendor/npm/zod.tgz",
              },
            ],
          },
          redactedSetupOutputRefs: [
            "openpond://coding-task-runs/task_run_test/setup-output",
          ],
        },
        setup: {
          status: "completed",
          passed: true,
          commands: ["bun install --offline"],
          expectedBinaryPath: "node_modules/.bin/openpond-agent",
        },
        policyDiscovery: {
          status: "completed",
          command: "openpond agent inspect --json",
          requiredChecks: ["openpond agent validate", "openpond agent eval"],
        },
        discoveredRequiredChecks: [
          "openpond agent validate",
          "openpond agent eval",
        ],
        checkRuns: [
          {
            command: "openpond agent validate",
            status: "passed",
            passed: true,
          },
        ],
        validation: { status: "passed", passed: true },
        requestedCheckKind: "validate",
        deployPlan: {
          status: "needs_validation",
          canDeploy: false,
          blockedReasons: ["source_commit_sha_missing"],
        },
        traceArtifactRefs: ["artifacts/openpond-trace.jsonl"],
        evalResultArtifactRefs: ["artifacts/openpond-eval-results.json"],
        validatorArtifactRefs: ["artifacts/validator-report.json"],
        patchArtifactRef: "openpond://coding-task-runs/task_run_test/patch",
        finalResultState: "completed",
        publishBlockers: ["source_commit_sha_missing"],
      });
      expect(agentSourceCheckStatus.stdout).not.toContain("raw setup output");
      expect(agentSourceCheckStatus.stdout).not.toContain("super_secret_value");
      expect(
        JSON.parse(agentEditCheckStatus.stdout).sourceCheckStatus
          .sourceUploadMetadata
      ).toMatchObject({
        sourceTreeMode: "typescript_agent_sdk",
        openPondYamlMode: "synthesized",
        dependencySetup: {
          sdkPackage: {
            path: ".openpond/vendor/openpond-agent-sdk.tgz",
          },
        },
      });
      expect(agentEditCheckStatus.stdout).not.toContain("raw setup output");
      expect(agentEditCheckStatus.stdout).not.toContain("super_secret_value");
      expect(
        JSON.parse(agentEditFailedSetupStatus.stdout).sourceCheckStatus
      ).toMatchObject({
        workItemId: "work_item_failed_setup",
        workItemStatus: "failed",
        latestTaskRunId: "task_run_failed_setup",
        latestRuntimeId: "runtime_failed_setup",
        latestSandboxId: "sandbox_failed_setup",
        setup: {
          status: "failed",
          message: "yaml@^2.9.0 failed to resolve",
          command: "bun install --offline",
          exitCode: 1,
          commands: ["bun install --offline"],
          expectedBinaryPath: "node_modules/.bin/openpond-agent",
          dependencyPackages: [
            {
              packageName: "yaml",
              source: "npm",
              versionSpec: "^2.9.0",
              path: ".openpond/vendor/npm/yaml.tgz",
              sha256: "sha_yaml",
              sizeBytes: 112086,
            },
          ],
        },
      });
      expect(JSON.parse(agentEditCheckpointResult.stdout)).toMatchObject({
        artifact: { id: "artifact_checkpoint", kind: "checkpoint" },
      });
      expect(JSON.parse(agentEditCommitResult.stdout)).toMatchObject({
        artifact: { id: "artifact_commit", kind: "commit" },
      });
      expect(JSON.parse(agentEditPrResult.stdout)).toMatchObject({
        artifact: { id: "artifact_pr", kind: "pr" },
      });
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/projects?teamId=team_test",
        "/v1/projects",
        "/v1/projects/project_test?teamId=team_test",
        "/v1/agents",
        "/v1/agents/agent_test?teamId=team_test",
        "/v1/agents/agent_test/run",
        "/v1/agents/agent_test?teamId=team_test",
        "/v1/agents/agent_test/source/deploy-plan?teamId=team_test",
        "/v1/agents/agent_test/source/checks?teamId=team_test",
        "/v1/agents/agent_test/source/manifest-snapshots?teamId=team_test&limit=2",
        "/v1/agents/agent_test/source/publish?teamId=team_test",
        "/v1/agents/agent_test/edit-work-item?teamId=team_test",
        "/v1/work-items/work_item_test/chat",
        "/v1/work-items/work_item_test/activity?teamId=team_test&limit=2",
        "/v1/work-items/work_item_test/handle-background",
        "/v1/agents/agent_test/source/checks?teamId=team_test",
        "/v1/work-items/work_item_test/status?teamId=team_test&limit=2&includeArchived=true",
        "/v1/work-items/work_item_test/status?teamId=team_test&limit=2&includeArchived=true",
        "/v1/work-items/work_item_failed_setup/status?teamId=team_test&limit=2&includeArchived=true",
        "/v1/work-items/work_item_test/result/checkpoint",
        "/v1/work-items/work_item_test/result/commit",
        "/v1/work-items/work_item_test/result/pr",
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
      expect(requests[6]?.body).toMatchObject({
        runtimeSource: {
          mode: "published_snapshot",
          publishedSnapshotId: "snapshot_test",
        },
      });
      expect(requests[8]?.body).toMatchObject({
        checkKind: "validate",
        sourceRef: "master",
        metadata: { reason: "phase3" },
      });
      expect(requests[10]?.body).toMatchObject({
        expectedManifestHash: "hash_test",
        workItemId: "work_item_test",
        evalStatus: "passed",
      });
      expect(requests[11]?.body).toMatchObject({
        projectId: "project_test",
        initialMessage: "Update the agent",
        sourceRef: "draft/ref",
        baseSha: "base_sha_test",
      });
      expect(requests[12]?.body).toMatchObject({
        teamId: "team_test",
        message: "Please update copy",
        mode: "queue_cloud",
        payload: { mode: "builder" },
      });
      expect(requests[14]?.body).toMatchObject({
        teamId: "team_test",
        prompt: "Run checks",
        agentEdit: {
          policyDiscovery: {
            command: "openpond agent inspect --json",
            runAfter: "source-materialized",
          },
          requiredChecks: ["openpond agent validate"],
        },
      });
      expect(requests[15]?.body).toMatchObject({
        checkKind: "eval",
        sourceRef: "draft/ref",
      });
      expect(requests[19]?.body).toMatchObject({
        teamId: "team_test",
        ref: "source_ref_test",
        metadata: { sourceHash: "hash_test" },
      });
      expect(requests[20]?.body).toMatchObject({
        teamId: "team_test",
        ref: "commit_ref_test",
      });
      expect(requests[21]?.body).toMatchObject({
        teamId: "team_test",
        ref: "pr_ref_test",
      });
    });
  });

  test("agent help separates local runs, remote runs, and source edits", async () => {
    const result = await runCli(["help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "openpond agent run <action> [--cwd <project>]"
    );
    expect(result.stdout).toContain(
      "openpond agent run <agentId> --team-id <id>"
    );
    expect(result.stdout).toContain("openpond agent source check-status");
    expect(result.stdout).toContain("openpond agent edit open <agentId>");
    expect(result.stdout).toContain(
      "openpond agent edit checkpoint-result|commit-result|pr-result"
    );
  });

  test("agent edit check-status classifies setup, policy, validation, eval, and publish failures", async () => {
    const cases = [
      {
        workItemId: "work_item_dependency_install_failure",
        expected: {
          sourceUploadMetadata: {
            sourceTreeMode: "typescript_agent_sdk",
            openPondYamlMode: "synthesized",
            dependencySetup: {
              sdkPackage: {
                path: ".openpond/vendor/openpond-agent-sdk.tgz",
              },
            },
          },
          setup: {
            status: "failed",
            command: "bun install --offline",
            exitCode: 1,
            message: "dependency install failed",
          },
        },
      },
      {
        workItemId: "work_item_missing_sdk_binary",
        expected: {
          policyDiscovery: {
            status: "failed",
            command: "bun run agent:inspect",
            exitCode: 127,
            message: "missing node_modules/.bin/openpond-agent",
          },
        },
      },
      {
        workItemId: "work_item_unresolved_file_dependency",
        expected: {
          setup: {
            status: "failed",
            command: "bun install --offline",
            exitCode: 1,
            message: "unresolved local file dependency",
          },
        },
      },
      {
        workItemId: "work_item_missing_artifact_directory",
        expected: {
          policyDiscovery: {
            status: "failed",
            command: "bun run agent:inspect",
            exitCode: 1,
            message: "missing generated artifact directory .openpond",
          },
        },
      },
      {
        workItemId: "work_item_missing_source_upload_metadata",
        expected: {
          sourceMaterialization: {
            status: "blocked",
            message: "missing .openpond/source-upload-metadata.json",
            blockedReason: "source_upload_metadata_missing",
          },
          policyDiscovery: {
            status: "blocked",
            message: "source-upload metadata missing",
          },
          publishBlockers: ["source_upload_metadata_missing"],
        },
        notContains: ["openpond-agent inspect --json"],
      },
      {
        workItemId: "work_item_stale_source_upload_metadata",
        expected: {
          sourceUploadMetadata: {
            status: "stale",
            staleReasons: ["artifact_hash_mismatch"],
            sourceTreeMode: "typescript_agent_sdk",
            openPondYamlMode: "synthesized",
          },
          policyDiscovery: {
            status: "blocked",
            message: "source-upload metadata is stale",
          },
          publishBlockers: ["source_upload_metadata_stale"],
        },
        notContains: ["openpond-agent inspect --json"],
      },
      {
        workItemId: "work_item_invalid_inspect_json",
        expected: {
          policyDiscovery: {
            status: "failed",
            command: "bun run agent:inspect",
            exitCode: 1,
            message: "invalid inspect JSON",
          },
        },
      },
      {
        workItemId: "work_item_validation_failure",
        expected: {
          validation: {
            status: "failed",
            passed: false,
          },
          checkRuns: [
            {
              command: "bun run agent:validate",
              status: "failed",
              passed: false,
              exitCode: 1,
            },
          ],
          validatorArtifactRefs: ["artifacts/validator-report.json"],
        },
      },
      {
        workItemId: "work_item_eval_failure",
        expected: {
          eval: {
            status: "failed",
            passed: false,
          },
          checkRuns: [
            {
              command: "bun run agent:eval",
              status: "failed",
              passed: false,
              exitCode: 1,
            },
          ],
          evalResultArtifactRefs: ["artifacts/openpond-eval-results.json"],
        },
      },
      {
        workItemId: "work_item_publish_blocked",
        expected: {
          deployPlan: {
            status: "blocked",
            canDeploy: false,
            blockedReasons: ["source_commit_sha_missing", "failed_checks"],
          },
          publishBlockers: ["source_commit_sha_missing", "failed_checks"],
        },
      },
    ];

    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      for (const testCase of cases) {
        const result = await runCli([
          "agent",
          "edit",
          "check-status",
          testCase.workItemId,
          "--team-id",
          "team_test",
          "--limit",
          "2",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]);

        if (result.code !== 0) {
          throw new Error(
            `${testCase.workItemId} check-status failed: ${[
              result.stdout.trim(),
              result.stderr.trim(),
            ]
              .filter(Boolean)
              .join("\n")}`
          );
        }
        expect(result.stdout).not.toContain("raw sandbox process output");
        expect(result.stdout).not.toContain("super_secret_value");
        for (const pattern of testCase.notContains ?? []) {
          expect(result.stdout).not.toContain(pattern);
        }
        expect(JSON.parse(result.stdout).sourceCheckStatus).toMatchObject({
          workItemId: testCase.workItemId,
          workItemStatus: "failed",
          latestTaskRunId: `${testCase.workItemId}_task`,
          latestRuntimeId: `${testCase.workItemId}_runtime`,
          latestSandboxId: `${testCase.workItemId}_sandbox`,
          ...testCase.expected,
        });
      }
    });
  });

  test("agent edit/source public outputs stay compact when API responses include large raw fields", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const commands = [
        await runCli([
          "agent",
          "edit",
          "background",
          "work_item_large",
          "--team-id",
          "team_test",
          "--prompt",
          "Run compact output check",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "edit",
          "activity",
          "work_item_large",
          "--team-id",
          "team_test",
          "--limit",
          "2",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "edit",
          "check-status",
          "work_item_large",
          "--team-id",
          "team_test",
          "--limit",
          "2",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "source",
          "check-status",
          "work_item_large",
          "--team-id",
          "team_test",
          "--limit",
          "2",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "edit",
          "checkpoint-result",
          "work_item_large",
          "--team-id",
          "team_test",
          "--ref",
          "source_ref_large",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "edit",
          "commit-result",
          "work_item_large",
          "--team-id",
          "team_test",
          "--ref",
          "commit_ref_large",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
        await runCli([
          "agent",
          "edit",
          "pr-result",
          "work_item_large",
          "--team-id",
          "team_test",
          "--ref",
          "pr_ref_large",
          "--sandbox-api-url",
          sandboxApiUrl,
        ]),
      ];

      for (const result of commands) {
        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain(LARGE_RAW_MARKER);
        expect(result.stdout.length).toBeLessThan(12_000);
        expect(result.stderr).not.toContain(LARGE_RAW_MARKER);
      }

      expect(JSON.parse(commands[0]!.stdout)).toMatchObject({
        workItem: { id: "work_item_large", status: "running" },
        activity: { id: "activity_large_background" },
      });
      expect(JSON.parse(commands[1]!.stdout)).toMatchObject({
        activity: [
          {
            id: "activity_large",
            payload: {
              traceArtifactRef: "artifacts/trace-large.jsonl",
              evalResultArtifactRef: "artifacts/eval-large.json",
            },
          },
        ],
      });
      for (const command of [commands[2], commands[3]]) {
        expect(JSON.parse(command!.stdout).sourceCheckStatus).toMatchObject({
          workItemId: "work_item_large",
          latestTaskRunId: "task_run_large",
          latestRuntimeId: "runtime_large",
          latestSandboxId: "sandbox_large",
          policyDiscovery: {
            status: "completed",
            command: "openpond agent inspect --json",
          },
          traceArtifactRefs: ["artifacts/trace-large.jsonl"],
          evalResultArtifactRefs: ["artifacts/eval-large.json"],
        });
      }
      expect(JSON.parse(commands[4]!.stdout)).toMatchObject({
        artifact: { id: "artifact_large_checkpoint", ref: "source_ref_large" },
      });
      expect(JSON.parse(commands[5]!.stdout)).toMatchObject({
        artifact: { id: "artifact_large_commit", ref: "commit_ref_large" },
      });
      expect(JSON.parse(commands[6]!.stdout)).toMatchObject({
        artifact: { id: "artifact_large_pr", ref: "pr_ref_large" },
      });
    });
  });

  test("project source-upload builds SDK agents and uploads generated manifest artifacts", async () => {
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "openpond-agent-sdk-upload-")
    );
    try {
      await writeAgentSdkUploadFixture(projectDir);
      await runTestCommand("git", ["init"], projectDir);

      const requests: CapturedRequest[] = [];
      await withSandboxApi(requests, async (sandboxApiUrl) => {
        const result = await runCli([
          "project",
          "source-upload",
          "project_test",
          "--team-id",
          "team_test",
          "--path",
          projectDir,
          "--sandbox-api-url",
          sandboxApiUrl,
        ]);

        expect(result.code).toBe(0);
        const body = requests[0]?.body as {
          entries?: Array<{ path: string; contentsBase64?: string }>;
        };
        const paths = (body.entries ?? []).map((entry) => entry.path).sort();
        expect(paths).toContain("agent/agent.ts");
        expect(paths).toContain("package.json");
        expect(paths).toContain("openpond.yaml");
        expect(paths).toContain(".openpond/agent-inspect.json");
        expect(paths).toContain(".openpond/agent-manifest.json");
        expect(paths).toContain(".openpond/action-registry.json");
        expect(paths).toContain(".openpond/openpond-manifest.preview.yaml");
        expect(paths).toContain(".openpond/runtime-bridge.mjs");
        expect(paths).toContain(".openpond/validator-report.md");
        expect(paths).toContain(".openpond/source-upload-metadata.json");
        expect(paths).toContain(".openpond/vendor/openpond-agent-sdk.tgz");
        expect(paths).toContain(".openpond/vendor/npm/fixture-runtime-dep.tgz");
        expect(paths).not.toContain(".openpond/eval-results.json");
        expect(paths).not.toContain(".openpond/local-sdk-source/package.json");
        expect(paths.some((entryPath) => entryPath.startsWith("node_modules/"))).toBe(false);

        const uploadedPackageJson = body.entries?.find(
          (entry) => entry.path === "package.json"
        );
        expect(uploadedPackageJson?.contentsBase64).toBeTruthy();
        const uploadedPackage = JSON.parse(
          Buffer.from(
            uploadedPackageJson?.contentsBase64 ?? "",
            "base64"
          ).toString("utf8")
        ) as {
          dependencies?: Record<string, string>;
          overrides?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        };
        expect(uploadedPackage.dependencies?.["openpond-agent-sdk"]).toBe(
          "file:.openpond/vendor/openpond-agent-sdk.tgz"
        );
        expect(uploadedPackage.dependencies?.["fixture-runtime-dep"]).toBe(
          "file:.openpond/vendor/npm/fixture-runtime-dep.tgz"
        );
        expect(uploadedPackage.overrides?.["fixture-runtime-dep"]).toBe(
          "file:.openpond/vendor/npm/fixture-runtime-dep.tgz"
        );
        expect(uploadedPackage.devDependencies?.["openpond-agent-sdk"]).toBeUndefined();
        expect(uploadedPackage.peerDependencies?.["openpond-agent-sdk"]).toBeUndefined();

        const openPondYaml = body.entries?.find(
          (entry) => entry.path === "openpond.yaml"
        );
        expect(openPondYaml?.contentsBase64).toBeTruthy();
        const openPondYamlSource = Buffer.from(
          openPondYaml?.contentsBase64 ?? "",
          "base64"
        ).toString("utf8");
        expect(openPondYamlSource).toContain("schemaVersion: 1");
        expect(openPondYamlSource).toContain("setup:\n  commands:\n    - bun install --offline");
        expect(openPondYamlSource).not.toContain(
          "schema: openpond.runtime.manifest.v1"
        );
        const uploadMetadata = body.entries?.find(
          (entry) => entry.path === ".openpond/source-upload-metadata.json"
        );
        expect(uploadMetadata?.contentsBase64).toBeTruthy();
        const uploadMetadataSource = Buffer.from(
          uploadMetadata?.contentsBase64 ?? "",
          "base64"
        ).toString("utf8");
        const uploadMetadataJson = JSON.parse(
          uploadMetadataSource
        ) as {
          schema?: string;
          sourceTreeMode?: string;
          packageManager?: string;
          sdk?: { packageName?: string; versionSpec?: string };
          commands?: Record<string, string>;
          dependencySetup?: {
            required?: boolean;
            packageManager?: string;
            installCommand?: string;
            commands?: string[];
            expectedBinaryPath?: string;
            generatedArtifactDirectory?: string;
            sdkPackage?: {
              source?: string;
              path?: string;
              sha256?: string;
              sizeBytes?: number;
            };
            dependencyPackages?: Array<{
              packageName?: string;
              source?: string;
              versionSpec?: string;
              path?: string;
              sha256?: string;
              sizeBytes?: number;
            }>;
          };
          generatedManifestPath?: string;
          synthesizedOpenPondYaml?: boolean;
          artifactHashes?: Record<string, { sha256?: string; sizeBytes?: number }>;
        };
        expect(uploadMetadataJson).toMatchObject({
          schema: "openpond.agent.source_upload.v1",
          sourceTreeMode: "typescript_agent_sdk",
          packageManager: "unknown",
          sdk: {
            packageName: "openpond-agent-sdk",
            versionSpec: "file:.openpond/local-sdk-source",
          },
          commands: {
            inspect: "bun run agent:inspect",
            build: "bun run agent:build",
            validate: "bun run agent:validate",
            eval: "bun run agent:eval",
          },
          generatedManifestPath: ".openpond/openpond-manifest.preview.yaml",
          synthesizedOpenPondYaml: true,
          dependencySetup: {
            required: true,
            packageManager: "unknown",
            installCommand: "bun install --offline",
            commands: ["bun install --offline"],
            expectedBinaryPath: "node_modules/.bin/openpond-agent",
            generatedArtifactDirectory: ".openpond",
            sdkPackage: {
              source: "uploaded_tarball",
              path: ".openpond/vendor/openpond-agent-sdk.tgz",
            },
            dependencyPackages: [
              {
                packageName: "fixture-runtime-dep",
                source: "npm_dependency_tarball",
                versionSpec: "file:../fixture-runtime-dep",
                path: ".openpond/vendor/npm/fixture-runtime-dep.tgz",
              },
            ],
          },
        });
        expect(
          uploadMetadataJson.dependencySetup?.sdkPackage?.sha256
        ).toMatch(/^[a-f0-9]{64}$/);
        expect(
          uploadMetadataJson.dependencySetup?.sdkPackage?.sizeBytes
        ).toBeGreaterThan(0);
        expect(
          uploadMetadataJson.dependencySetup?.dependencyPackages?.[0]?.sha256
        ).toMatch(/^[a-f0-9]{64}$/);
        expect(
          uploadMetadataJson.dependencySetup?.dependencyPackages?.[0]?.sizeBytes
        ).toBeGreaterThan(0);
        expect(
          uploadMetadataJson.artifactHashes?.[
            ".openpond/openpond-manifest.preview.yaml"
          ]?.sha256
        ).toMatch(/^[a-f0-9]{64}$/);
        expect(uploadMetadataJson.artifactHashes?.["openpond.yaml"]?.sha256).toMatch(
          /^[a-f0-9]{64}$/
        );

        const output = JSON.parse(result.stdout) as {
          uploaded?: {
            agentSdk?: {
              generatedManifestPath?: string;
              synthesizedOpenPondYaml?: boolean;
              uploadMetadataPath?: string;
              commands?: Record<string, string>;
              dependencySetup?: Record<string, unknown>;
              packageManager?: string;
              sourceTreeMode?: string;
              uploadMetadataHash?: { sha256?: string; sizeBytes?: number };
              artifactHashes?: Record<string, { sha256?: string }>;
            };
          };
        };
        expect(output.uploaded?.agentSdk).toMatchObject({
          generatedManifestPath: ".openpond/openpond-manifest.preview.yaml",
          synthesizedOpenPondYaml: true,
          uploadMetadataPath: ".openpond/source-upload-metadata.json",
          packageManager: "unknown",
          sourceTreeMode: "typescript_agent_sdk",
          commands: {
            inspect: "bun run agent:inspect",
            build: "bun run agent:build",
            validate: "bun run agent:validate",
            eval: "bun run agent:eval",
          },
          dependencySetup: {
            required: true,
            installCommand: "bun install --offline",
          },
        });
        expect(output.uploaded?.agentSdk?.uploadMetadataHash).toEqual({
          sha256: createHash("sha256").update(uploadMetadataSource).digest("hex"),
          sizeBytes: Buffer.byteLength(uploadMetadataSource, "utf8"),
        });
        expect(
          output.uploaded?.agentSdk?.artifactHashes?.["openpond.yaml"]?.sha256
        ).toMatch(/^[a-f0-9]{64}$/);

        const materializedDir = await mkdtemp(
          path.join(os.tmpdir(), "openpond-agent-sdk-materialized-")
        );
        try {
          await writeSourceUploadEntriesToDirectory(
            body.entries ?? [],
            materializedDir
          );
          await runDependencySetupFromUploadMetadata(materializedDir);

          const inspectResult = await runTestCommandWithOutput(
            "bun",
            ["run", "agent:inspect"],
            materializedDir
          );
          expect(JSON.parse(inspectResult.stdout)).toMatchObject({
            editable: { enabled: true },
          });

          await runTestCommand("bun", ["run", "agent:validate"], materializedDir);
          await runTestCommand("bun", ["run", "agent:eval"], materializedDir);

          const materializedEval = await readFile(
            path.join(materializedDir, ".openpond", "eval-results.json"),
            "utf8"
          );
          expect(JSON.parse(materializedEval)).toMatchObject({ ok: true });
        } finally {
          await rm(materializedDir, { recursive: true, force: true });
        }
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("project source-upload supports SDK agent folders without git metadata", async () => {
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "openpond-agent-sdk-nongit-upload-")
    );
    try {
      await writeAgentSdkUploadFixture(projectDir);

      const requests: CapturedRequest[] = [];
      await withSandboxApi(requests, async (sandboxApiUrl) => {
        const result = await runCli([
          "project",
          "source-upload",
          "project_test",
          "--team-id",
          "team_test",
          "--path",
          projectDir,
          "--sandbox-api-url",
          sandboxApiUrl,
        ]);

        expect(result.code).toBe(0);
        const body = requests[0]?.body as {
          entries?: Array<{ path: string; contentsBase64?: string }>;
        };
        const paths = (body.entries ?? []).map((entry) => entry.path).sort();
        expect(paths).toContain("agent/agent.ts");
        expect(paths).toContain("package.json");
        expect(paths).toContain("openpond.yaml");
        expect(paths).toContain(".openpond/agent-inspect.json");
        expect(paths).toContain(".openpond/agent-manifest.json");
        expect(paths).toContain(".openpond/action-registry.json");
        expect(paths).toContain(".openpond/openpond-manifest.preview.yaml");
        expect(paths).toContain(".openpond/runtime-bridge.mjs");
        expect(paths).toContain(".openpond/validator-report.md");
        expect(paths).toContain(".openpond/source-upload-metadata.json");
        expect(paths).not.toContain(".openpond/eval-results.json");
        expect(paths.some((entryPath) => entryPath.startsWith(".git/"))).toBe(
          false
        );
        expect(paths.some((entryPath) => entryPath.startsWith("node_modules/"))).toBe(false);

        const uploadedPackageJson = body.entries?.find(
          (entry) => entry.path === "package.json"
        );
        expect(uploadedPackageJson?.contentsBase64).toBeTruthy();
        const uploadedPackageSource = Buffer.from(
          uploadedPackageJson?.contentsBase64 ?? "",
          "base64"
        ).toString("utf8");
        expect(uploadedPackageSource).not.toContain(projectDir);
        expect(uploadedPackageSource).not.toContain("file:../");
        expect(uploadedPackageSource).not.toContain(
          ".openpond/local-sdk-source"
        );
        const uploadedPackage = JSON.parse(uploadedPackageSource) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          overrides?: Record<string, string>;
        };
        expect(uploadedPackage.scripts).toMatchObject({
          "agent:inspect": "openpond-agent inspect --json",
          "agent:validate": "openpond-agent validate",
          "agent:eval": "openpond-agent eval",
        });
        expect(uploadedPackage.dependencies?.["openpond-agent-sdk"]).toBe(
          "file:.openpond/vendor/openpond-agent-sdk.tgz"
        );
        expect(uploadedPackage.dependencies?.["fixture-runtime-dep"]).toBe(
          "file:.openpond/vendor/npm/fixture-runtime-dep.tgz"
        );
        expect(uploadedPackage.overrides?.["fixture-runtime-dep"]).toBe(
          "file:.openpond/vendor/npm/fixture-runtime-dep.tgz"
        );

        const uploadMetadata = body.entries?.find(
          (entry) => entry.path === ".openpond/source-upload-metadata.json"
        );
        expect(uploadMetadata?.contentsBase64).toBeTruthy();
        const uploadMetadataSource = Buffer.from(
          uploadMetadata?.contentsBase64 ?? "",
          "base64"
        ).toString("utf8");
        expect(uploadMetadataSource).not.toContain(projectDir);
        const uploadMetadataJson = JSON.parse(uploadMetadataSource) as {
          dependencySetup?: {
            sdkPackage?: { path?: string };
            dependencyPackages?: Array<{ path?: string }>;
          };
        };
        expect(uploadMetadataJson.dependencySetup?.sdkPackage?.path).toBe(
          ".openpond/vendor/openpond-agent-sdk.tgz"
        );
        expect(
          uploadMetadataJson.dependencySetup?.dependencyPackages?.[0]?.path
        ).toBe(".openpond/vendor/npm/fixture-runtime-dep.tgz");

        const materializedDir = await mkdtemp(
          path.join(os.tmpdir(), "openpond-agent-sdk-nongit-materialized-")
        );
        try {
          await writeSourceUploadEntriesToDirectory(
            body.entries ?? [],
            materializedDir
          );
          await runDependencySetupFromUploadMetadata(materializedDir);

          const inspectResult = await runTestCommandWithOutput(
            "bun",
            ["run", "agent:inspect"],
            materializedDir
          );
          expect(JSON.parse(inspectResult.stdout)).toMatchObject({
            editable: { enabled: true },
          });

          await runTestCommand("bun", ["run", "agent:validate"], materializedDir);
          await runTestCommand("bun", ["run", "agent:eval"], materializedDir);

          const materializedEval = await readFile(
            path.join(materializedDir, ".openpond", "eval-results.json"),
            "utf8"
          );
          expect(JSON.parse(materializedEval)).toMatchObject({ ok: true });
        } finally {
          await rm(materializedDir, { recursive: true, force: true });
        }
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!HAS_TEST_AGENT_SDK_SOURCE)(
    "project source-upload materializes pilots copied from a packed SDK install",
    async () => {
    const sdkRoot = resolveTestAgentSdkRoot();
    const workRoot = await mkdtemp(
      path.join(os.tmpdir(), "openpond-agent-sdk-packed-upload-")
    );
    try {
      const packDir = path.join(workRoot, "pack");
      await mkdir(packDir, { recursive: true });
      await runTestCommand("bun", ["run", "build"], sdkRoot);
      const packResult = await runTestCommandWithOutput(
        "npm",
        ["pack", "--silent", "--pack-destination", packDir],
        sdkRoot
      );
      const tarballName = packResult.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop();
      expect(tarballName).toBeTruthy();
      const sdkTarballPath = path.join(packDir, tarballName ?? "");

      const requests: CapturedRequest[] = [];
      await withSandboxApi(requests, async (sandboxApiUrl) => {
        for (const pilotName of AGENT_SDK_PILOT_NAMES) {
          const projectDir = path.join(workRoot, "pilots", pilotName);
          await cp(path.join(sdkRoot, "examples", pilotName), projectDir, {
            recursive: true,
          });
          await rm(path.join(projectDir, ".openpond"), {
            recursive: true,
            force: true,
          });
          await rm(path.join(projectDir, "node_modules"), {
            recursive: true,
            force: true,
          });
          await rewriteAgentSdkDependencyForTest(
            projectDir,
            `file:${path.relative(projectDir, sdkTarballPath)}`
          );
          await runTestCommand("bun", ["install"], projectDir);

          requests.length = 0;
          const result = await runCli([
            "project",
            "source-upload",
            "project_test",
            "--team-id",
            "team_test",
            "--path",
            projectDir,
            "--sandbox-api-url",
            sandboxApiUrl,
          ]);

          expect(result.code).toBe(0);
          const body = requests[0]?.body as {
            entries?: Array<{ path: string; contentsBase64?: string }>;
          };
          const paths = (body.entries ?? [])
            .map((entry) => entry.path)
            .sort();
          expect(paths).toContain("agent/agent.ts");
          expect(paths).toContain("package.json");
          expect(paths).toContain("openpond.yaml");
          expect(paths).toContain(".openpond/source-upload-metadata.json");
          expect(paths).toContain(".openpond/vendor/openpond-agent-sdk.tgz");
          expect(paths).toContain(".openpond/vendor/npm/yaml.tgz");
          expect(paths).toContain(".openpond/vendor/npm/zod.tgz");
          expect(
            paths.some((entryPath) => entryPath.startsWith("node_modules/"))
          ).toBe(false);

          const uploadedPackageJson = body.entries?.find(
            (entry) => entry.path === "package.json"
          );
          expect(uploadedPackageJson?.contentsBase64).toBeTruthy();
          const uploadedPackage = JSON.parse(
            Buffer.from(
              uploadedPackageJson?.contentsBase64 ?? "",
              "base64"
            ).toString("utf8")
          ) as {
            dependencies?: Record<string, string>;
            overrides?: Record<string, string>;
          };
          expect(uploadedPackage.dependencies?.["openpond-agent-sdk"]).toBe(
            "file:.openpond/vendor/openpond-agent-sdk.tgz"
          );
          expect(uploadedPackage.dependencies?.yaml).toBe(
            "file:.openpond/vendor/npm/yaml.tgz"
          );
          expect(uploadedPackage.dependencies?.zod).toBe(
            "file:.openpond/vendor/npm/zod.tgz"
          );
          expect(uploadedPackage.overrides?.yaml).toBe(
            "file:.openpond/vendor/npm/yaml.tgz"
          );
          expect(uploadedPackage.overrides?.zod).toBe(
            "file:.openpond/vendor/npm/zod.tgz"
          );

          const output = JSON.parse(result.stdout) as {
            uploaded?: {
              agentSdk?: {
                sourceTreeMode?: string;
                synthesizedOpenPondYaml?: boolean;
                uploadMetadataHash?: { sha256?: string };
              };
            };
          };
          expect(output.uploaded?.agentSdk).toMatchObject({
            sourceTreeMode: "typescript_agent_sdk",
            synthesizedOpenPondYaml: true,
          });
          expect(output.uploaded?.agentSdk?.uploadMetadataHash?.sha256).toMatch(
            /^[a-f0-9]{64}$/
          );

          const materializedDir = await mkdtemp(
            path.join(
              os.tmpdir(),
              `openpond-agent-sdk-packed-${pilotName}-materialized-`
            )
          );
          try {
            await writeSourceUploadEntriesToDirectory(
              body.entries ?? [],
              materializedDir
            );
            await runDependencySetupFromUploadMetadata(materializedDir);
            const inspectResult = await runTestCommandWithOutput(
              "bun",
              ["run", "agent:inspect"],
              materializedDir
            );
            expect(JSON.parse(inspectResult.stdout)).toMatchObject({
              editable: { enabled: true },
            });
            await runTestCommand(
              "bun",
              ["run", "agent:validate"],
              materializedDir
            );
            await runTestCommand("bun", ["run", "agent:eval"], materializedDir);
          } finally {
            await rm(materializedDir, { recursive: true, force: true });
          }
        }
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  }, 120_000);

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
    }
  );

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
        workflowMode: "feature",
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
        workflowMode: "feature",
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

  test("sandbox SDK and CLI expose patch export, source preservation, and guarded lifecycle", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const client = createOpenPondSandboxClient({
        apiKey: "opk_test_cli",
        sandboxApiUrl,
      });

      const exported = await client.gitExportPatch("sandbox_test", {
        baseRef: "openpond/base",
      });
      const preserved = await client.runtimes.preserveSource(
        "workspace_test",
        {
          sandboxId: "sandbox_test",
          message: "Preserve hosted changes",
        },
        { teamId: "team_test" }
      );
      await client.stop("sandbox_test", {
        failOnUnpreservedChanges: true,
      });
      await client.delete("sandbox_test", {
        failOnUnpreservedChanges: true,
      });

      const cliPatch = await runCli([
        "sandbox",
        "git-export-patch",
        "sandbox_test",
        "--base-ref",
        "openpond/base",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const cliPreserve = await runCli([
        "sandbox",
        "runtime-preserve-source",
        "workspace_test",
        "--team-id",
        "team_test",
        "--sandbox-id",
        "sandbox_test",
        "--message",
        "Preserve hosted changes",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const cliStop = await runCli([
        "sandbox",
        "stop",
        "sandbox_test",
        "--fail-on-unpreserved-changes",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);
      const cliDelete = await runCli([
        "sandbox",
        "delete",
        "sandbox_test",
        "--fail-on-unpreserved-changes",
        "--sandbox-api-url",
        sandboxApiUrl,
      ]);

      expect(exported.patch.sha256).toBe("a".repeat(64));
      expect(preserved.preservedSha).toBe("feed123");
      for (const result of [cliPatch, cliPreserve, cliStop, cliDelete]) {
        expect(result.code).toBe(0);
      }
      expect(JSON.parse(cliPatch.stdout).patch.sha256).toBe("a".repeat(64));
      expect(JSON.parse(cliPreserve.stdout).preservedSha).toBe("feed123");
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/sandboxes/sandbox_test/git/export-patch",
        "/v1/runtimes/workspace_test/preserve-source?teamId=team_test",
        "/v1/sandboxes/sandbox_test/stop?failOnUnpreservedChanges=true",
        "/v1/sandboxes/sandbox_test?failOnUnpreservedChanges=true",
        "/v1/sandboxes/sandbox_test/git/export-patch",
        "/v1/runtimes/workspace_test/preserve-source?teamId=team_test",
        "/v1/sandboxes/sandbox_test/stop?failOnUnpreservedChanges=true",
        "/v1/sandboxes/sandbox_test?failOnUnpreservedChanges=true",
      ]);
      expect(requests[0]?.body).toEqual({ baseRef: "openpond/base" });
      expect(requests[1]?.body).toEqual({
        sandboxId: "sandbox_test",
        message: "Preserve hosted changes",
      });
      expect(requests[4]?.body).toEqual({ baseRef: "openpond/base" });
      expect(requests[5]?.body).toEqual({
        sandboxId: "sandbox_test",
        message: "Preserve hosted changes",
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
            "--workflow-mode",
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
            workflowMode: "attempt",
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

  test("sandbox template start sends Dockerfile workload source", async () => {
    const requests: CapturedRequest[] = [];
    await withSandboxApi(requests, async (sandboxApiUrl) => {
      const projectDir = await mkdtemp(
        path.join(os.tmpdir(), "openpond-cli-template-dockerfile-")
      );
      try {
        await writeFile(
          path.join(projectDir, "openpond.yaml"),
          [
            "schemaVersion: 1",
            "name: dockerfile-template-start",
            "version: 0.0.1",
            "useCase: sandbox-template-example",
            "description: Dockerfile template start test.",
            "runtime:",
            "  dockerfile:",
            "    context: .",
            "    path: Dockerfile",
            "    target: runtime",
            "    buildArgs:",
            "      NODE_VERSION: \"20\"",
            "resources:",
            "  cpu: 1",
            "  memoryGb: 1",
            "  diskGb: 4",
            "start:",
            "  command: node app.js",
            "actions: []",
            "services: []",
            "validation:",
            "  commands:",
            "    - test -f Dockerfile",
            "",
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          path.join(projectDir, "Dockerfile"),
          "FROM node:20\n",
          "utf8"
        );

        const result = await runCli(
          [
            "sandbox-template",
            "start",
            "--repo",
            "https://github.com/octocat/Hello-World",
            "--sandbox-api-url",
            sandboxApiUrl,
          ],
          "",
          { cwd: projectDir }
        );

        expect(result.code).toBe(0);
        const createRequest = requests.find(
          (request) =>
            request.method === "POST" && request.url === "/v1/sandboxes"
        );
        expect(createRequest?.body).toMatchObject({
          workloadSource: {
            dockerfile: {
              context: ".",
              path: "Dockerfile",
              target: "runtime",
              buildArgs: { NODE_VERSION: "20" },
            },
          },
        });
        const processRequest = requests.find(
          (request) =>
            request.method === "POST" &&
            request.url === "/v1/sandboxes/sandbox_test/processes"
        );
        expect(processRequest?.body.command).toContain("node app.js");
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
      request.url === "/v1/projects/project_test/source?teamId=team_test" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          project: sandboxProjectRecord({
            sourceType: "internal_repo",
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
      const runtimeSource =
        body.runtimeSource &&
        typeof body.runtimeSource === "object" &&
        !Array.isArray(body.runtimeSource)
          ? (body.runtimeSource as Record<string, unknown>)
          : undefined;
      response.end(
        JSON.stringify({
          agent: {
            ...sandboxAgentRecord({
              triggerType:
                body.triggerType === "background" ? "background" : "manual",
            }),
            ...(runtimeSource ? { runtimeSource } : {}),
          },
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

    if (
      request.url ===
        "/v1/agents/agent_test/source/deploy-plan?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ deployPlan: sandboxAgentSourceDeployPlanRecord() })
      );
      return;
    }

    if (
      request.url ===
        "/v1/agents/agent_test/source/manifest-snapshots?teamId=team_test&limit=2" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          manifestSnapshots: [sandboxAgentManifestSnapshotRecord()],
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test/source/checks?teamId=team_test" &&
      request.method === "POST"
    ) {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_test",
            projectId: "project_test",
            assignedAgentId: "agent_test",
          },
          createdEditWorkItem: true,
          activity: { id: "activity_checks", type: "action_requested" },
          deployPlan: sandboxAgentSourceDeployPlanRecord(),
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test/source/publish?teamId=team_test" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agent: sandboxAgentRecord(),
          projection: { status: "ready" },
          activeManifestSnapshot: {
            id: "snapshot_test",
            source: "project_manifest",
            sourceRef: "master",
            sourceCommitSha: "sha_test",
            manifestHash: "hash_test",
            manifestPath: "openpond.yaml",
            manifestSyncedAt: "2026-05-20T00:00:00.000Z",
            buildStatus: "passed",
            validationStatus: "passed",
            evalStatus: "passed",
            publishedAt: "2026-05-20T00:00:00.000Z",
          },
          publishedAt: "2026-05-20T00:00:00.000Z",
        })
      );
      return;
    }

    if (
      request.url === "/v1/agents/agent_test/edit-work-item?teamId=team_test" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_test",
            projectId: "project_test",
            assignedAgentId: "agent_test",
            status: "needs_review",
          },
          created: true,
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test?teamId=team_test" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_test",
            projectId: "project_test",
            assignedAgentId: "agent_test",
            status: "needs_review",
            latestTaskRunId: "task_run_test",
          },
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/work-items/work_item_large/status?teamId=team_test&limit=2&includeArchived=true" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(largeWorkItemStatusResponse()));
      return;
    }

    const classificationStatusMatch = request.url?.match(
      /^\/v1\/work-items\/(work_item_(?:dependency_install_failure|missing_sdk_binary|unresolved_file_dependency|missing_artifact_directory|missing_source_upload_metadata|stale_source_upload_metadata|invalid_inspect_json|validation_failure|eval_failure|publish_blocked))\/status\?teamId=team_test&limit=2&includeArchived=true$/
    );
    if (classificationStatusMatch && request.method === "GET") {
      const workItemId = classificationStatusMatch[1] ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: workItemId,
            projectId: "project_test",
            assignedAgentId: "agent_test",
            status: "failed",
            latestTaskRunId: `${workItemId}_task`,
            latestRuntimeId: `${workItemId}_runtime`,
            latestSandboxId: `${workItemId}_sandbox`,
          },
          activity: [
            {
              id: `${workItemId}_activity`,
              type: "task_event",
              payload: sourceCheckClassificationPayload(workItemId),
            },
          ],
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/work-items/work_item_test/status?teamId=team_test&limit=2&includeArchived=true" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_test",
            projectId: "project_test",
            assignedAgentId: "agent_test",
            status: "needs_review",
            latestTaskRunId: "task_run_test",
            latestRuntimeId: "runtime_test",
            latestSandboxId: "sandbox_test",
          },
          activity: [
            {
              id: "activity_checks",
              type: "action_requested",
              payload: {
                checkKind: "validate",
                deployPlanStatus: "needs_validation",
                canDeploy: false,
                blockedReasons: ["source_commit_sha_missing"],
              sourceMaterialization: {
                status: "completed",
                sourceCommitSha: "source_sha_test",
                },
                sourceUploadMetadata: sourceUploadMetadataStatusFixture(),
                setup: {
                  status: "completed",
                  passed: true,
                  commands: ["bun install --offline"],
                  expectedBinaryPath: "node_modules/.bin/openpond-agent",
                },
                policyDiscovery: {
                  status: "completed",
                  command: "openpond agent inspect --json",
                  exitCode: 0,
                  durationMs: 12,
                  requiredChecks: [
                    "openpond agent validate",
                    "openpond agent eval",
                  ],
                },
                discoveredRequiredChecks: [
                  "openpond agent validate",
                  "openpond agent eval",
                ],
                checkRuns: [
                  {
                    commandId: "validation-01",
                    command: "openpond agent validate",
                    status: "passed",
                    passed: true,
                    exitCode: 0,
                    durationMs: 10,
                  },
                ],
                validation: { status: "passed", passed: true },
                traceArtifactRef: "artifacts/openpond-trace.jsonl",
                evalResultArtifactRef:
                  "artifacts/openpond-eval-results.json",
                validatorArtifactRefs: ["artifacts/validator-report.json"],
                patchArtifactRef:
                  "openpond://coding-task-runs/task_run_test/patch",
                finalResultState: "completed",
              },
            },
          ],
          sourceCheckStatus: {
            workItemId: "work_item_test",
            workItemStatus: "needs_review",
            latestTaskRunId: "task_run_test",
            latestRuntimeId: "runtime_test",
            latestSandboxId: "sandbox_test",
            sourceMaterialization: {
              status: "completed",
              sourceCommitSha: "source_sha_test",
            },
            sourceUploadMetadata: sourceUploadMetadataStatusFixture(),
            setup: {
              status: "completed",
              passed: true,
              commands: ["bun install --offline"],
              expectedBinaryPath: "node_modules/.bin/openpond-agent",
            },
            policyDiscovery: {
              status: "completed",
              command: "openpond agent inspect --json",
              exitCode: 0,
              durationMs: 12,
              requiredChecks: [
                "openpond agent validate",
                "openpond agent eval",
              ],
            },
            discoveredRequiredChecks: [
              "openpond agent validate",
              "openpond agent eval",
            ],
            checkRuns: [
              {
                commandId: "validation-01",
                command: "openpond agent validate",
                status: "passed",
                passed: true,
                exitCode: 0,
                durationMs: 10,
              },
            ],
            validation: { status: "passed", passed: true },
            requestedCheckKind: "validate",
            deployPlan: {
              status: "needs_validation",
              canDeploy: false,
              blockedReasons: ["source_commit_sha_missing"],
            },
            traceArtifactRefs: ["artifacts/openpond-trace.jsonl"],
            evalResultArtifactRefs: [
              "artifacts/openpond-eval-results.json",
            ],
            validatorArtifactRefs: ["artifacts/validator-report.json"],
            patchArtifactRef:
              "openpond://coding-task-runs/task_run_test/patch",
            finalResultState: "completed",
            publishBlockers: ["source_commit_sha_missing"],
          },
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/work-items/work_item_failed_setup/status?teamId=team_test&limit=2&includeArchived=true" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_failed_setup",
            projectId: "project_test",
            assignedAgentId: "agent_test",
            status: "failed",
            latestTaskRunId: "task_run_failed_setup",
            latestRuntimeId: "runtime_failed_setup",
            latestSandboxId: "sandbox_failed_setup",
          },
          activity: [
            {
              id: "activity_failed_setup",
              type: "task_event",
              payload: {
                setup: {
                  status: "failed",
                  message: "yaml@^2.9.0 failed to resolve",
                  command: "bun install --offline",
                  exitCode: 1,
                  commands: ["bun install --offline"],
                  expectedBinaryPath: "node_modules/.bin/openpond-agent",
                  dependencyPackages: [
                    {
                      packageName: "yaml",
                      source: "npm",
                      versionSpec: "^2.9.0",
                      path: ".openpond/vendor/npm/yaml.tgz",
                      sha256: "sha_yaml",
                      sizeBytes: 112086,
                    },
                  ],
                },
              },
            },
          ],
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test/chat" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          userMessage: { id: "message_user", role: "user" },
          assistantMessage: { id: "message_assistant", role: "assistant" },
          activity: { id: "activity_chat", type: "message_created" },
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/work-items/work_item_test/activity?teamId=team_test&limit=2" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          activity: [
            {
              id: "activity_checks",
              type: "action_requested",
              payload: {
                checkKind: "validate",
                deployPlanStatus: "needs_validation",
                canDeploy: false,
                blockedReasons: ["source_commit_sha_missing"],
                traceArtifactRef: "artifacts/openpond-trace.jsonl",
                evalResultArtifactRef:
                  "artifacts/openpond-eval-results.json",
              },
            },
          ],
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/work-items/work_item_large/activity?teamId=team_test&limit=2" &&
      request.method === "GET"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          activity: [
            {
              id: "activity_large",
              type: "task_event",
              payload: largeSourceCheckPayload(),
              rawSandboxProcessOutput: largeRawPayload(),
            },
          ],
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test/handle-background" &&
      request.method === "POST"
    ) {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: { id: "work_item_test", status: "running" },
          taskRun: { id: "task_run_test" },
          link: { id: "link_test" },
          activity: { id: "activity_background", type: "task_started" },
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_large/handle-background" &&
      request.method === "POST"
    ) {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          workItem: {
            id: "work_item_large",
            status: "running",
            metadata: { rawTaskPayload: largeRawPayload() },
          },
          taskRun: {
            id: "task_run_large",
            rawLog: largeRawPayload(),
          },
          link: { id: "link_large", rawRequest: largeRawPayload() },
          activity: {
            id: "activity_large_background",
            type: "task_started",
            payload: largeSourceCheckPayload(),
            rawEvents: largeRawPayload(),
          },
          rawTaskPayload: largeRawPayload(),
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test/result/checkpoint" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: {
            id: "artifact_checkpoint",
            kind: "checkpoint",
            ref: body.ref,
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_large/result/checkpoint" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: largeArtifactRecord("artifact_large_checkpoint", "checkpoint", body.ref),
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test/result/commit" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: {
            id: "artifact_commit",
            kind: "commit",
            ref: body.ref,
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_large/result/commit" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: largeArtifactRecord("artifact_large_commit", "commit", body.ref),
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_test/result/pr" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: {
            id: "artifact_pr",
            kind: "pr",
            ref: body.ref,
          },
        })
      );
      return;
    }

    if (
      request.url === "/v1/work-items/work_item_large/result/pr" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          artifact: largeArtifactRecord("artifact_large_pr", "pr", body.ref),
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

    if (
      request.url ===
        "/v1/runtimes/workspace_test/preserve-source?teamId=team_test" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          runtime: {
            ...sandboxRuntimeRecord(),
            currentSha: "feed123",
          },
          preservedSha: "feed123",
          preserved: true,
          patch: sandboxGitPatchExportRecord(body),
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
      request.url === "/v1/sandboxes/sandbox_test/git/export-patch" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord({ runtimeId: "workspace_test" }),
          patch: sandboxGitPatchExportRecord(body),
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/sandboxes/sandbox_test/stop?failOnUnpreservedChanges=true" &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: sandboxRecord({ runtimeId: "workspace_test" }),
          receipt: {
            ref: "sandbox_stop_receipt_test",
            status: "accepted",
          },
        })
      );
      return;
    }

    if (
      request.url ===
        "/v1/sandboxes/sandbox_test?failOnUnpreservedChanges=true" &&
      request.method === "DELETE"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sandbox: {
            ...sandboxRecord({ runtimeId: "workspace_test" }),
            state: "deleted",
            deletedAt: "2026-05-20T00:01:00.000Z",
          },
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

function runTestCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { env?: Record<string, string | undefined> } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env:
        options.env === undefined
          ? process.env
          : {
              ...process.env,
              ...options.env,
            },
      stdio: ["ignore", "pipe", "pipe"],
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
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed: ${[
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join("\n")}`
        )
      );
    });
  });
}

function runTestCommandWithOutput(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

async function writeSourceUploadEntriesToDirectory(
  entries: Array<{ path: string; contentsBase64?: string }>,
  targetDir: string
): Promise<void> {
  const targetRoot = path.resolve(targetDir);
  for (const entry of entries) {
    const outputPath = path.resolve(targetRoot, entry.path);
    if (!outputPath.startsWith(`${targetRoot}${path.sep}`)) {
      throw new Error(`refusing unsafe upload entry path ${entry.path}`);
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      Buffer.from(entry.contentsBase64 ?? "", "base64")
    );
  }
}

async function runDependencySetupFromUploadMetadata(
  materializedDir: string
): Promise<void> {
  const metadataPath = path.join(
    materializedDir,
    ".openpond",
    "source-upload-metadata.json"
  );
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    dependencySetup?: { commands?: string[]; installCommand?: string };
  };
  const command =
    metadata.dependencySetup?.commands?.find((entry) => entry.trim()) ??
    metadata.dependencySetup?.installCommand;
  if (!command) {
    throw new Error("source-upload metadata did not declare dependency setup");
  }
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const [commandName, ...args] = parts;
  if (!commandName) {
    throw new Error("source-upload metadata dependency setup is empty");
  }
  const setupArgs = [...args];
  let setupEnv: Record<string, string | undefined> | undefined;
  const bunCacheDir = await mkdtemp(
    path.join(os.tmpdir(), "openpond-agent-sdk-empty-bun-cache-")
  );
  try {
    if (commandName === "bun" && setupArgs[0] === "install") {
      setupArgs.push(
        "--cache-dir",
        bunCacheDir,
        "--no-cache",
        "--registry",
        "http://127.0.0.1:9"
      );
      setupEnv = { HOME: bunCacheDir };
    }
    await runTestCommand(commandName, setupArgs, materializedDir, {
      env: setupEnv,
    });
  } finally {
    await rm(bunCacheDir, { recursive: true, force: true });
  }
}

function resolveTestAgentSdkRoot(): string {
  const packageJsonPath = path.join(TEST_AGENT_SDK_ROOT, "package.json");
  const packageJson = JSON.parse(readFileSyncForTest(packageJsonPath)) as {
    name?: string;
  };
  expect(packageJson.name).toBe("openpond-agent-sdk");
  return TEST_AGENT_SDK_ROOT;
}

async function rewriteAgentSdkDependencyForTest(
  projectDir: string,
  dependency: string
): Promise<void> {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    "openpond-agent-sdk": dependency,
  };
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8"
  );
}

function readFileSyncForTest(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

async function writeAgentSdkUploadFixture(projectDir: string): Promise<void> {
  await mkdir(path.join(projectDir, "agent"), { recursive: true });
  await mkdir(path.join(projectDir, ".openpond", "local-sdk-source", "dist"), {
    recursive: true,
  });
  await mkdir(path.join(projectDir, ".openpond", "fixture-runtime-dep"), {
    recursive: true,
  });
  await mkdir(path.join(projectDir, "node_modules", ".bin"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          "openpond-agent-sdk": "file:.openpond/local-sdk-source",
        },
        scripts: {
          "agent:inspect": "openpond-agent inspect --json",
          "agent:build": "openpond-agent build",
          "agent:validate": "openpond-agent validate",
          "agent:eval": "openpond-agent eval",
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(projectDir, ".openpond", "local-sdk-source", "package.json"),
    JSON.stringify(
      {
        name: "openpond-agent-sdk",
        version: "0.0.0-test",
        type: "commonjs",
        files: ["dist"],
        dependencies: {
          "fixture-runtime-dep": "file:../fixture-runtime-dep",
        },
        bin: {
          "openpond-agent": "./dist/cli.js",
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(projectDir, ".openpond", "fixture-runtime-dep", "package.json"),
    JSON.stringify(
      {
        name: "fixture-runtime-dep",
        version: "0.0.0-test",
        type: "module",
        main: "./index.js",
        files: ["index.js"],
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(projectDir, ".openpond", "fixture-runtime-dep", "index.js"),
    "export const fixtureRuntimeDep = true;\n",
    "utf8"
  );
  await writeFile(
    path.join(projectDir, ".openpond", "local-sdk-source", "dist", "cli.js"),
    agentSdkUploadFixtureBin(),
    "utf8"
  );
  await writeFile(
    path.join(projectDir, "agent", "agent.ts"),
    "export default { name: 'upload-fixture' };\n",
    "utf8"
  );
  const binPath = path.join(projectDir, "node_modules", ".bin", "openpond-agent");
  await writeFile(binPath, agentSdkUploadFixtureBin(), "utf8");
  await chmod(binPath, 0o755);
}

function agentSdkUploadFixtureBin(): string {
  return [
    "#!/usr/bin/env node",
    "const { mkdirSync, writeFileSync } = require('node:fs');",
    "const path = require('node:path');",
    "const [command, ...args] = process.argv.slice(2);",
    "const cwdIndex = args.indexOf('--cwd');",
    "const cwd = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();",
    "const artifactDir = path.join(cwd, '.openpond');",
    "mkdirSync(artifactDir, { recursive: true });",
    "if (command === 'inspect') {",
    "  const inspect = { name: 'sdk-upload-fixture', editable: { enabled: true, requiredChecks: [{ name: 'validate', command: 'bun run agent:validate' }] } };",
    "  writeFileSync(path.join(artifactDir, 'agent-inspect.json'), JSON.stringify(inspect, null, 2));",
    "  console.log(JSON.stringify(inspect));",
    "  process.exit(0);",
    "}",
    "if (command === 'build') {",
    "  const manifest = ['schemaVersion: 1', 'schema: openpond.runtime.manifest.v1', 'name: sdk-upload-fixture', 'version: 0.1.0', 'useCase: sdk-upload-fixture', 'description: SDK upload fixture.', 'runtime:', '  base: node-bun-workspace', 'setup:', '  commands: []', 'validation:', '  commands:', '    - \"true\"', 'start:', '  command: openpond-agent run chat', '  ports: []', 'actions:', '  - name: chat', '    command: openpond-agent run chat', '    ports: []', 'services: []', 'schedules: []', 'volumes: []', 'integrations:', '  requiredLeases: []', 'permissions: {}', 'inputs:', '  schema:', '    type: object', '  env: []', 'artifacts:', '  paths: []', 'network:', '  egress: restricted', ''].join('\\n');",
    "  writeFileSync(path.join(artifactDir, 'openpond-manifest.preview.yaml'), manifest);",
    "  writeFileSync(path.join(artifactDir, 'agent-inspect.json'), JSON.stringify({ editable: { enabled: true } }, null, 2));",
    "  writeFileSync(path.join(artifactDir, 'agent-manifest.json'), JSON.stringify({ schemaVersion: 1 }, null, 2));",
    "  writeFileSync(path.join(artifactDir, 'action-registry.json'), JSON.stringify({ actions: [{ name: 'chat' }] }, null, 2));",
    "  writeFileSync(path.join(artifactDir, 'runtime-bridge.mjs'), 'export const actionRegistry = {};\\n');",
    "  writeFileSync(path.join(artifactDir, 'validator-report.md'), '# ok\\n');",
    "  process.exit(0);",
    "}",
    "if (command === 'validate') process.exit(0);",
    "if (command === 'eval') {",
    "  writeFileSync(path.join(artifactDir, 'eval-results.json'), JSON.stringify({ ok: true }, null, 2));",
    "  process.exit(0);",
    "}",
    "console.error(`unexpected command ${command}`);",
    "process.exit(1);",
    "",
  ].join("\n");
}

function largeRawPayload(): string {
  return `${LARGE_RAW_MARKER}:`.repeat(10_000);
}

function largeArtifactRecord(
  id: string,
  kind: string,
  ref: unknown
): Record<string, unknown> {
  return {
    id,
    kind,
    ref,
    createdAt: "2026-05-20T00:00:00.000Z",
    metadata: {
      rawPatch: largeRawPayload(),
    },
    rawDiff: largeRawPayload(),
  };
}

function largeSourceCheckPayload(): Record<string, unknown> {
  return {
    checkKind: "all",
    deployPlanStatus: "needs_validation",
    canDeploy: false,
    blockedReasons: ["source_commit_sha_missing"],
    sourceMaterialization: {
      status: "completed",
      sourceCommitSha: "source_sha_large",
      rawCheckoutLog: largeRawPayload(),
    },
    sourceUploadMetadata: {
      ...sourceUploadMetadataStatusFixture(),
      rawSetupOutput: largeRawPayload(),
    },
    setup: {
      status: "completed",
      passed: true,
      commands: ["bun install --offline"],
      expectedBinaryPath: "node_modules/.bin/openpond-agent",
      rawInstallLog: largeRawPayload(),
    },
    policyDiscovery: {
      status: "completed",
      command: "openpond agent inspect --json",
      exitCode: 0,
      durationMs: 12,
      requiredChecks: ["openpond agent validate", "openpond agent eval"],
      rawStdout: largeRawPayload(),
    },
    discoveredRequiredChecks: [
      "openpond agent validate",
      "openpond agent eval",
    ],
    checkRuns: [
      {
        commandId: "validation-large",
        command: "openpond agent validate",
        status: "passed",
        passed: true,
        exitCode: 0,
        rawStderr: largeRawPayload(),
      },
    ],
    validation: {
      status: "passed",
      passed: true,
      rawValidatorOutput: largeRawPayload(),
    },
    eval: {
      status: "passed",
      passed: true,
      rawEvalResultsJson: largeRawPayload(),
    },
    traceArtifactRef: "artifacts/trace-large.jsonl",
    traceArtifactRefs: ["artifacts/trace-large.jsonl"],
    evalResultArtifactRef: "artifacts/eval-large.json",
    evalResultArtifactRefs: ["artifacts/eval-large.json"],
    validatorArtifactRefs: ["artifacts/validator-large.json"],
    patchArtifactRef: "openpond://coding-task-runs/task_run_large/patch",
    draftSourceRef: "draft/source-large",
    finalResultState: "completed",
    publishBlockers: ["source_commit_sha_missing"],
    rawSandboxProcessOutput: largeRawPayload(),
  };
}

function largeWorkItemStatusResponse(): Record<string, unknown> {
  return {
    workItem: {
      id: "work_item_large",
      projectId: "project_test",
      assignedAgentId: "agent_test",
      status: "needs_review",
      latestTaskRunId: "task_run_large",
      latestRuntimeId: "runtime_large",
      latestSandboxId: "sandbox_large",
      metadata: {
        rawTaskPayload: largeRawPayload(),
      },
    },
    activity: [
      {
        id: "activity_large",
        type: "task_event",
        payload: largeSourceCheckPayload(),
        rawEvents: largeRawPayload(),
      },
    ],
    sourceCheckStatus: {
      workItemId: "work_item_large",
      workItemStatus: "needs_review",
      latestTaskRunId: "task_run_large",
      latestRuntimeId: "runtime_large",
      latestSandboxId: "sandbox_large",
      ...largeSourceCheckPayload(),
      requestedCheckKind: "all",
      deployPlan: {
        status: "needs_validation",
        canDeploy: false,
        blockedReasons: ["source_commit_sha_missing"],
        rawPlan: largeRawPayload(),
      },
      rawStatusPayload: largeRawPayload(),
    },
    rawResponsePayload: largeRawPayload(),
  };
}

function sourceUploadMetadataStatusFixture(): Record<string, unknown> {
  return {
    schema: "openpond.agent.source_upload.v1",
    sourceTreeMode: "typescript_agent_sdk",
    packageManager: "bun",
    commands: {
      inspect: "bun run agent:inspect",
      build: "bun run agent:build",
      validate: "bun run agent:validate",
      eval: "bun run agent:eval",
    },
    generatedManifestPath: ".openpond/openpond-manifest.preview.yaml",
    synthesizedOpenPondYaml: true,
    openPondYamlMode: "synthesized",
    uploadMetadataPath: ".openpond/source-upload-metadata.json",
    uploadMetadataHash: {
      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sizeBytes: 2816,
    },
    artifactHashes: {
      ".openpond/openpond-manifest.preview.yaml": {
        sha256:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sizeBytes: 567,
      },
      ".openpond/agent-manifest.json": {
        sha256:
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        sizeBytes: 1024,
      },
      "openpond.yaml": {
        sha256:
          "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        sizeBytes: 530,
      },
    },
    dependencySetup: {
      required: true,
      installCommand: "bun install --offline",
      commands: ["bun install --offline"],
      packageJsonPath: "package.json",
      expectedBinaryPath: "node_modules/.bin/openpond-agent",
      generatedArtifactDirectory: ".openpond",
      sdkPackage: {
        packageName: "openpond-agent-sdk",
        source: "uploaded_tarball",
        path: ".openpond/vendor/openpond-agent-sdk.tgz",
        sha256:
          "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        sizeBytes: 52319,
      },
      dependencyPackages: [
        {
          packageName: "yaml",
          source: "npm_dependency_tarball",
          versionSpec: "^2.9.0",
          path: ".openpond/vendor/npm/yaml.tgz",
          sha256:
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          sizeBytes: 112086,
        },
        {
          packageName: "zod",
          source: "npm_dependency_tarball",
          versionSpec: "^4.1.11",
          path: ".openpond/vendor/npm/zod.tgz",
          sha256:
            "1111111111111111111111111111111111111111111111111111111111111111",
          sizeBytes: 759588,
        },
      ],
    },
    redactedSetupOutputRefs: [
      "openpond://coding-task-runs/task_run_test/setup-output",
    ],
  };
}

function sourceCheckClassificationPayload(
  workItemId: string
): Record<string, unknown> {
  if (workItemId === "work_item_dependency_install_failure") {
    return {
      sourceUploadMetadata: sourceUploadMetadataStatusFixture(),
      setup: {
        status: "failed",
        message: "dependency install failed",
        command: "bun install --offline",
        exitCode: 1,
        commands: ["bun install --offline"],
        expectedBinaryPath: "node_modules/.bin/openpond-agent",
        dependencyPackages: [
          {
            packageName: "yaml",
            source: "npm_dependency_tarball",
            versionSpec: "^2.9.0",
            path: ".openpond/vendor/npm/yaml.tgz",
            sha256: "sha_yaml",
            sizeBytes: 112086,
          },
        ],
      },
    };
  }
  if (workItemId === "work_item_missing_sdk_binary") {
    return {
      policyDiscovery: {
        status: "failed",
        message: "missing node_modules/.bin/openpond-agent",
        command: "bun run agent:inspect",
        exitCode: 127,
      },
    };
  }
  if (workItemId === "work_item_unresolved_file_dependency") {
    return {
      setup: {
        status: "failed",
        message: "unresolved local file dependency",
        command: "bun install --offline",
        exitCode: 1,
        commands: ["bun install --offline"],
        expectedBinaryPath: "node_modules/.bin/openpond-agent",
        dependencyPackages: [
          {
            packageName: "openpond-agent-sdk",
            source: "uploaded_tarball",
            versionSpec: "file:.openpond/local-sdk-source",
            path: ".openpond/vendor/openpond-agent-sdk.tgz",
            sha256: "sha_sdk",
            sizeBytes: 12000,
          },
        ],
      },
    };
  }
  if (workItemId === "work_item_missing_artifact_directory") {
    return {
      policyDiscovery: {
        status: "failed",
        message: "missing generated artifact directory .openpond",
        command: "bun run agent:inspect",
        exitCode: 1,
      },
    };
  }
  if (workItemId === "work_item_missing_source_upload_metadata") {
    return {
      sourceMaterialization: {
        status: "blocked",
        message: "missing .openpond/source-upload-metadata.json",
        blockedReason: "source_upload_metadata_missing",
      },
      policyDiscovery: {
        status: "blocked",
        message: "source-upload metadata missing",
      },
      publishBlockers: ["source_upload_metadata_missing"],
    };
  }
  if (workItemId === "work_item_stale_source_upload_metadata") {
    return {
      sourceUploadMetadata: {
        ...sourceUploadMetadataStatusFixture(),
        status: "stale",
        staleReasons: ["artifact_hash_mismatch"],
      },
      policyDiscovery: {
        status: "blocked",
        message: "source-upload metadata is stale",
      },
      publishBlockers: ["source_upload_metadata_stale"],
    };
  }
  if (workItemId === "work_item_invalid_inspect_json") {
    return {
      policyDiscovery: {
        status: "failed",
        message: "invalid inspect JSON",
        command: "bun run agent:inspect",
        exitCode: 1,
      },
    };
  }
  if (workItemId === "work_item_validation_failure") {
    return {
      checkRuns: [
        {
          command: "bun run agent:validate",
          status: "failed",
          passed: false,
          exitCode: 1,
          artifactRefs: ["artifacts/validator-report.json"],
        },
      ],
      validation: {
        status: "failed",
        passed: false,
        artifactRef: "artifacts/validator-report.json",
      },
      validatorArtifactRefs: ["artifacts/validator-report.json"],
    };
  }
  if (workItemId === "work_item_eval_failure") {
    return {
      checkRuns: [
        {
          command: "bun run agent:eval",
          status: "failed",
          passed: false,
          exitCode: 1,
          artifactRefs: ["artifacts/openpond-eval-results.json"],
        },
      ],
      eval: {
        status: "failed",
        passed: false,
        artifactRef: "artifacts/openpond-eval-results.json",
      },
      evalResultArtifactRefs: ["artifacts/openpond-eval-results.json"],
    };
  }
  if (workItemId === "work_item_publish_blocked") {
    return {
      deployPlan: {
        status: "blocked",
        canDeploy: false,
        blockedReasons: ["source_commit_sha_missing", "failed_checks"],
      },
      publishBlockers: ["source_commit_sha_missing", "failed_checks"],
    };
  }
  return {};
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
    runtimeProfileId: "openpond-coding-core-v1",
    workspaceRoot: "/workspace/project",
    runtimeProfile: {
      id: "openpond-coding-core-v1",
      label: "OpenPond Coding Core",
      version: 1,
      workspaceRoot: "/workspace/project",
      defaultExecutionProfileId: "firecracker-direct-k8s",
      requiredTools: ["git", "sh", "rg", "curl", "tar", "unzip"],
      excludedToolchains: ["node", "bun", "python", "browser"],
      capabilities: [
        "files",
        "exec",
        "processes",
        "pty",
        "ports",
        "preview",
        "git",
      ],
    },
    executionProfileId: "firecracker-direct-k8s",
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

function sandboxGitPatchExportRecord(
  input: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    isRepo: true,
    baseRef:
      typeof input.baseRef === "string" && input.baseRef.trim()
        ? input.baseRef.trim()
        : "openpond/base",
    patch: "diff --git a/README.md b/README.md\n",
    filename: "sandbox_test-abc123.patch",
    sha256: "a".repeat(64),
    bytes: 35,
    lineCount: 2,
    empty: false,
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
    workflowMode: "attempt",
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
    runtimeProfileId: "openpond-coding-core-v1",
    workspaceRoot: "/workspace/project",
    runtimeProfile: {
      id: "openpond-coding-core-v1",
      label: "OpenPond Coding Core",
      version: 1,
      workspaceRoot: "/workspace/project",
      defaultExecutionProfileId: "firecracker-direct-k8s",
      requiredTools: ["git", "sh", "rg", "curl", "tar", "unzip"],
      excludedToolchains: ["node", "bun", "python", "browser"],
      capabilities: [
        "files",
        "exec",
        "processes",
        "pty",
        "ports",
        "preview",
        "git",
      ],
    },
    executionProfileId: "firecracker-direct-k8s",
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
    defaultWorkflowMode: "attempt",
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

function sandboxAgentSourceDeployPlanRecord(): Record<string, unknown> {
  return {
    projectId: "project_test",
    agentId: "agent_test",
    status: "ready",
    canRun: true,
    canDeploy: true,
    blockedReasons: [],
    staleReasons: [],
    source: {
      sourceRef: "master",
      sourceCommitSha: "sha_test",
      manifestHash: "hash_test",
      manifestPath: "openpond.yaml",
      manifestSyncedAt: "2026-05-20T00:00:00.000Z",
      activeSnapshotId: null,
      activeSnapshotSourceSha: null,
    },
    defaultEntrypoint: { scope: "action", name: "chat" },
    checks: {
      setupCommands: [],
      validationCommands: ["openpond-agent validate"],
      requiredChecks: ["openpond-agent validate"],
      evalNames: ["basic"],
    },
    actions: [],
    channels: [],
    requiredIntegrations: [],
    optionalIntegrations: [],
    envRefs: [],
    requiredVolumes: [],
    optionalVolumes: [],
    schedules: [],
    artifactPaths: ["artifacts/openpond-trace.jsonl"],
    editable: {
      enabled: true,
      requiredChecks: ["openpond-agent validate"],
      defaultResultMode: "patch_only",
      supportedResultModes: ["patch_only"],
    },
  };
}

function sandboxAgentManifestSnapshotRecord(): Record<string, unknown> {
  return {
    id: "snapshot_test",
    teamId: "team_test",
    projectId: "project_test",
    agentId: "agent_test",
    sourceRef: "master",
    sourceCommitSha: "sha_test",
    manifestHash: "hash_test",
    manifestPath: "openpond.yaml",
    manifestSyncedAt: "2026-05-20T00:00:00.000Z",
    manifestJson: {},
    actionRegistryJson: {},
    inspectJson: {},
    buildStatus: "passed",
    validationStatus: "passed",
    evalStatus: "passed",
    workItemId: "work_item_test",
    taskRunId: "task_run_test",
    traceArtifactRef: "artifacts/openpond-trace.jsonl",
    evalResultArtifactRef: "artifacts/openpond-eval-results.json",
    publishedAt: "2026-05-20T00:00:00.000Z",
    metadata: {},
    createdAt: "2026-05-20T00:00:00.000Z",
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
