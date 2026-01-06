#!/usr/bin/env node

/**
 * CLI dispatcher for german-verbs
 * Usage: node src/index.js <command> [options]
 *
 * Commands:
 *   scrape        Run the scraper (supports --resume, --incomplete)
 */

// Minimal dispatcher that dynamically imports subcommands
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.log("Usage: node src/index.js <command> [options]\n");
    console.log("Available commands:");
    console.log(
      "  scrape        Run scraper (supports --resume, --incomplete)"
    );
    process.exit(0);
  }

  if (cmd === "scrape") {
    const subArgs = args.slice(1);
    const resumeMode = subArgs.includes("--resume") || subArgs.includes("-r");
    const incompleteMode =
      subArgs.includes("--incomplete") || subArgs.includes("-i");

    const mod = await import("./scrape.js");
    await mod.main(resumeMode, incompleteMode);
    return;
  }

  if (cmd === "frequency") {
    const mod = await import("./frequency.js");
    await mod.main();
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
