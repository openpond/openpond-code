#!/usr/bin/env node

import {
  runAppsAgentCreate,
  runAppsAssistant,
  runAppsCodeVisibility,
  runAppsDeploy,
  runAppsEnvGet,
  runAppsEnvSet,
  runAppsList,
  runAppsPerformance,
  runAppsPositionsTx,
  runAppsStoreEvents,
  runAppsSummary,
  runAppsTools,
  runAppsToolsExecute,
  runAppsTradeFacts,
  runBacktestEvents,
  runBacktestGet,
} from "./apps";
import {
  getInstalledCliVersion,
  parseArgs,
  resolveAccountOption,
  resolveBaseUrlOption,
} from "./common";
import {
  runAccount,
  runBacktestRun,
  runCheckUpdate,
  runDeployWatch,
  runHealth,
  runLogin,
  runOpentool,
  runProfiles,
  runRepoCreate,
  runRepoPush,
  runTemplateBranches,
  runTemplateStatus,
  runTemplateUpdate,
  runToolList,
  runToolRun,
} from "./core-commands";
import { printHelp } from "./help";
import { runOrganizationsCommand } from "./organizations";
import { runAgentCommand, runProjectCommand } from "./project-agent";
import { runSandboxCommand } from "./sandbox-command";
import { runSandboxTemplateCommand } from "./sandbox-template";

async function main() {
  const { command, options, rest } = parseArgs(process.argv.slice(2));
  const selectedAccount = resolveAccountOption(options);
  const selectedBaseUrl = resolveBaseUrlOption(options);
  if (selectedAccount) {
    process.env.OPENPOND_ACCOUNT = selectedAccount;
  }
  if (
    !selectedAccount &&
    typeof options.handle === "string" &&
    options.handle.trim().length > 0
  ) {
    process.env.OPENPOND_ACCOUNT = options.handle.trim();
  }
  if (selectedBaseUrl) {
    process.env.OPENPOND_BASE_URL = selectedBaseUrl;
  }

  if (options.checkUpdate !== undefined || command === "check-update") {
    await runCheckUpdate();
    return;
  }

  if ((options.version !== undefined && !command) || command === "version") {
    console.log(getInstalledCliVersion());
    return;
  }

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "login") {
    await runLogin(options);
    return;
  }

  if (command === "profiles") {
    await runProfiles(options, rest);
    return;
  }

  if (command === "account") {
    await runAccount(options);
    return;
  }

  if (command === "health") {
    await runHealth(options);
    return;
  }

  if (command === "tool") {
    const subcommand = rest[0];
    if (subcommand === "list") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: tool list <handle>/<repo>");
      }
      await runToolList(options, target);
      return;
    }
    if (subcommand === "run") {
      const target = rest[1];
      const toolName = rest[2];
      if (!target || !toolName) {
        throw new Error(
          "usage: tool run <handle>/<repo> <tool> [--body <json>]"
        );
      }
      await runToolRun(options, target, toolName);
      return;
    }
    throw new Error("usage: tool <list|run> <handle>/<repo> [args]");
  }

  if (command === "backtest") {
    const subcommand = rest[0] || "run";
    if (subcommand === "run") {
      const target = rest[1];
      const toolName = rest[2];
      if (!target || !toolName) {
        throw new Error(
          "usage: backtest run <handle>/<repo> <tool> [--body <json>] [--branch <branch>] [--deployment-id <id>]"
        );
      }
      await runBacktestRun(options, target, toolName);
      return;
    }
    if (subcommand === "events") {
      const target = rest[1];
      if (!target) {
        throw new Error(
          "usage: backtest events <handle>/<repo> [--run-id <id>] [--limit <n>]"
        );
      }
      await runBacktestEvents(options, target);
      return;
    }
    if (subcommand === "get") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: backtest get <handle>/<repo> --run-id <id>");
      }
      await runBacktestGet(options, target);
      return;
    }
    throw new Error("usage: backtest <run|events|get> <handle>/<repo> [args]");
  }

  if (command === "deploy") {
    const subcommand = rest[0] || "watch";
    if (subcommand !== "watch") {
      throw new Error(
        "usage: deploy watch <handle>/<repo> [--branch <branch>]"
      );
    }
    const target = rest[1];
    if (!target) {
      throw new Error(
        "usage: deploy watch <handle>/<repo> [--branch <branch>]"
      );
    }
    await runDeployWatch(options, target);
    return;
  }

  if (command === "template") {
    const subcommand = rest[0] || "status";
    const target = rest[1];
    if (!target) {
      throw new Error(
        "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]"
      );
    }
    if (subcommand === "status") {
      await runTemplateStatus(options, target);
      return;
    }
    if (subcommand === "branches") {
      await runTemplateBranches(options, target);
      return;
    }
    if (subcommand === "update") {
      await runTemplateUpdate(options, target);
      return;
    }
    throw new Error(
      "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]"
    );
  }

  if (command === "sandbox-template") {
    await runSandboxTemplateCommand(options, rest);
    return;
  }

  if (command === "repo") {
    const subcommand = rest[0] || "create";
    if (subcommand === "create") {
      await runRepoCreate(options, rest.slice(1));
      return;
    }
    if (subcommand === "push") {
      await runRepoPush(options);
      return;
    }
    throw new Error(
      "usage: repo <create|push> [--name <name>] [--path <dir>] [--branch <branch>]"
    );
  }

  if (command === "organization" || command === "organizations") {
    await runOrganizationsCommand(options, rest);
    return;
  }

  if (command === "project") {
    await runProjectCommand(options, rest);
    return;
  }

  if (command === "agent") {
    await runAgentCommand(options, rest);
    return;
  }

  if (command === "sandbox") {
    await runSandboxCommand(options, rest);
    return;
  }

  if (command === "apps") {
    const subcommand = rest[0];
    if (subcommand === "list") {
      await runAppsList(options);
      return;
    }
    if (subcommand === "code-visibility") {
      const target = rest[1];
      if (!target) {
        throw new Error(
          "usage: apps code-visibility <handle>/<repo> --visibility public|private"
        );
      }
      await runAppsCodeVisibility(options, target);
      return;
    }
    if (subcommand === "tools") {
      if (rest[1] === "execute") {
        const appId = rest[2];
        const deploymentId = rest[3];
        const toolName = rest[4];
        if (!appId || !deploymentId || !toolName) {
          throw new Error(
            "usage: apps tools execute <appId> <deploymentId> <tool> [--body <json>]"
          );
        }
        await runAppsToolsExecute(options, appId, deploymentId, toolName);
        return;
      }
      await runAppsTools();
      return;
    }
    if (subcommand === "deploy") {
      const target = rest[1];
      if (!target) {
        throw new Error(
          "usage: apps deploy <handle>/<repo> [--env preview|production] [--watch]"
        );
      }
      await runAppsDeploy(options, target);
      return;
    }
    if (subcommand === "env" && rest[1] === "get") {
      const target = rest[2];
      if (!target) {
        throw new Error("usage: apps env get <handle>/<repo>");
      }
      await runAppsEnvGet(options, target);
      return;
    }
    if (subcommand === "env" && rest[1] === "set") {
      const target = rest[2];
      if (!target) {
        throw new Error("usage: apps env set <handle>/<repo> --env <json>");
      }
      await runAppsEnvSet(options, target);
      return;
    }
    if (subcommand === "performance") {
      await runAppsPerformance(options);
      return;
    }
    if (subcommand === "summary") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: apps summary <handle>/<repo>");
      }
      await runAppsSummary(options, target);
      return;
    }
    if (subcommand === "assistant") {
      const mode = rest[1];
      const target = rest[2];
      if ((mode !== "plan" && mode !== "performance") || !target) {
        throw new Error(
          "usage: apps assistant <plan|performance> <handle>/<repo> --prompt <text>"
        );
      }
      await runAppsAssistant(options, mode, target, rest.slice(3));
      return;
    }
    if (subcommand === "store" && rest[1] === "events") {
      await runAppsStoreEvents(options);
      return;
    }
    if (subcommand === "trade-facts") {
      await runAppsTradeFacts(options);
      return;
    }
    if (subcommand === "agent" && rest[1] === "create") {
      await runAppsAgentCreate(options, rest.slice(2));
      return;
    }
    if (subcommand === "positions" && rest[1] === "tx") {
      await runAppsPositionsTx(options);
      return;
    }
    throw new Error(
      "usage: apps <list|code-visibility|tools|deploy|env get|env set|performance|summary|assistant|store events|trade-facts|agent create|positions tx> [args]"
    );
  }

  if (command === "opentool") {
    await runOpentool(process.argv.slice(3));
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
