import { startManager } from "./manager";

async function main() {
  await startManager();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "TUI failed";
  console.error(message);
  process.exit(1);
});
