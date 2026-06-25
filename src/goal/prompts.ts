import type { GoalState } from "./types";

export type GoalPromptPack = {
  id: string;
  title: string;
  instructions: string;
};

const GENERIC_CODING_PROMPT = `# Generic Coding Goal

You are working on a source-backed coding goal. Make scoped source edits, run the configured checks, ask structured questions when blocked, and return a reviewable result.`;

const CREATE_AGENT_PROMPT = `# Create OpenPond Agent Goal

Create a source-backed OpenPond agent from the user's prompt. Ask structured questions for missing setup decisions, run the project-local OpenPond agent SDK commands through the openpond_agent_* tools, and leave a reviewable source update. Do not invoke openpond-agent through shell, npx, pnpm dlx, or yarn dlx.

Hosted create-agent goals may start from a generated OpenPond SDK project with package.json, openpond.yaml, and agent/** already present. Treat that as the scaffold to edit. Do not exhaust tool rounds reading every source file. Once you understand the scaffold and answered questions, update the minimal source files needed, run openpond_agent_default_checks, and then return a final no-tool response. If checks fail, use the check output and trace refs as repair input, edit the source or eval that is wrong, and rerun checks before returning a final response. Generated evals must test the behavior the agent actually implements; if you add a new intent/action, wire the default chat path or the eval input so the intent and result contract match. Do not inspect the openpond-agent-sdk package internals, vendored SDK source, or generated .openpond outputs unless an OpenPond agent check explicitly reports an error in those files. Use the existing agent/** files and the openpond_agent_* tools as the contract. For SharePoint or other unavailable external systems, do not spend multiple rounds searching for CLIs, SDK packages, credentials, or network access. If the user gives enough target details but real external access is unavailable, create a local draft agent behavior that detects the request, explains the missing external access honestly, and includes eval coverage for that intent. Then run openpond_agent_default_checks and return a final answer with the external access blocker. Do not claim that an external read/write succeeded.`;

const UPDATE_AGENT_PROMPT = `# Update OpenPond Agent Goal

Update an existing source-backed OpenPond agent from the user's request and evidence refs. Run before/after checks through the openpond_agent_* tools and leave a reviewable source update. Do not invoke openpond-agent through shell, npx, pnpm dlx, or yarn dlx.`;

export function resolveGoalPromptPack(goal: GoalState): GoalPromptPack {
  if (goal.promptPack === "openpond_agent_create_v1") {
    return {
      id: goal.promptPack,
      title: "Create OpenPond Agent Goal",
      instructions: CREATE_AGENT_PROMPT,
    };
  }
  if (goal.promptPack === "openpond_agent_update_v1") {
    return {
      id: goal.promptPack,
      title: "Update OpenPond Agent Goal",
      instructions: UPDATE_AGENT_PROMPT,
    };
  }
  return {
    id: goal.promptPack || "generic_coding_v1",
    title: "Generic Coding Goal",
    instructions: GENERIC_CODING_PROMPT,
  };
}
