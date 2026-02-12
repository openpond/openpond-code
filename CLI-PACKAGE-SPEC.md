# OpenPond CLI Package Spec

## Overview
Package the OpenPond API-key CLI into an installable tool that works via `npx`, `npm -g`, and a curl-based installer on macOS and Linux. The CLI should support both `openpond` and `op` command names, prompt for an API key on first use, store it in a user config, and keep minimal directory awareness for repo-specific operations.

## Goals
- Provide a zero-config install path: `npx openpond-code ...` and `curl | bash` for macOS/Linux.
- Support aliases `openpond` and `op` as binaries.
- Prompt for API key once, store it, and use it for API-backed commands.
- Preserve current command behavior for the new suite: `tool list`, `tool run`, `deploy watch`.
- Minimal directory awareness: use current working directory only.
- Add a changeset-driven changelog process like `opentool`.

## Non-goals
- Windows installer (can be added later).
- Rewriting the CLI UX or command surface.
- Supporting token or device login flows (API key only).

## User Experience
### First-run flow
1. User runs `openpond tool list <handle>/<repo>` (or any auth-required command).
2. CLI prompts: "Enter your OpenPond API key (opk_...)".
3. Key saved to global config (e.g., `~/.openpond/config.json`) and used for subsequent calls.
4. CLI prints a brief success message and proceeds with the command.

### Login command
- `openpond login` prints the UI link to generate an API key and prompts to paste it.
- The key is stored in `~/.openpond/config.json`.

### Command names
- Primary: `openpond`
- Alias: `op`

### Example usage
```bash
npx openpond-code tool list handle/repo
openpond tool list handle/repo
op tool run handle/repo myTool --body '{"foo":"bar"}'
op deploy watch handle/repo --branch main
op template status handle/repo
op template update handle/repo --env production
```

## Installation
### npm / npx
- Publish package to npm (name: `openpond-code`).
- Provide `bin` entries for both `openpond` and `op`.
- `npx openpond` should work without prior global install.

### curl installer (macOS/Linux)
- Provide a script like `https://openpond.ai/install.sh` that:
  - Downloads a prebuilt tarball from GitHub Releases.
  - Installs to `~/.openpond/bin/openpond` and `~/.openpond/bin/op` (no `/opt`).
  - Prints PATH instructions if `~/.openpond/bin` is not in PATH.
- Avoid requiring sudo; keep install local to the user.

## Auth and Config
### Config precedence
1. `OPENPOND_API_KEY` environment variable
2. Global config: `~/.openpond/config.json`

### Stored fields (global)
- `apiKey`
- `baseUrl` (optional)

### Behavior
- If `OPENPOND_API_KEY` is set, do not prompt.
- If no API key is found, prompt and save to global config.
- API keys only (no token-based login).

### Optional overrides
- `OPENPOND_BASE_URL` (UI base)
- `OPENPOND_API_URL` (public API base)
- `OPENPOND_TOOL_URL` (tool gateway override)

### Cache
- `~/.openpond/cache.json` stores recent app/tool lists per API host.
- Cache refreshes when stale (default 1 hour) and after `apps agent create`.

## Directory Awareness
- Use current working directory only; no repo discovery.

## Packaging / Build
- Build `src/cli-package.ts` to a Node-compatible `dist/cli.js`.
- Add a shebang: `#!/usr/bin/env node`.
- Update `package.json`:
  - `bin`: `{ "openpond": "dist/cli.js", "op": "dist/cli.js" }`
  - `files`: include `dist/`, `README.md`, `CHANGELOG.md`
  - `type`: `module` or switch to `commonjs` if needed for Node runtime.
- Suggested build command (Bun):
  - `bun build src/cli-package.ts --outfile dist/cli.js --target node`

## Commands (current surface)
- `login [--api-key <key>]` — save an API key (prompt if omitted)
- `deploy watch <handle>/<repo> [--branch]`
- `template status <handle>/<repo>`
- `template branches <handle>/<repo>`
- `template update <handle>/<repo> [--env preview|production]`
- `tool list <handle>/<repo>`
- `tool run <handle>/<repo> <tool> [--body <json>] [--method <GET|POST|...>]`
- `apps list [--handle <handle>] [--refresh]`
- `apps tools`
- `apps deploy <handle>/<repo> [--env preview|production] [--watch]`
- `apps env get <handle>/<repo>`
- `apps env set <handle>/<repo> --env <json>`
- `apps performance [--app-id <id>]`
- `apps agent create --prompt <text> [--template-id <id>]`
- `apps tools execute <appId> <deploymentId> <tool> [--body <json>] [--method <METHOD>] [--headers <json>]`
- `apps positions tx [--method <GET|POST>] [--body <json>] [--params <json>]`

## Changelog / Release
### Option A: Changelog-only (match `opentool`)
- Add `CHANGELOG.md` and append entries per release.
- Keep a simple "Patch/Minor/Major" format.

### Option B: Changesets
- Add `.changeset/` and `@changesets/cli`.
- Generate changelog during release.

## Open Questions
- Hosting location for curl installer and release artifacts.
