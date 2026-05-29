import type { OpenPondSandboxClient } from "../sandbox/client";
import { parseBooleanOption, parseIntegerOption } from "./common";
import {
  buildTemplateBuildCreateInput,
  formatTemplateBuildLine,
} from "./sandbox-helpers";

export async function handleSandboxTemplateBuildsCommand(
  client: OpenPondSandboxClient,
  subcommand: string,
  options: Record<string, string | boolean>,
  rest: string[]
): Promise<boolean> {
  if (
    subcommand === "template-builds" ||
    subcommand === "template-build-list"
  ) {
    const teamId =
      typeof options.teamId === "string" ? options.teamId.trim() : "";
    if (!teamId) {
      throw new Error("usage: sandbox template-builds --team-id <id>");
    }
    const builds = await client.listTemplateBuilds({ teamId });
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify({ builds }, null, 2));
      return true;
    }
    if (builds.length === 0) {
      console.log("no sandbox template builds found");
      return true;
    }
    for (const build of builds) {
      console.log(formatTemplateBuildLine(build));
    }
    return true;
  }

  if (
    subcommand === "template-build-create" ||
    subcommand === "create-template-build"
  ) {
    const build = await client.createTemplateBuild(
      buildTemplateBuildCreateInput(options)
    );
    console.log(JSON.stringify({ build }, null, 2));
    return true;
  }

  if (
    subcommand === "template-build-get" ||
    subcommand === "get-template-build"
  ) {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-get <buildId>");
    }
    const build = await client.getTemplateBuild(buildId);
    console.log(JSON.stringify({ build }, null, 2));
    return true;
  }

  if (
    subcommand === "template-build-logs" ||
    subcommand === "template-build-log"
  ) {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-logs <buildId>");
    }
    const logs = await client.getTemplateBuildLogs(buildId);
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify(logs, null, 2));
      return true;
    }
    for (const line of logs.logs) {
      console.log(line);
    }
    return true;
  }

  if (
    subcommand === "template-build-cancel" ||
    subcommand === "cancel-template-build"
  ) {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-cancel <buildId>");
    }
    const build = await client.cancelTemplateBuild(buildId);
    console.log(JSON.stringify({ build }, null, 2));
    return true;
  }

  if (
    subcommand === "template-build-watch" ||
    subcommand === "watch-template-build"
  ) {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-watch <buildId>");
    }
    const intervalMs =
      parseIntegerOption(options.intervalMs, "interval-ms") ?? 5000;
    const timeoutMs =
      parseIntegerOption(options.timeoutMs, "timeout-ms") ?? 15 * 60 * 1000;
    const startedAt = Date.now();
    const seenLogs = new Set<string>();
    while (Date.now() - startedAt <= timeoutMs) {
      const [build, logs] = await Promise.all([
        client.getTemplateBuild(buildId),
        client.getTemplateBuildLogs(buildId),
      ]);
      for (const line of logs.logs) {
        if (!seenLogs.has(line)) {
          seenLogs.add(line);
          console.log(line);
        }
      }
      if (
        build.status === "succeeded" ||
        build.status === "failed" ||
        build.status === "cancelled"
      ) {
        console.log(formatTemplateBuildLine(build));
        if (build.status !== "succeeded") {
          throw new Error(
            `sandbox template build ${build.status}: ${
              build.error ?? "no error"
            }`
          );
        }
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `sandbox template build did not finish within ${timeoutMs}ms`
    );
  }

  return false;
}
