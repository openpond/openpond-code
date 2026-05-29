import {
  OPENPOND_MANIFEST_FILE_NAME,
  SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME,
} from "../sandbox-template/manifest";

export function printHelp(): void {
  console.log("OpenPond CLI (API key only)");
  console.log("");
  console.log("Usage:");
  console.log("  openpond --version");
  console.log("  openpond --check-update");
  console.log("  openpond login [--api-key <key>]");
  console.log("  openpond profiles list");
  console.log("  openpond profiles use <name>");
  console.log(
    "  openpond profiles save <name> --api-key <key> [--base-url <url>] [--api-base-url <url>] [--chat-api-base-url <url>]"
  );
  console.log("  openpond account");
  console.log("  openpond health");
  console.log("  openpond tool list <handle>/<repo>");
  console.log(
    "  openpond tool run <handle>/<repo> <tool> [--body <json>] [--method <METHOD>]"
  );
  console.log(
    "  openpond backtest run <handle>/<repo> <tool> [--body <json>] [--branch <branch>] [--deployment-id <id>]"
  );
  console.log(
    "  openpond backtest events <handle>/<repo> [--run-id <id>] [--source <source>] [--status <csv>] [--symbol <symbol>] [--wallet-address <0x...>] [--since <ms|iso>] [--until <ms|iso>] [--limit <n>] [--cursor <cursor>] [--params <json>]"
  );
  console.log("  openpond backtest get <handle>/<repo> --run-id <id>");
  console.log("  openpond deploy watch <handle>/<repo> [--branch <branch>]");
  console.log("  openpond template status <handle>/<repo>");
  console.log("  openpond template branches <handle>/<repo>");
  console.log(
    "  openpond template update <handle>/<repo> [--env preview|production]"
  );
  console.log(
    `  openpond sandbox-template validate [--file ${OPENPOND_MANIFEST_FILE_NAME}]`
  );
  console.log("  openpond sandbox-template print-schema");
  console.log(
    "  openpond sandbox-template scaffold [--path <dir>] [--name <name>]"
  );
  console.log(
    `  openpond sandbox-template build [--file ${OPENPOND_MANIFEST_FILE_NAME}] [--output dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}]`
  );
  console.log(
    `  openpond sandbox-template run [--file ${OPENPOND_MANIFEST_FILE_NAME}|--build dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}] [--target <name>|--action <name>|--service <name>]`
  );
  console.log(
    `  openpond sandbox-template dev [--file ${OPENPOND_MANIFEST_FILE_NAME}|--build dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}] [--service <name>]`
  );
  console.log(
    `  openpond sandbox-template start [--file ${OPENPOND_MANIFEST_FILE_NAME}] [--env-ref NAME=openpond://secret/...] [--input-file name=path] [--input-files name=glob] [--target <name>|--action <name>|--service <name>] [--project-id <projectId>] [--agent-id <agentId>] [--runtime-mode <mode> --runtime-project-id <projectId>] [--enable-schedules [all|name,...]|--disable-schedules [all|name,...]] [--schedule-overrides <json>] [--commit] [--no-push]`
  );
  console.log(
    `  openpond sandbox-template action <sandboxId> <actionName> [--file ${OPENPOND_MANIFEST_FILE_NAME}]`
  );
  console.log(
    "  openpond repo create --name <name> [--team-id <id>] [--path <dir>] [--template <owner/repo|url>] [--template-branch <branch>] [--env <json>] [--empty|--opentool] [--sandbox] [--token] [--auto-schedule-migration <true|false>]"
  );
  console.log("  openpond repo push [--path <dir>] [--branch <branch>]");
  console.log("  openpond organizations list");
  console.log(
    "  openpond organizations create --name <name> [--slug <slug>] [--primary-contact-email <email>]"
  );
  console.log(
    "  openpond organizations update <slug> [--name <name>] [--status active|disabled|archived]"
  );
  console.log("  openpond organizations members <slug>");
  console.log(
    "  openpond organizations member-upsert <slug> --email <email> --role owner|admin|member"
  );
  console.log("  openpond organizations mcp-get <slug>");
  console.log(
    "  openpond organizations mcp-generate <slug> [--origin <url>] [--toolset <csv>]"
  );
  console.log("  openpond organizations mcp-rotate <slug>");
  console.log("  openpond organizations mcp-disable <slug>");
  console.log("  openpond organizations mcp-enable <slug>");
  console.log(
    "  openpond organizations mcp-probe <slug> [--origin <url>] [--tool <name>] [--arguments <json>] [--access-token <token>]"
  );
  console.log(
    "  openpond organizations mcp-authorize <slug> [--origin <url>] [--scope <csv|space>] [--tool <name>] [--arguments <json>] [--open]"
  );
  console.log("  openpond project list --team-id <id>");
  console.log(
    "  openpond project create --team-id <id> --name <name> [--source-type manual|github_repo|internal_repo|template] [--repo <url>] [--git-owner <owner> --git-repo <repo>] [--internal-repo-path <path>] [--template-repo-url <url>]"
  );
  console.log("  openpond project get <projectId> --team-id <id>");
  console.log(
    "  openpond project update <projectId> --team-id <id> [--name <name>] [--description <text>] [--default-branch <branch>]"
  );
  console.log("  openpond project sync <projectId> --team-id <id>");
  console.log("  openpond project archive <projectId> --team-id <id>");
  console.log("  openpond agent list --team-id <id>");
  console.log(
    "  openpond agent create --team-id <id> --project-id <id> --name <name> [--entrypoint-scope entire_manifest|action|service|schedule] [--entrypoint-name <name>] [--trigger-type manual|schedule|endpoint|background] [--runtime-mode <mode>]"
  );
  console.log(
    "  openpond agent update <agentId> --team-id <id> [--name <name>] [--trigger-type manual|schedule|endpoint|background] [--runtime-mode <mode>]"
  );
  console.log(
    "  openpond agent run <agentId> --team-id <id> [--idempotency-key <key>] [--input <json>]"
  );
  console.log("  openpond agent archive <agentId> --team-id <id>");
  console.log(
    "  openpond sandbox list [--env staging] [--team-id <id>] [--project-id <id>] [--agent-id <id>] [--sandbox-api-url <url>]"
  );
  console.log(
    "  openpond sandbox mcp-config [--env staging] [--sandbox-api-url <url>]"
  );
  console.log("  openpond sandbox secrets [--team-id <id>] [--json]");
  console.log(
    "  openpond sandbox secret-create --name <ENV_NAME> [--team-id <id>] [--stdin]"
  );
  console.log(
    "  openpond sandbox secret-rotate <secretId> [--team-id <id>] [--stdin]"
  );
  console.log("  openpond sandbox secret-revoke <secretId> [--team-id <id>]");
  console.log("  openpond sandbox secret-delete <secretId> [--team-id <id>]");
  console.log(
    "  openpond sandbox secret-attach <secretId> --env-name <ENV_NAME> --target-type sandbox|project|agent|template|replay --target-id <id>"
  );
  console.log(
    "  openpond sandbox snapshots [--team-id <id>] [--project-id <id>] [--agent-id <id>]"
  );
  console.log(
    "  openpond sandbox templates [--team-id <id>] [--project-id <id>] [--query <text>] [--name <name>] [--use-case <id>]"
  );
  console.log("  openpond sandbox template-builds --team-id <id>");
  console.log(
    "  openpond sandbox template-build-create --team-id <id> [--source-repo-url <url>|--source-project-id <id>] [--branch <branch>] [--publish]"
  );
  console.log("  openpond sandbox template-build-get <buildId>");
  console.log("  openpond sandbox template-build-logs <buildId>");
  console.log("  openpond sandbox template-build-cancel <buildId>");
  console.log(
    "  openpond sandbox template-build-watch <buildId> [--interval-ms 5000] [--timeout-ms 900000]"
  );
  console.log(
    "  openpond sandbox replay-start --team-id <id> --snapshot-id <id> [--entrypoint <name>] [--params <json>] [--artifact-paths <csv>]"
  );
  console.log("  openpond sandbox replay-get <replayId> [--team-id <id>]");
  console.log("  openpond sandbox replay-logs <replayId> [--team-id <id>]");
  console.log("  openpond sandbox replay-cancel <replayId> [--team-id <id>]");
  console.log(
    "  openpond sandbox replay-watch <replayId> [--team-id <id>] [--interval-ms 5000] [--timeout-ms 900000]"
  );
  console.log(
    "  openpond sandbox replay-artifacts <replayId> [--team-id <id>]"
  );
  console.log(
    "  openpond sandbox runtime-list [--team-id <id>] [--project-id <id>] [--agent-id <id>]"
  );
  console.log("  openpond sandbox runtime-get <runtimeId>");
  console.log("  openpond sandbox runtime-events <runtimeId>");
  console.log(
    "  openpond sandbox runtime-status <runtimeId> --status <status> --expected-version <n>"
  );
  console.log(
    "  openpond sandbox runtime-event <runtimeId> --type <eventType> [--summary <text>] [--payload <json>] [--lifecycle-hint <json>]"
  );
  console.log("  openpond sandbox pricing");
  console.log(
    "  openpond sandbox costs [--team-id <id>] [--project-id <id>] [--agent-id <id>] [--summary]"
  );
  console.log(
    "  openpond sandbox template-launch [--snapshot-id <id>|--template-name <name>|--use-case <id>] [--version <v>] [--team-id <id>] [--budget-usd 0.05]"
  );
  console.log(
    "  openpond sandbox snapshot-fork <snapshotId> [--team-id <id>] [--project-id <id>] [--budget-usd 0.05]"
  );
  console.log(
    "  openpond sandbox snapshot-create <sandboxId> --name <name> [--template-name <name>] [--template-version <v>] [--template-visibility private|team] [--validation-command <cmd>]"
  );
  console.log(
    "  openpond sandbox snapshot-validate <sandboxId> <snapshotId> [--cleanup delete|stop|archive]"
  );
  console.log("  openpond sandbox snapshot-publish <sandboxId> <snapshotId>");
  console.log(
    "  openpond sandbox create [--repo <url>] [--budget-usd 0.05] [--env-ref NAME=openpond://secret/...] [--env-literal NAME=value] [--project-id <id>] [--agent-id <id>] [--runtime-mode feature --runtime-project-id <projectId> --runtime-base-branch master]"
  );
  console.log(
    "    example: openpond sandbox create --runtime-mode feature --runtime-project-id project_123 --runtime-base-branch master"
  );
  console.log('  openpond sandbox exec <sandboxId> --command "bun test"');
  console.log(
    "  openpond sandbox port <sandboxId> --port 4173 [--access private|public] [--auto-start] [--domain app.example.com] [--auth-token <token>|--auth-header <name> --auth-header-value <value>]"
  );
  console.log("  openpond sandbox stop <sandboxId>");
  console.log("  openpond sandbox delete <sandboxId>");
  console.log("  openpond sandbox receipts <sandboxId>");
  console.log("  openpond sandbox logs <sandboxId>");
  console.log("  openpond sandbox billing <sandboxId>");
  console.log(
    "  openpond sandbox integration-connections [--team-id <id>] [--project-id <id>] [--agent-id <id>] [--status active|all]"
  );
  console.log("  openpond sandbox integration-leases <sandboxId>");
  console.log(
    "  openpond sandbox integration-attach <sandboxId> --integration-connection <id> --integration-capabilities <csv>"
  );
  console.log(
    "  openpond sandbox integration-remove <sandboxId> --lease-id <id>"
  );
  console.log(
    '  openpond sandbox process-start <sandboxId> --command "bun dev"'
  );
  console.log("  openpond sandbox process-list <sandboxId>");
  console.log(
    "  openpond sandbox process-get <sandboxId> <processId> [--since <cursor>]"
  );
  console.log("  openpond sandbox process-stop <sandboxId> <processId>");
  console.log(
    "  openpond sandbox process-stream <sandboxId> <processId> [--since <cursor>]"
  );
  console.log('  openpond sandbox pty-start <sandboxId> [--command "/bin/sh"]');
  console.log("  openpond sandbox pty-list <sandboxId>");
  console.log(
    "  openpond sandbox pty-get <sandboxId> <ptyId> [--since <cursor>]"
  );
  console.log('  openpond sandbox pty-write <sandboxId> <ptyId> --input "ls"');
  console.log("  openpond sandbox pty-stop <sandboxId> <ptyId>");
  console.log(
    "  openpond sandbox pty-stream <sandboxId> <ptyId> [--since <cursor>]"
  );
  console.log(
    '  openpond sandbox upload-file <sandboxId> --path <path> --contents "text"'
  );
  console.log("  openpond sandbox download-file <sandboxId> --path <path>");
  console.log("  openpond sandbox list-files <sandboxId> [--path <path>]");
  console.log(
    "  openpond sandbox search-files <sandboxId> --query <text> [--path <path>]"
  );
  console.log(
    "  openpond sandbox delete-file <sandboxId> --path <path> [--recursive]"
  );
  console.log("  openpond sandbox stat-file <sandboxId> --path <path>");
  console.log("  openpond sandbox mkdir <sandboxId> --path <path>");
  console.log(
    "  openpond sandbox move-file <sandboxId> --from-path <path> --to-path <path>"
  );
  console.log("  openpond sandbox git-status <sandboxId>");
  console.log("  openpond sandbox git-diff <sandboxId> [--base-ref <ref>]");
  console.log(
    "  openpond sandbox git-branch <sandboxId> --branch <name> [--create] [--start-point <ref>]"
  );
  console.log(
    '  openpond sandbox git-commit <sandboxId> --message "..." [--all|--paths <csv>]'
  );
  console.log(
    "  openpond sandbox git-pull <sandboxId> [--remote origin] [--branch main] [--rebase|--ff-only false]"
  );
  console.log(
    "  openpond sandbox git-push <sandboxId> [--remote origin] [--branch main] [--set-upstream] [--force-with-lease]"
  );
  console.log(
    "  openpond sandbox smoke --env staging [--account <profile>] [--keep]"
  );
  console.log("  openpond apps list [--handle <handle>] [--refresh] [--json]");
  console.log(
    "  openpond apps code-visibility <handle>/<repo> --visibility public|private"
  );
  console.log("  openpond apps tools");
  console.log(
    "  openpond apps deploy <handle>/<repo> [--env preview|production] [--watch]"
  );
  console.log("  openpond apps env get <handle>/<repo>");
  console.log("  openpond apps env set <handle>/<repo> --env <json>");
  console.log("  openpond apps performance [--app-id <id>]");
  console.log("  openpond apps summary <handle>/<repo>");
  console.log(
    "  openpond apps assistant <plan|performance> <handle>/<repo> --prompt <text>"
  );
  console.log(
    "  openpond apps store events [--source <source>] [--status <csv>] [--symbol <symbol>] [--wallet-address <0x...>] [--since <ms|iso>] [--until <ms|iso>] [--limit <n>] [--cursor <cursor>] [--history <true|false>] [--params <json>]"
  );
  console.log("  openpond apps trade-facts [--app-id <id>]");
  console.log(
    "  openpond apps agent create --prompt <text> [--team-id <id>] [--template-id <id>]"
  );
  console.log(
    "  openpond apps tools execute <appId> <deploymentId> <tool> [--body <json>] [--method <METHOD>] [--headers <json>] [--summary <true|false>]"
  );
  console.log(
    "  openpond apps positions tx [--method <GET|POST>] [--body <json>] [--params <json>]"
  );
  console.log("  openpond check-update");
  console.log("  openpond opentool <init|validate|build> [args]");
  console.log("");
  console.log("Global options:");
  console.log("  --account <name> (alias: --profile <name>)");
  console.log("  --base-url <url> (alias: --baseurl)");
  console.log("  --api-base-url <url> (API endpoint for this profile)");
  console.log(
    "  --chat-api-base-url <url> (hosted chat/model endpoint for this profile)"
  );
  console.log(
    "  --sandbox-api-url <url> (exact /v1/sandboxes or /api/sandboxes endpoint)"
  );
  console.log("");
  console.log("Env:");
  console.log(
    "  OPENPOND_API_KEY, OPENPOND_ACCOUNT, OPENPOND_BASE_URL, OPENPOND_API_URL, OPENPOND_CHAT_API_URL, OPENPOND_TOOL_URL, OPENPOND_SANDBOX_BASE_URL, OPENPOND_SANDBOX_API_URL"
  );
}
