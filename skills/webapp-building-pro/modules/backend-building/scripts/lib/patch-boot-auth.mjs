// Patches boot.ts to add OAuth callback handler.
// Usage: node patch-boot-auth.mjs <project-path>
//
// Adds kimi/auth import and OAuth callback route. Idempotent.

import fs from "fs";

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("Usage: node patch-boot-auth.mjs <project-path>");
  process.exit(1);
}

const bootPath = projectPath + "/api/boot.ts";
if (!fs.existsSync(bootPath)) {
  console.error("Error: " + bootPath + " not found");
  process.exit(1);
}

let src = fs.readFileSync(bootPath, "utf8");

if (src.includes("createOAuthCallbackHandler")) {
  process.exit(0);
}

// Add imports before the first function declaration or async function
const envImportRe = /^(import\s+\{?\s*env\s*\}?\s+from\s+.+)$/m;
if (envImportRe.test(src)) {
  src = src.replace(
    envImportRe,
    '$1\nimport { createOAuthCallbackHandler } from "./kimi/auth";\nimport { Paths } from "@contracts/constants";'
  );
} else {
  // Fallback: add after the last import
  const lastImportIndex = src.lastIndexOf("\nimport ");
  if (lastImportIndex !== -1) {
    const lineEnd = src.indexOf("\n", lastImportIndex + 1);
    src =
      src.slice(0, lineEnd + 1) +
      'import { createOAuthCallbackHandler } from "./kimi/auth";\nimport { Paths } from "@contracts/constants";\n' +
      src.slice(lineEnd + 1);
  }
}

// Add OAuth callback route after the tRPC bodyLimit line (the anchor must match
// the route-scoped form from boot.ts — a bare global bodyLimit no longer exists).
//
// The replace is asserted, not assumed: `String.replace` silently no-ops when
// the anchor drifts (it already drifted once in this MR, when the bodyLimit call
// was narrowed to /api/trpc). An unasserted no-op would drop the OAuth callback
// route while this script still exits 0 — the login flow would 404 with nothing
// in any log pointing here. Failing loudly beats a missing route.
const withRoute = src.replace(
  /(app\.use\("\/api\/trpc\/\*", bodyLimit\(\{[^}]+\}\)\);)/,
  "$1\napp.get(Paths.oauthCallback, createOAuthCallbackHandler());"
);
if (withRoute === src || !withRoute.includes("createOAuthCallbackHandler()")) {
  console.error(
    `patch-boot-auth: anchor not found in ${bootPath}; the OAuth callback route ` +
      `was NOT added. Re-check the bodyLimit line in boot.ts.`
  );
  process.exit(1);
}
src = withRoute;

fs.writeFileSync(bootPath, src);
