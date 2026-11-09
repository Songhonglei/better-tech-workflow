// Auto-wires the browser logger into src/main.tsx.
// Usage: node wire-client-logger.mjs <project-path>
//
// Why this exists as its own step: the browser half of app.log used to be
// registered only as a side effect of importing providers/trpc.tsx (which does
// `import "../lib/logger"`). That made it depend on TRPCProvider actually being
// wired into main.tsx — which is NOT guaranteed: init.sh skips all auto-wiring
// in template mode, skips it again on any run that is not the first, and
// wire-main-tsx.mjs exits 1 when it cannot find its <BrowserRouter> anchor while
// init.sh only records that in a WIRING_TODO array (no error, no stop). Any of
// those left the logger unloaded and browser errors silently unreachable.
//
// So this step is unconditional and idempotent: it inserts one side-effect
// import at the top of main.tsx and does not care about providers, routers, or
// whether the graft ran. Exits 0 when wired or already wired, 1 only when
// main.tsx is missing (a caller error worth surfacing).

import fs from "fs";

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("Usage: node wire-client-logger.mjs <project-path>");
  process.exit(1);
}

const mainPath = projectPath + "/src/main.tsx";
if (!fs.existsSync(mainPath)) process.exit(1);

const IMPORT_LINE = 'import "@/lib/logger";';
const MARKER = "@/lib/logger";

let src = fs.readFileSync(mainPath, "utf8");

// Already wired (by this script or by hand) — nothing to do.
if (src.includes(MARKER)) process.exit(0);

// Insert as the FIRST import so the window error/unhandledrejection listeners
// are registered before any app module runs: an error thrown during the initial
// render must already be captured.
const importRe = /^(import\s+.+)$/m;
if (importRe.test(src)) {
  src = src.replace(importRe, IMPORT_LINE + "\n$1");
} else {
  // No import block at all (unusual) — prepend.
  src = IMPORT_LINE + "\n" + src;
}

fs.writeFileSync(mainPath, src);
process.exit(0);
