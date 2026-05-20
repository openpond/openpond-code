import yaml from "js-yaml";
import { z } from "zod";

export const SANDBOX_TEMPLATE_PREVIEW_PORT_MIN = 3000;
export const SANDBOX_TEMPLATE_PREVIEW_PORT_MAX = 9999;

const INTEGRATION_PROVIDERS = [
  "google",
  "slack",
  "github",
  "microsoft_teams",
  "x",
  "notion",
  "linear",
] as const;

const RESERVED_PREVIEW_PORTS = new Set([22, 2222, 2375, 2376, 3108, 5900, 5901, 6080, 7818]);

const CommandListSchema = z.array(z.string().trim().min(1).max(1000)).max(50);

const RelativeWorkspacePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(isSafeRelativeWorkspacePath, {
    message: "path must be a relative workspace path",
  });

const SandboxTemplateRuntimeSchema = z
  .object({
    base: z.string().trim().min(1).max(120).optional(),
    snapshot: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine(
    (runtime) => Boolean(runtime.base) !== Boolean(runtime.snapshot),
    "runtime must declare exactly one of base or snapshot",
  );

const SandboxTemplateResourcesSchema = z
  .object({
    cpu: z.number().positive().max(8).optional(),
    memoryGb: z.number().positive().max(32).optional(),
    diskGb: z.number().positive().max(100).optional(),
  })
  .strict();

const SandboxTemplateRequiredLeaseSchema = z
  .object({
    provider: z.enum(INTEGRATION_PROVIDERS),
    scopes: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    capabilities: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  })
  .strict();

const SandboxTemplateDatabaseSchema = z
  .object({
    engine: z.literal("postgres"),
    version: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(63).optional(),
    plan: z.literal("dev").optional(),
    storageGb: z.number().int().positive().max(100).optional(),
    extensions: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    publicAccess: z.boolean().optional(),
  })
  .strict();

const SandboxTemplateVolumeSchema = z
  .object({
    name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/).max(63).optional(),
    mountPath: z.string().trim().min(1).max(256).optional(),
    storageGb: z.number().int().positive().max(100).optional(),
    deleteOnSandboxDelete: z.boolean().optional(),
  })
  .strict();

const SandboxTemplatePortSchema = z
  .object({
    port: z
      .number()
      .int()
      .min(SANDBOX_TEMPLATE_PREVIEW_PORT_MIN)
      .max(SANDBOX_TEMPLATE_PREVIEW_PORT_MAX)
      .refine((port) => !RESERVED_PREVIEW_PORTS.has(port), {
        message: "preview port is reserved",
      }),
    protocol: z.literal("http").default("http"),
    label: z.string().trim().min(1).max(80).optional(),
    access: z.enum(["private", "public"]).default("private"),
    path: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((value) => value.startsWith("/"), {
        message: "preview path must start with /",
      })
      .default("/"),
  })
  .strict();

const SandboxTemplateCommandSchema = z
  .object({
    command: z.string().trim().min(1).max(1000),
    cwd: RelativeWorkspacePathSchema.optional(),
    timeoutSeconds: z.number().int().positive().max(86_400).optional(),
    ports: z.array(SandboxTemplatePortSchema).max(20).default([]),
    artifactPaths: z.array(RelativeWorkspacePathSchema).max(100).default([]),
  })
  .strict();

const SandboxTemplateNamedCommandSchema = SandboxTemplateCommandSchema.extend({
  name: z.string().trim().min(1).max(80),
}).strict();

const SandboxTemplateValidationProbeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    port: z
      .number()
      .int()
      .min(SANDBOX_TEMPLATE_PREVIEW_PORT_MIN)
      .max(SANDBOX_TEMPLATE_PREVIEW_PORT_MAX)
      .refine((port) => !RESERVED_PREVIEW_PORTS.has(port), {
        message: "validation probe port is reserved",
      }),
    path: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((value) => value.startsWith("/"), {
        message: "validation probe path must start with /",
      })
      .default("/"),
    expectedStatus: z.number().int().min(100).max(599).default(200),
  })
  .strict();

const SandboxTemplateJsonSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === "object", "input schema must be a JSON schema object");

export const SandboxTemplateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    version: z.string().trim().min(1).max(40),
    useCase: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    runtime: SandboxTemplateRuntimeSchema,
    resources: SandboxTemplateResourcesSchema.optional(),
    setup: z
      .object({
        commands: CommandListSchema.default([]),
      })
      .strict()
      .default({ commands: [] }),
    validation: z
      .object({
        commands: CommandListSchema.min(1),
        probes: z.array(SandboxTemplateValidationProbeSchema).max(20).default([]),
      })
      .strict(),
    start: SandboxTemplateCommandSchema,
    actions: z.array(SandboxTemplateNamedCommandSchema).max(20).default([]),
    services: z.array(SandboxTemplateNamedCommandSchema).max(20).default([]),
    databases: z.array(SandboxTemplateDatabaseSchema).max(5).default([]),
    volumes: z.array(SandboxTemplateVolumeSchema).max(5).default([]),
    integrations: z
      .object({
        requiredLeases: z.array(SandboxTemplateRequiredLeaseSchema).max(20).default([]),
      })
      .strict()
      .default({ requiredLeases: [] }),
    inputs: z
      .object({
        schema: SandboxTemplateJsonSchema.default({ type: "object" }),
      })
      .strict()
      .default({ schema: { type: "object" } }),
    artifacts: z
      .object({
        paths: z.array(RelativeWorkspacePathSchema).max(100).default([]),
      })
      .strict()
      .default({ paths: [] }),
    network: z
      .object({
        egress: z.enum(["restricted", "allow", "block"]).default("restricted"),
      })
      .strict()
      .default({ egress: "restricted" }),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateExecutableNames(manifest, context);
    addDuplicateNameIssue(
      context,
      manifest.databases.flatMap((database) => (database.name ? [database.name] : [])),
      "database names must be unique",
      "databases",
    );
    addDuplicateNameIssue(
      context,
      manifest.volumes.flatMap((volume) => (volume.name ? [volume.name] : [])),
      "volume names must be unique",
      "volumes",
    );
    validateInputSchemaUploadTargets(manifest, context);
  });

export type SandboxTemplateManifest = z.infer<typeof SandboxTemplateManifestSchema>;
export type SandboxTemplatePort = SandboxTemplateManifest["start"]["ports"][number];
export type SandboxTemplateCommand = SandboxTemplateManifest["start"];
export type SandboxTemplateNamedCommand = SandboxTemplateManifest["actions"][number];
export type SandboxTemplateExecutableKind = "start" | "action" | "service";

export type SandboxTemplateExecutable = SandboxTemplateCommand & {
  kind: SandboxTemplateExecutableKind;
  name: string;
};

export type SandboxTemplateValidationDiagnostic = {
  path: string;
  message: string;
  code: string;
};

export type SandboxTemplateValidationResult =
  | {
      ok: true;
      manifest: SandboxTemplateManifest;
      diagnostics: [];
    }
  | {
      ok: false;
      manifest: null;
      diagnostics: SandboxTemplateValidationDiagnostic[];
    };

export const SandboxTemplateValidationDiagnosticSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
});

export function validateSandboxTemplateYaml(source: string): SandboxTemplateValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    return {
      ok: false,
      manifest: null,
      diagnostics: [
        {
          path: "$",
          code: "invalid_yaml",
          message: error instanceof Error ? error.message : "Invalid YAML",
        },
      ],
    };
  }
  return validateSandboxTemplateManifest(parsed);
}

export function validateSandboxTemplateManifest(value: unknown): SandboxTemplateValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      manifest: null,
      diagnostics: [
        {
          path: "$",
          code: "invalid_type",
          message: "sandbox-template.yaml must be an object",
        },
      ],
    };
  }
  const result = SandboxTemplateManifestSchema.safeParse(value);
  if (result.success) return { ok: true, manifest: result.data, diagnostics: [] };
  return {
    ok: false,
    manifest: null,
    diagnostics: result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      code: issue.code,
      message: issue.message,
    })),
  };
}

export function parseSandboxTemplateYaml(source: string): SandboxTemplateManifest {
  const result = validateSandboxTemplateYaml(source);
  if (!result.ok) {
    throw new Error(formatSandboxTemplateDiagnostics(result.diagnostics));
  }
  return result.manifest;
}

export function formatSandboxTemplateDiagnostics(
  diagnostics: SandboxTemplateValidationDiagnostic[],
): string {
  return diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n");
}

export function defineSandboxTemplate<T extends SandboxTemplateManifest>(template: T): T {
  return SandboxTemplateManifestSchema.parse(template) as T;
}

export function sandboxTemplateExecutableEntries(
  manifest: SandboxTemplateManifest,
): SandboxTemplateExecutable[] {
  return [
    {
      kind: "start",
      name: "start",
      ...manifest.start,
      artifactPaths: commandArtifactPaths(manifest.start, manifest),
    },
    ...manifest.actions.map((action) => ({
      kind: "action" as const,
      name: action.name,
      command: action.command,
      cwd: action.cwd,
      timeoutSeconds: action.timeoutSeconds,
      ports: action.ports,
      artifactPaths: commandArtifactPaths(action, manifest),
    })),
    ...manifest.services.map((service) => ({
      kind: "service" as const,
      name: service.name,
      command: service.command,
      cwd: service.cwd,
      timeoutSeconds: service.timeoutSeconds,
      ports: service.ports,
      artifactPaths: commandArtifactPaths(service, manifest),
    })),
  ];
}

export function sandboxTemplateBuildMetadata(manifest: SandboxTemplateManifest): Record<string, unknown> {
  const executables = sandboxTemplateExecutableEntries(manifest);
  return {
    template: {
      name: manifest.name,
      version: manifest.version,
      useCase: manifest.useCase,
      runtime: manifest.runtime,
    },
    resources: manifest.resources ?? null,
    databases: manifest.databases,
    volumes: manifest.volumes,
    executables: executables.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      command: entry.command,
      cwd: entry.cwd ?? null,
      timeoutSeconds: entry.timeoutSeconds ?? null,
      ports: entry.ports.map((port) => port.port),
      artifactPaths: entry.artifactPaths,
    })),
    ports: executables.flatMap((entry) =>
      entry.ports.map((port) => ({
        executable: entry.name,
        kind: entry.kind,
        port: port.port,
        access: port.access,
        label: port.label ?? null,
      })),
    ),
    validation: {
      commands: manifest.validation.commands,
      probes: manifest.validation.probes,
    },
  };
}

export type SandboxTemplateScaffoldInput = {
  name: string;
  description?: string;
};

export function sandboxTemplateScaffoldFiles(
  input: SandboxTemplateScaffoldInput,
): Record<string, string> {
  const displayName = input.name.trim() || "Sandbox Template";
  const name = slug(displayName);
  const description = input.description?.trim() || `Local scaffold for ${displayName}.`;
  return {
    ".gitignore": ["node_modules", "artifacts", ".DS_Store", ""].join("\n"),
    "README.md": [
      `# ${displayName}`,
      "",
      "Local sandbox template scaffold.",
      "",
      "## Commands",
      "",
      "- `bun run dev` starts the preview service on port 3000.",
      "- `bun run process` writes a sample artifact.",
      "- `bun run validate` validates sandbox-template.yaml.",
      "",
    ].join("\n"),
    "package.json": `${JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: {
          dev: "bun src/server.mjs",
          process: "bun scripts/process.mjs",
          validate: "openpond sandbox-template validate --file sandbox-template.yaml",
        },
      },
      null,
      2,
    )}\n`,
    "sandbox-template.yaml": [
      "schemaVersion: 1",
      `name: ${name}`,
      "version: 0.1.0",
      "useCase: sandbox-template-scaffold",
      `description: ${description}`,
      "runtime:",
      "  base: node-bun-workspace",
      "resources:",
      "  cpu: 1",
      "  memoryGb: 1",
      "  diskGb: 8",
      "setup:",
      "  commands:",
      "    - mkdir -p artifacts",
      "validation:",
      "  commands:",
      "    - test -f src/server.mjs",
      "    - test -f scripts/process.mjs",
      "start:",
      "  command: bun scripts/process.mjs",
      "  timeoutSeconds: 300",
      "  ports: []",
      "  artifactPaths:",
      "    - artifacts/result.json",
      "actions: []",
      "services:",
      "  - name: web",
      "    command: bun src/server.mjs",
      "    timeoutSeconds: 3600",
      "    ports:",
      "      - port: 3000",
      "        protocol: http",
      "        label: web",
      "        access: private",
      "        path: /",
      "    artifactPaths: []",
      "inputs:",
      "  schema:",
      "    type: object",
      "    properties:",
      "      subject:",
      "        type: string",
      "        title: Subject",
      "        default: Example",
      "artifacts:",
      "  paths:",
      "    - artifacts/result.json",
      "network:",
      "  egress: restricted",
      "",
    ].join("\n"),
    "src/server.mjs": [
      "Bun.serve({",
      "  host: '0.0.0.0',",
      "  port: 3000,",
      "  fetch() {",
      "    return Response.json({ ok: true, template: 'sandbox-template-scaffold' });",
      "  },",
      "});",
      "",
    ].join("\n"),
    "scripts/process.mjs": [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "",
      "const raw = process.env.OPENPOND_REPLAY_PARAMS_BASE64;",
      "const params = raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).input ?? {} : {};",
      "await mkdir('artifacts', { recursive: true });",
      "await writeFile('artifacts/result.json', JSON.stringify({ ok: true, input: params }, null, 2));",
      "console.log('wrote artifacts/result.json');",
      "",
    ].join("\n"),
    "fixtures/input.txt": "Example input\n",
  };
}

export function sandboxTemplateJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SandboxTemplateManifestSchema) as Record<string, unknown>;
}

function isSafeRelativeWorkspacePath(value: string): boolean {
  return (
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !value.split(/[\\/]+/).some((segment) => segment === ".." || segment === "")
  );
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";
  return `$${path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")}`;
}

function addDuplicateNameIssue(
  context: z.RefinementCtx,
  names: string[],
  message: string,
  path: string,
): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message,
      });
      return;
    }
    seen.add(name);
  }
}

function validateExecutableNames(
  manifest: {
    actions: Array<{ name: string }>;
    services: Array<{ name: string }>;
  },
  context: z.RefinementCtx,
): void {
  const names = [
    "start",
    ...manifest.actions.map((action) => action.name),
    ...manifest.services.map((service) => service.name),
  ];
  addDuplicateNameIssue(context, names, "start, action, and service names must be unique", "actions");
}

function validateInputSchemaUploadTargets(
  manifest: {
    inputs: { schema: Record<string, unknown> };
    volumes: Array<{ name?: string }>;
  },
  context: z.RefinementCtx,
): void {
  const properties = asRecord(manifest.inputs.schema.properties);
  const volumeNames = new Set(
    manifest.volumes.map((volume) => volume.name).filter((name): name is string => Boolean(name)),
  );
  for (const [inputName, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    const upload = asRecord(property["x-openpond-upload"] ?? property.xOpenPondUpload);
    const targetPath =
      typeof upload.targetPath === "string" && upload.targetPath.trim()
        ? upload.targetPath.trim()
        : typeof upload.path === "string" && upload.path.trim()
          ? upload.path.trim()
          : "";
    if (!targetPath) continue;
    const normalizedTargetPath = targetPath.replace(/^workspace\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!isSafeRelativeWorkspacePath(normalizedTargetPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputs", "schema", "properties", inputName, "x-openpond-upload", "targetPath"],
        message: "upload target must be a relative workspace path",
      });
      continue;
    }
    const parts = normalizedTargetPath.split("/");
    if (parts[0] === "volumes" && (!parts[1] || !volumeNames.has(parts[1]))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputs", "schema", "properties", inputName, "x-openpond-upload", "targetPath"],
        message: "upload target references an undeclared volume",
      });
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function commandArtifactPaths(
  command: Pick<SandboxTemplateCommand, "artifactPaths">,
  manifest: SandboxTemplateManifest,
): string[] {
  return command.artifactPaths.length > 0 ? command.artifactPaths : manifest.artifacts.paths;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 80) || "sandbox-template"
  );
}
