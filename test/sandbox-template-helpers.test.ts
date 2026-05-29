import { describe, expect, test } from "bun:test";

import {
  defineSandboxTemplate,
  sandboxTemplateDurableVolume,
  sandboxTemplateFileInput,
  sandboxTemplatePreviewPort,
  sandboxTemplateResources,
  validateSandboxTemplateManifest,
} from "../src/sandbox-template/manifest";

describe("sandbox template helpers", () => {
  test("build common resource, volume, file input, and preview port fragments", () => {
    const manifest = defineSandboxTemplate({
      schemaVersion: 1,
      name: "helper-template",
      version: "0.1.0",
      useCase: "helper-test",
      description: "Helper generated manifest.",
      runtime: { base: "node" },
      resources: sandboxTemplateResources({ cpu: 1, memoryGb: 2, diskGb: 8 }),
      validation: { commands: ["echo ok"], probes: [] },
      start: {
        command: "bun run process",
        ports: [],
      },
      services: [
        {
          name: "web",
          command: "bun dev --host 0.0.0.0 --port 3000",
          ports: [sandboxTemplatePreviewPort(3000, { label: "web" })],
        },
      ],
      volumes: [
        sandboxTemplateDurableVolume({
          name: "uploads",
          mountPath: "/workspace/volumes/uploads",
          storageGb: 8,
        }),
      ],
      inputs: {
        schema: {
          type: "object",
          required: ["proposal"],
          properties: {
            proposal: sandboxTemplateFileInput({
              title: "Proposal",
              targetPath: "volumes/uploads/proposals",
              accept: [".pdf"],
            }),
            history: sandboxTemplateFileInput({
              title: "History",
              targetPath: "volumes/uploads/history",
              accept: [".xlsx", ".csv"],
              multiple: true,
            }),
          },
        },
        env: [],
      },
      actions: [],
      schedules: [],
      mcp: { endpoints: [] },
      integrations: { requiredLeases: [] },
      artifacts: { paths: [] },
      network: { egress: "restricted" },
      setup: { commands: [] },
    });

    const result = validateSandboxTemplateManifest(manifest);

    expect(result.ok).toBe(true);
    expect(manifest.volumes[0]?.deleteOnSandboxDelete).toBe(false);
    expect(manifest.services[0]?.ports[0]).toMatchObject({
      port: 3000,
      access: "private",
      path: "/",
    });
  });

  test("uses the validator for invalid helper fragments", () => {
    expect(() => sandboxTemplatePreviewPort(2999)).toThrow();
    expect(() =>
      sandboxTemplateFileInput({ targetPath: "../outside" })
    ).toThrow();
  });
});
