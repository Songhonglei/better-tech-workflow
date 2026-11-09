#!/bin/bash
set -euo pipefail
trap 'echo ""; echo "ERROR: backend-building init failed (exit code $?). Project files are preserved; inspect the error and git diff before retrying."' ERR

# ── Backend Building Init (Feature-Based) ──────────────────────
# Grafts backend infrastructure onto an existing webapp-building
# frontend. Supports incremental feature installation via
# --features flag. Tracks installed features in .backend-features.json.
# ─────────────────────────────────────────────────────────────────

PROJECT_PATH=${PROJECT_PATH:-"$PWD/app"}
APP_TITLE=""
FEATURES_ARG=""
TEMPLATE_MODE=false
LOCAL_MODE=false

# ── Parse arguments ─────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      LOCAL_MODE=true
      shift
      ;;
    --features)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || { echo "Error: --features requires db or auth"; exit 1; }
      FEATURES_ARG="$2"
      shift 2
      ;;
    --template)
      TEMPLATE_MODE=true
      shift
      ;;
    -h|--help)
      echo "Usage: PROJECT_PATH=<project> bash $0 <title> [--local] [--features db|auth] [--template]"
      exit 0
      ;;
    --*) echo "Error: unknown option $1"; exit 1 ;;
    *)
      [[ -z "$APP_TITLE" ]] || { echo "Error: unexpected argument $1"; exit 1; }
      APP_TITLE="$1"
      shift
      ;;
  esac
done

if [[ -z "$APP_TITLE" ]]; then
  echo "Usage: $0 <app-title> [--features feat1,feat2,...] [--template]"
  echo "Example: $0 \"My App\" --features db,auth"
  echo "Example: $0 \"My App\" --template   # fullstack template — reads features from .backend-features.json"
  echo ""
  echo "Features: db, auth (default: auth)"
  echo "  db   — Drizzle ORM + MySQL"
  echo "  auth — Kimi OAuth + user management (includes db)"
  echo ""
  echo "--template mode: skips file scaffolding (files are already laid out by the"
  echo "  fullstack template zip), reads features from \$PROJECT_PATH/.backend-features.json,"
  echo "  and calls portal + writes .env to provision db/auth/ai. Do not combine with --features."
  exit 1
fi

if [[ "$TEMPLATE_MODE" == true && -n "$FEATURES_ARG" ]]; then
  echo "Error: --template and --features are mutually exclusive."
  echo "In --template mode, features are read from .backend-features.json shipped in the template."
  exit 1
fi

DIR_SCRIPTS=$(cd "$(dirname "$0")" && pwd)
TMPL="$DIR_SCRIPTS/template"
LIB="$DIR_SCRIPTS/lib"
MANIFEST="$PROJECT_PATH/.backend-features.json"

# ── Feature resolution ──────────────────────────────────────────

resolve_features() {
  local input="$1"
  local resolved=()

  IFS=',' read -ra feats <<< "$input"
  for f in "${feats[@]}"; do
    f=$(echo "$f" | xargs)  # trim whitespace
    case "$f" in
      auth)
        [[ " ${resolved[*]:-} " != *" db "* ]] && resolved+=(db)
        [[ " ${resolved[*]:-} " != *" auth "* ]] && resolved+=(auth)
        ;;
      db)
        [[ " ${resolved[*]:-} " != *" db "* ]] && resolved+=(db)
        ;;
      *)
        echo "Error: Unknown feature '$f'. Available: db, auth"
        exit 1
        ;;
    esac
  done

  echo "${resolved[*]}"
}

# Default features (skipped in --template mode; features come from the manifest shipped in the template)
if [[ "$TEMPLATE_MODE" != true ]]; then
  if [[ -z "$FEATURES_ARG" ]]; then
    if [[ "$LOCAL_MODE" == true ]]; then FEATURES_ARG="db"; else FEATURES_ARG="auth"; fi
  fi
  RESOLVED_FEATURES=($(resolve_features "$FEATURES_ARG"))
else
  # In --template mode RESOLVED_FEATURES is populated from the manifest later,
  # after validation of $MANIFEST existence. Leave empty for now.
  RESOLVED_FEATURES=()
fi

# ── Step 1: Validate ────────────────────────────────────────────

if ! command -v npm &>/dev/null; then
  echo "Error: npm not found"
  exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Error: $PROJECT_PATH does not exist. Run webapp-building init first."
  exit 1
fi

if [[ ! -d "$PROJECT_PATH/src" ]]; then
  echo "Error: $PROJECT_PATH/src not found. Run webapp-building init first."
  exit 1
fi

# Validate the React shell before changing files or contacting Portal.
for required in package.json vite.config.ts tsconfig.json src/main.tsx src/App.tsx; do
  [[ -f "$PROJECT_PATH/$required" ]] || { echo "Error: React backend graft requires $required; this template must be adapted first."; exit 1; }
done
if [[ "$LOCAL_MODE" == true && ( "$TEMPLATE_MODE" == true || " ${RESOLVED_FEATURES[*]} " == *" auth "* ) ]]; then
  echo "Error: --local supports db only; Kimi auth/template provisioning requires Portal."
  exit 1
fi
# Git history is managed by the caller; never change global config or auto-commit user files.

# ── Read or detect manifest ─────────────────────────────────────

INSTALLED_FEATURES=()
HAS_MANIFEST=false
IS_FIRST_RUN=true
APP_ID_FROM_MANIFEST=""

if [[ "$TEMPLATE_MODE" == true ]]; then
  if [[ ! -f "$MANIFEST" ]]; then
    echo "Error: --template mode requires $MANIFEST."
    echo "This file should be shipped inside the fullstack template zip at the project root."
    exit 1
  fi
  HAS_MANIFEST=true
  IS_FIRST_RUN=false
  INSTALLED_FEATURES=($(node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    process.stdout.write((m.features||[]).join(' '));
  " "$MANIFEST"))
  if [[ ${#INSTALLED_FEATURES[@]} -eq 0 ]]; then
    echo "Error: $MANIFEST has an empty features array; nothing to provision."
    exit 1
  fi
  APP_ID_FROM_MANIFEST=$(node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    process.stdout.write(m.app_id||'');
  " "$MANIFEST")
  # Features from the template manifest are the authoritative list.
  RESOLVED_FEATURES=("${INSTALLED_FEATURES[@]}")
elif [[ -f "$MANIFEST" ]]; then
  HAS_MANIFEST=true
  IS_FIRST_RUN=false
  INSTALLED_FEATURES=($(node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    process.stdout.write((m.features||[]).join(' '));
  " "$MANIFEST"))
  APP_ID_FROM_MANIFEST=$(node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    process.stdout.write(m.app_id||'');
  " "$MANIFEST")
elif [[ -d "$PROJECT_PATH/api" ]]; then
  # Legacy app detection — no manifest but api/ exists
  IS_FIRST_RUN=false
  echo "Detected legacy backend (no manifest). Probing installed features..."

  if [[ -f "$PROJECT_PATH/db/schema.ts" ]] && [[ -f "$PROJECT_PATH/drizzle.config.ts" ]]; then
    INSTALLED_FEATURES+=(db)
  fi
  if [[ -d "$PROJECT_PATH/api/kimi" ]]; then
    INSTALLED_FEATURES+=(auth)
  fi
  # Read APP_ID from existing .env
  if [[ -f "$PROJECT_PATH/.env" ]]; then
    APP_ID_FROM_MANIFEST=$(grep -E '^APP_ID=' "$PROJECT_PATH/.env" | head -1 | cut -d= -f2- || true)
  fi

  echo "  Detected features: ${INSTALLED_FEATURES[*]:-base only}"

  # Write retroactive manifest
  local_features_json=$(printf '%s\n' "${INSTALLED_FEATURES[@]:-}" | node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
    process.stdout.write(JSON.stringify(lines));
  ")
  python3 -c 'import json,sys,datetime; from pathlib import Path; Path(sys.argv[1]).write_text(json.dumps({"version":1,"features":json.loads(sys.argv[2]),"app_id":sys.argv[3],"initialized_at":datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+"\n")' "$MANIFEST" "$local_features_json" "$APP_ID_FROM_MANIFEST"
  HAS_MANIFEST=true
  echo "  Created .backend-features.json"
fi

# ── Compute new features ────────────────────────────────────────

NEW_FEATURES=()
if [[ "$TEMPLATE_MODE" == true ]]; then
  # In --template mode all features from the manifest need portal provisioning
  # (the files are already on disk but the app hasn't been registered yet).
  RESOLVED_FEATURES=($(resolve_features "$(IFS=,; echo "${INSTALLED_FEATURES[*]}")"))
  NEW_FEATURES=("${RESOLVED_FEATURES[@]}")
else
  for f in "${RESOLVED_FEATURES[@]}"; do
    if [[ " ${INSTALLED_FEATURES[*]:-} " != *" $f "* ]]; then
      NEW_FEATURES+=("$f")
    fi
  done

  if [[ "$IS_FIRST_RUN" == false ]] && [[ ${#NEW_FEATURES[@]} -eq 0 ]]; then
    echo "All requested features already installed: ${RESOLVED_FEATURES[*]}"
    exit 0
  fi
fi

echo "Grafting backend onto: $PROJECT_PATH"
if [[ "$TEMPLATE_MODE" == true ]]; then
  echo "  Template mode — provisioning only (files already laid out): ${RESOLVED_FEATURES[*]}"
elif [[ "$IS_FIRST_RUN" == true ]]; then
  echo "  First run — installing base infrastructure + features: ${RESOLVED_FEATURES[*]}"
else
  echo "  Adding features: ${NEW_FEATURES[*]}"
fi

ALL_FEATURES=("${INSTALLED_FEATURES[@]:-}" "${NEW_FEATURES[@]}")

# Build JSON features array: ["db","auth"]
FEATURES_JSON=$(printf '%s\n' "${ALL_FEATURES[@]}" | sort -u | node -e "
  const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
  process.stdout.write(JSON.stringify(lines));
")

if [[ "$LOCAL_MODE" != true && ${#NEW_FEATURES[@]} -gt 0 ]]; then
  PORTAL_URL="${PORTAL_URL:-http://localhost:8080/api/v1/apps}"
  PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"features":json.loads(sys.argv[2])}))' "$APP_TITLE" "$FEATURES_JSON")
  APP_INFO=$(curl --connect-timeout 5 --max-time 30 -sf -X POST "$PORTAL_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD") || {
    echo "Error: Failed to reach portal at $PORTAL_URL"
    exit 1
  }

  # Parse response: { app_id, app_secret, credentials: { KEY: "value", ... } }
  APP_ID=$(echo "$APP_INFO" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).app_id||'')")
  APP_SECRET=$(echo "$APP_INFO" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).app_secret||'')")

  if [[ -z "$APP_ID" || -z "$APP_SECRET" ]]; then
    echo "Error: Portal returned invalid response (missing app_id or app_secret)"
    exit 1
  fi

  # Extract credentials as KEY=VALUE lines
  CRED_LINES=$(echo "$APP_INFO" | node -e "
    const info = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    for (const [k, v] of Object.entries(info.credentials || {})) {
      process.stdout.write(k + '=' + v + '\n');
    }
  ")

fi

# ── safe_copy: skip if destination exists ────────────────────────
SKIPPED_FILES=()
SKIPPED_DESCRIPTIONS=()

safe_copy() {
  local src="$1"
  local dst="$2"
  local desc="${3:-}"
  if [[ -f "$dst" ]]; then
    SKIPPED_FILES+=("$dst")
    SKIPPED_DESCRIPTIONS+=("$desc")
  else
    cp "$src" "$dst"
  fi
}

# ── Install base infrastructure (first run only; skipped in --template mode) ──

if [[ "$TEMPLATE_MODE" != true && "$IS_FIRST_RUN" == true ]]; then
  echo ""
  echo "Installing base infrastructure..."

  # Copy base api/
  cp -r "$TMPL/base/api" "$PROJECT_PATH/api"

  # Copy base contracts/
  cp -r "$TMPL/base/contracts" "$PROJECT_PATH/contracts"

  # Copy base configs
  safe_copy "$TMPL/base/configs/vitest.config.ts" "$PROJECT_PATH/vitest.config.ts" \
    "Should configure vitest with @contracts alias and api test includes"
  cp -n "$TMPL/base/configs/.prettierrc"     "$PROJECT_PATH/.prettierrc"     2>/dev/null || true
  cp -n "$TMPL/base/configs/.prettierignore" "$PROJECT_PATH/.prettierignore" 2>/dev/null || true
  cp -n "$TMPL/base/configs/.dockerignore"   "$PROJECT_PATH/.dockerignore"   2>/dev/null || true

  # Append .gitignore entries (deduplicated)
  if [[ -f "$PROJECT_PATH/.gitignore" ]]; then
    while IFS= read -r line; do
      if [[ -n "$line" ]] && ! grep -qxF "$line" "$PROJECT_PATH/.gitignore"; then
        echo "$line" >> "$PROJECT_PATH/.gitignore"
      fi
    done < "$TMPL/base/configs/.gitignore"
  else
    cp "$TMPL/base/configs/.gitignore" "$PROJECT_PATH/.gitignore"
  fi

  # Copy base .env.example
  cp "$TMPL/base/.env.example" "$PROJECT_PATH/.env.example"

  # Patch vite.config.ts for backend
  node "$LIB/patch-vite-config.mjs" "$PROJECT_PATH" || {
    echo "  WARNING: in-place patch failed — falling back to full replacement"
    cat >"$PROJECT_PATH/vite.config.ts" <<'VITEEOF'
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import devServer from "@hono/vite-dev-server"

const __dirname = import.meta.dirname

export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
    },
  },
  server: {
    port: 3000,
    allowedHosts: true,
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
VITEEOF
    echo "  Replaced vite.config.ts (full fallback)"
  }

  # Merge tsconfig
  cp "$TMPL/base/configs/tsconfig.server.json" "$PROJECT_PATH/tsconfig.server.json"
  node "$LIB/merge-tsconfig.mjs" "$PROJECT_PATH"

  # Merge base package.json
  node "$LIB/merge-package-json.mjs" "$PROJECT_PATH" "$TMPL/base/configs/package.json.feat"

  # Copy tRPC client provider (fundamental to all backend apps)
  mkdir -p "$PROJECT_PATH/src/providers"
  cp "$TMPL/base/client-patches/providers/trpc.tsx" "$PROJECT_PATH/src/providers/trpc.tsx"

  # Copy the browser logger (imported by trpc.tsx): routes frontend logs to
  # /api/log so they land in /tmp/kimi-logs/app.log alongside server logs.
  # safe_copy (not bare cp): a project may already have its own src/lib/logger.ts,
  # and silently replacing it would swap the implementation under every existing
  # import. On skip, trpc.tsx's side-effect import resolves to the project's own
  # module — the app still compiles, but browser error capture via /api/log stays
  # off, so say so in the skip notice.
  mkdir -p "$PROJECT_PATH/src/lib"
  safe_copy "$TMPL/base/client-patches/lib/logger.ts" "$PROJECT_PATH/src/lib/logger.ts" \
    "src/lib/logger.ts already exists — skipped; browser error capture via /api/log will not be active for this project"
fi

# ── Install features ────────────────────────────────────────────

NEED_CREATE_DATABASE=false

install_db() {
  echo ""
  echo "Installing feature: db"

  # Create db/ directory if not exists
  mkdir -p "$PROJECT_PATH/db"

  # Copy db template files
  safe_copy "$TMPL/db/db/schema.ts" "$PROJECT_PATH/db/schema.ts" \
    "Database schema file"
  cp -n "$TMPL/db/db/relations.ts" "$PROJECT_PATH/db/relations.ts" 2>/dev/null || true
  safe_copy "$TMPL/db/db/seed.ts" "$PROJECT_PATH/db/seed.ts" \
    "Database seed script"
  mkdir -p "$PROJECT_PATH/db/migrations"
  touch "$PROJECT_PATH/db/migrations/.gitkeep"

  # Copy connection query
  mkdir -p "$PROJECT_PATH/api/queries"
  safe_copy "$TMPL/db/api/queries/connection.ts" "$PROJECT_PATH/api/queries/connection.ts" \
    "Database connection singleton"

  # Copy drizzle config
  safe_copy "$TMPL/db/configs/drizzle.config.ts" "$PROJECT_PATH/drizzle.config.ts" \
    "Drizzle ORM config"

  # Patch env.ts to add databaseUrl
  node "$LIB/patch-env-ts.mjs" "$PROJECT_PATH" '{"databaseUrl":"required(\"DATABASE_URL\")"}'

  # Append db env vars to .env.example
  if [[ -f "$PROJECT_PATH/.env.example" ]] && ! grep -q 'DATABASE_URL' "$PROJECT_PATH/.env.example"; then
    echo "" >> "$PROJECT_PATH/.env.example"
    cat "$TMPL/db/.env.example" >> "$PROJECT_PATH/.env.example"
  fi

  # Merge db package.json.feat
  node "$LIB/merge-package-json.mjs" "$PROJECT_PATH" "$TMPL/db/configs/package.json.feat"

  NEED_CREATE_DATABASE=true
}

install_auth() {
  echo ""
  echo "Installing feature: auth"

  # Replace context.ts and middleware.ts (auth versions are strict supersets)
  cp "$TMPL/auth/api/context.ts" "$PROJECT_PATH/api/context.ts"
  cp "$TMPL/auth/api/middleware.ts" "$PROJECT_PATH/api/middleware.ts"

  # Copy auth-router.ts
  cp "$TMPL/auth/api/auth-router.ts" "$PROJECT_PATH/api/auth-router.ts"

  # Copy kimi/ directory
  cp -r "$TMPL/auth/api/kimi" "$PROJECT_PATH/api/kimi"

  # Copy cookies.ts
  cp "$TMPL/auth/api/lib/cookies.ts" "$PROJECT_PATH/api/lib/cookies.ts"

  # Copy users query
  mkdir -p "$PROJECT_PATH/api/queries"
  cp "$TMPL/auth/api/queries/users.ts" "$PROJECT_PATH/api/queries/users.ts"

  # Merge users table into db/schema.ts
  node "$LIB/merge-schema.mjs" "$PROJECT_PATH" "$TMPL/auth/db/schema.users.ts"

  # Copy contracts
  cp "$TMPL/auth/contracts/constants.ts" "$PROJECT_PATH/contracts/constants.ts"
  # Replace types.ts with auth version (re-exports db/schema + errors)
  cp "$TMPL/auth/contracts/types.ts" "$PROJECT_PATH/contracts/types.ts"

  # Patch router.ts to add auth sub-router
  node "$LIB/patch-router-auth.mjs" "$PROJECT_PATH"

  # Patch boot.ts to add OAuth callback
  node "$LIB/patch-boot-auth.mjs" "$PROJECT_PATH"

  # Patch env.ts to add auth env vars
  node "$LIB/patch-env-ts.mjs" "$PROJECT_PATH" '{"kimiAuthUrl":"required(\"KIMI_AUTH_URL\")","kimiOpenUrl":"required(\"KIMI_OPEN_URL\")","ownerUnionId":"process.env.OWNER_UNION_ID ?? \"\""}'

  # Append auth env vars to .env.example
  if [[ -f "$PROJECT_PATH/.env.example" ]] && ! grep -q 'KIMI_AUTH_URL' "$PROJECT_PATH/.env.example"; then
    echo "" >> "$PROJECT_PATH/.env.example"
    cat "$TMPL/auth/.env.example" >> "$PROJECT_PATH/.env.example"
  fi

  # Merge auth package.json.feat
  node "$LIB/merge-package-json.mjs" "$PROJECT_PATH" "$TMPL/auth/configs/package.json.feat"

  # Apply client patches
  mkdir -p "$PROJECT_PATH/src/hooks"
  mkdir -p "$PROJECT_PATH/src/pages"
  mkdir -p "$PROJECT_PATH/src/components"

  cp "$TMPL/auth/client-patches/hooks/useAuth.ts"   "$PROJECT_PATH/src/hooks/useAuth.ts"
  safe_copy "$TMPL/auth/client-patches/pages/Login.tsx" "$PROJECT_PATH/src/pages/Login.tsx" \
    "Should render the OAuth login page (import LOGIN_PATH from @/const)"
  cp -n "$TMPL/auth/client-patches/pages/NotFound.tsx" "$PROJECT_PATH/src/pages/NotFound.tsx" 2>/dev/null || true

  # Merge LOGIN_PATH into existing const.ts (or copy fresh)
  if [[ ! -f "$PROJECT_PATH/src/const.ts" ]]; then
    cp "$TMPL/auth/client-patches/const.ts" "$PROJECT_PATH/src/const.ts"
  elif ! grep -q 'LOGIN_PATH' "$PROJECT_PATH/src/const.ts"; then
    echo "" >> "$PROJECT_PATH/src/const.ts"
    cat "$TMPL/auth/client-patches/const.ts" >> "$PROJECT_PATH/src/const.ts"
  fi

  safe_copy "$TMPL/auth/client-patches/components/AuthLayout.tsx" \
    "$PROJECT_PATH/src/components/AuthLayout.tsx" \
    "Should provide authenticated sidebar layout (wraps pages that need auth)"
  safe_copy "$TMPL/auth/client-patches/components/AuthLayoutSkeleton.tsx" \
    "$PROJECT_PATH/src/components/AuthLayoutSkeleton.tsx" \
    "Loading skeleton for AuthLayout"
}

# Run feature installers in dependency order (skipped in --template mode; files already present)
if [[ "$TEMPLATE_MODE" != true ]]; then
  for feature in "${NEW_FEATURES[@]}"; do
    case "$feature" in
      db)   install_db ;;
      auth) install_auth ;;
    esac
  done
fi

# ── Portal credentials → .env ───────────────────────────────────
# In --template mode INSTALLED_FEATURES and NEW_FEATURES are the same set, so
# we dedupe via sort -u below to avoid duplicate entries in FEATURES_JSON.

if [[ "$LOCAL_MODE" != true && ${#NEW_FEATURES[@]} -gt 0 ]]; then
  # Build .env — base vars, derived frontend vars, then feature credentials
  {
    echo "APP_ID=$APP_ID"
    echo "APP_SECRET=$APP_SECRET"
    echo ""

    # Derived frontend vars (not from portal — Vite needs these prefixed)
    echo "VITE_APP_ID=$APP_ID"
    KIMI_AUTH_URL=$(echo "$CRED_LINES" | grep '^KIMI_AUTH_URL=' | cut -d= -f2- || true)
    if [[ -n "$KIMI_AUTH_URL" ]]; then
      echo "VITE_KIMI_AUTH_URL=$KIMI_AUTH_URL"
    fi

    # All feature credentials from portal
    if [[ -n "$CRED_LINES" ]]; then
      echo ""
      echo "$CRED_LINES"
    fi
  } | python3 -c '
import os,sys,tempfile
from pathlib import Path
p=Path(sys.argv[1]); incoming=sys.stdin.read().splitlines()
updates={line.split("=",1)[0]:line for line in incoming if "=" in line and not line.startswith("#")}
old=p.read_text().splitlines() if p.exists() else []
lines=[]
for line in old:
 key=line.split("=",1)[0] if "=" in line and not line.startswith("#") else None
 if key in updates: lines.append(updates.pop(key))
 else: lines.append(line)
lines.extend(updates.values())
with tempfile.NamedTemporaryFile(mode="w",dir=p.parent,delete=False) as f:
 f.write("\n".join(lines)+"\n"); tmp=f.name
os.replace(tmp,p)
' "$PROJECT_PATH/.env"

  APP_ID_FROM_MANIFEST="$APP_ID"
fi

# ── Install dependencies ─────────────────────────────────────────

echo ""
echo "Installing dependencies..."
# Runtime dependencies are installed in the generated project, never in the Skill.
cd "$PROJECT_PATH"
npm install --prefer-offline --silent

# ── Auto-wire (skipped in --template mode; wiring is pre-baked into the template) ──

WIRING_TODO=()

if [[ "$TEMPLATE_MODE" != true ]]; then
  if [[ "$IS_FIRST_RUN" == true ]]; then
    node "$LIB/wire-main-tsx.mjs" "$PROJECT_PATH" 2>/dev/null \
      || WIRING_TODO+=("Wrap content inside <BrowserRouter> with <TRPCProvider> in src/main.tsx (import from @/providers/trpc)")
  fi

  if [[ " ${NEW_FEATURES[*]} " == *" auth "* ]]; then
    node "$LIB/wire-app-tsx.mjs" "$PROJECT_PATH" 2>/dev/null \
      || WIRING_TODO+=("Add <Route path=\"/login\" element={<Login />} /> and <Route path=\"*\" element={<NotFound />} /> to src/App.tsx")
  fi
fi

# Browser log capture is NOT part of that block on purpose: it must hold in
# template mode too, and in every run — not just the first. Depending on
# TRPCProvider being wired (the previous arrangement, via providers/trpc.tsx's
# side-effect import) meant three silent ways for browser errors to never reach
# app.log. This step is idempotent and unconditional; it only needs main.tsx.
node "$LIB/wire-client-logger.mjs" "$PROJECT_PATH" 2>/dev/null \
  || WIRING_TODO+=("Register the browser logger in src/main.tsx (add import \"@/lib/logger\")")

# ── Write/update manifest ───────────────────────────────────────

all_features_json=$(printf '%s\n' "${ALL_FEATURES[@]}" | sort -u | node -e "
  const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
  process.stdout.write(JSON.stringify(lines));
")

python3 -c 'import json,sys,datetime; from pathlib import Path; Path(sys.argv[1]).write_text(json.dumps({"version":1,"features":json.loads(sys.argv[2]),"app_id":sys.argv[3],"initialized_at":datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+"\n")' "$MANIFEST" "$all_features_json" "$APP_ID_FROM_MANIFEST"

# Local development uses the user's MySQL connection; never invent working credentials.
if [[ "$LOCAL_MODE" == true && ! -f "$PROJECT_PATH/.env" ]]; then
  cp "$PROJECT_PATH/.env.example" "$PROJECT_PATH/.env"
  chmod 600 "$PROJECT_PATH/.env"
  echo "Local scaffold ready. Fill APP_ID, APP_SECRET and DATABASE_URL in .env before production/database use."
fi

# ── Summary ──────────────────────────────────────────────────────

echo ""
if [[ "$TEMPLATE_MODE" == true ]]; then
  echo "Backend provisioned (fullstack template mode): $APP_TITLE"
  echo "  app_id:   $APP_ID_FROM_MANIFEST"
  echo "  features: ${RESOLVED_FEATURES[*]}"
  echo "  .env:     written with portal credentials"
else
  echo "Backend grafted: $APP_TITLE"
fi
echo ""

if [[ "$TEMPLATE_MODE" != true && "$IS_FIRST_RUN" == true ]]; then
  echo "Base infrastructure:"
  echo "  api/                    Hono + tRPC API"
  echo "  contracts/              Shared types (frontend ↔ backend)"
  echo "  src/providers/trpc.tsx  tRPC client + TRPCProvider"
fi

if [[ "$TEMPLATE_MODE" != true ]]; then
  for feature in "${NEW_FEATURES[@]}"; do
    echo ""
    case "$feature" in
      db)
        echo "Feature [db]:"
        echo "  db/                     Database schema & migrations"
        echo "  api/queries/            Database connection"
        echo "  drizzle.config.ts       Drizzle ORM config"
        ;;
      auth)
        echo "Feature [auth]:"
        echo "  api/kimi/               Kimi OAuth SDK"
        echo "  api/auth-router.ts      Auth tRPC router"
        echo "  src/hooks/useAuth.ts    Auth hook"
        echo "  src/pages/              Login, NotFound"
        echo "  src/components/         AuthLayout"
        ;;
    esac
  done
fi

if [[ ${#SKIPPED_FILES[@]} -gt 0 ]]; then
  echo ""
  echo "Skipped (already exist):"
  for i in "${!SKIPPED_FILES[@]}"; do
    file="${SKIPPED_FILES[$i]}"
    desc="${SKIPPED_DESCRIPTIONS[$i]}"
    rel="${file#"$PROJECT_PATH"/}"
    echo "  - $rel"
    if [[ -n "$desc" ]]; then
      echo "    → $desc"
    fi
  done
  echo "  Review these files and add missing backend features."
fi

if [[ ${#WIRING_TODO[@]} -gt 0 ]]; then
  echo ""
  echo "Wiring required:"
  for i in "${!WIRING_TODO[@]}"; do
    echo "  $((i+1)). ${WIRING_TODO[$i]}"
  done
  echo "  See docs/Post-Init-Wiring.md for details."
elif [[ " ${NEW_FEATURES[*]} " == *" auth "* ]]; then
  echo ""
  echo "Auto-wired: tRPC providers and routes are ready."
fi
echo ""
