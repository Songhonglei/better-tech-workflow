// Integration regression: run each published patcher, then load its output in Vite.
// Install probe dependencies outside the repo:
//   npm install --prefix "$TMPDIR/skr-vite-probe" vite@7.3.0 @hono/vite-dev-server@0.19.0
//   SKR_VITE_TEST_DEPS="$TMPDIR/skr-vite-probe/node_modules" node --test <this-file>
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const deps = process.env.SKR_VITE_TEST_DEPS;
assert.ok(deps, "Set SKR_VITE_TEST_DEPS to the probe's node_modules directory");
const require = createRequire(path.join(path.resolve(deps), "../package.json"));
const { createServer, loadConfigFromFile } = await import(pathToFileURL(require.resolve("vite")));
const variants = ["backend-building-v2", "swarm/backend-building-swarm"];
const cases = [
  { name: "existing server", server: "server: { port: 3000 },", port: 3000 },
  { name: "no server", server: "", port: 3000, allowAll: true },
  { name: "custom allowlist and nested settings", port: 3210, customHost: true,
    server: `server: {
    port: 3210,
    allowedHosts: ["custom.example"],
    hmr: { overlay: false },
    proxy: { "/backend": { target: "http://127.0.0.1:4321", changeOrigin: true } },
  },` },
  { name: "explicit allow-all", server: "server: { port: 3000, allowedHosts: true },",
    port: 3000, allowAll: true },
  { name: "already allowed", port: 3000,
    server: 'server: { port: 3000, allowedHosts: ["3000.proxy.internal"] },' },
  { name: "spread server", port: 3000,
    server: 'server: { ...{ port: 3000, allowedHosts: ["custom.example"] } },', customHost: true },
  { name: "existing plugin config hooks", port: 3000, server: "server: { port: 3000 },",
    plugins: `[
    { name: "existing-pre", enforce: "pre", config() {
      return { server: { allowedHosts: ["pre.example"] } };
    } },
    { name: "existing-post", enforce: "post", config() {
      return { server: { allowedHosts: ["post.example"] } };
    } },
  ]` },
];

function request(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error("HTTP probe timed out")));
    req.on("error", reject);
  });
}

for (const variant of variants) {
  for (const scenario of cases) {
    test(`${variant}: ${scenario.name}`, async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "skr-vite-host-"));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      fs.symlinkSync(path.resolve(deps), path.join(root, "node_modules"), "dir");
      fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
      fs.mkdirSync(path.join(root, "api"));
      fs.writeFileSync(path.join(root, "api/boot.ts"),
        'export default { fetch() { return new Response("api-probe"); } };');
      fs.writeFileSync(path.join(root, "index.html"), "<h1>preview-host-probe</h1>");
      const configFile = path.join(root, "vite.config.ts");
      fs.writeFileSync(configFile, `import path from "path"
import { defineConfig } from "vite"
export default defineConfig({
  plugins: ${scenario.plugins ?? "[]"},
  resolve: { alias: {
    "@": path.resolve(import.meta.dirname, "./src"),
  } },
  ${scenario.server}
});
`);
      const patcher = path.join(repo, "skills", variant, "scripts/lib/patch-vite-config.mjs");
      const patch = () => {
        const result = spawnSync(process.execPath, [patcher, root], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      };
      patch();
      const once = fs.readFileSync(configFile, "utf8");
      patch();
      assert.equal(fs.readFileSync(configFile, "utf8"), once, "patch must be idempotent");
      const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, configFile);
      assert.equal(loaded.config.server.port, scenario.port, "preserve port (default 3000)");
      const server = await createServer({ root, configFile, logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, watch: null } });
      t.after(() => server.close());
      await server.listen();
      const port = server.httpServer.address().port;
      const local = await request(port, "localhost");
      assert.equal(local.status, 200);
      assert.match(local.body, /preview-host-probe/);
      const preview = await request(port, "3000.proxy.internal");
      assert.equal(preview.status, 200, preview.body);
      assert.match(preview.body, /preview-host-probe/);
      assert.equal((await request(port, "unrelated.invalid")).status, scenario.allowAll ? 200 : 403);
      if (scenario.customHost) {
        assert.equal((await request(port, "custom.example")).status, 200);
      }
      if (scenario.plugins) {
        assert.equal((await request(port, "pre.example")).status, 200);
        assert.equal((await request(port, "post.example")).status, 200);
      }
      if (scenario.name === "custom allowlist and nested settings") {
        assert.equal(server.config.server.hmr.overlay, false);
        assert.equal(server.config.server.proxy["/backend"].target, "http://127.0.0.1:4321");
        assert.equal(server.config.server.proxy["/backend"].changeOrigin, true);
      }
      if (!scenario.allowAll) {
        assert.equal(server.config.server.allowedHosts.filter((h) => h === "3000.proxy.internal").length, 1);
      }
    });
  }
}
