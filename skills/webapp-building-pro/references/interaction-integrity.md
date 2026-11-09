# Interaction Integrity (detailed rules)

> Purpose: hard interaction-integrity rules for generated web artifacts. Principle: **every control the user can see must do something** — a button or link that renders but does nothing on click is a baseline defect (dead interaction), worse than not rendering the element at all.
> Scope: websites/webapps (`--html` / `--react` deliverables).
> When generating HTML/CSS/JS, satisfy I0–I5; before delivery, do the static + visual click check at the bottom of this file (folds into the Verification flow, no extra tooling).

## I0. Every button/link must have a reachable action — the root rule

Every `<button>`, `<a>`, `[role="button"]` must have AT LEAST ONE of:

1. **A JS handler** — an `on*` attribute, an `addEventListener` binding (direct or delegated via `data-*`/class), or a framework binding (`@click` / `v-on` / `ng-click`).
2. **A real href** — `<a href>` to an existing target: full or relative URL, `mailto:` / `tel:`, or an in-page anchor that satisfies I2.
3. **Native form behavior** — `type="submit"` / `type="reset"` inside a `<form>` (note: a `<button>` outside a form has NO action even though it defaults to `submit` — that is a dead button; a no-type button inside a `<form>` does submit it).
4. **`<details>`/`<summary>`** native toggle.
5. **A pure-CSS toggle** — `label[for]` + checkbox/radio input + `:checked` rules driving visible state (checkbox hack). Legitimate and JS-free, but the `<label>` must be the clickable element and its `for`/nested input must exist.

If none applies, the element is dead: **implement the action or delete the element.** Never ship a control whose only behavior is "looks clickable".

Dead patterns to refuse while coding:

- `<button>` with no handler and no form — the #1 source of dead interactions;
- nav items / CTAs / cards / pagination / "read more" / team links rendered "for completeness" with no target;
- handlers that reference an element or id that does not exist (`querySelector` returns null → silent no-op);
- icons inside `<a>` with no href or `href="#"`.

## I1. No placeholder `href="#"` — with narrow exceptions

`<a href="#">` jumps to page top and fakes being a link — a dead interaction, unless it is one of:

- **home / brand / logo** returning to page top or site root;
- a **back-to-top** control;
- an **in-page section anchor** whose target id exists (I2).

Everything else — nav items, tabs, pagination, "more", footer links, social icons (I4) — must be a real URL or a JS-bound `<button>`. Rule of thumb: **if it is not a link to somewhere, make it a `<button>` with a handler; if you cannot name where it goes, do not render it.** For single-page deliveries, in-page anchors to real section ids are the default-correct nav pattern.

## I2. In-page anchors must point at an existing id

`href="#foo"` requires `id="foo"` in the DOM. Typos, renamed sections, and dropped ids silently kill anchors — when you rename a section, grep the old id across the whole file. The anchor must also produce a visible effect: if its target already sits inside the first viewport, add a scroll animation/scroll-margin or choose another label — a nav link that visibly does nothing reads as broken to users (and to click probes).

## I3. Hover must never be the only entry (cross-ref Mobile R5)

Dropdowns, hover cards, tooltip-only actions must also be tap/click reachable — touchscreens have no hover. Rule text lives in `references/mobile-adaptation.md` R5; it applies universally and is not repeated here.

## I4. Social / external icons: real URL or don't render

Footer/header social icons, "share" buttons, partner logos, app-store badges:

- ✅ real external URL (`https://…`) or `mailto:` / `tel:`
- ✅ or drop the element entirely
- ❌ `href="#"`, `href=""`, missing href, `javascript:void(0)`

A row of dead social icons is the most visible dead-interaction pattern in generated pages.

## I5. Full-screen overlays must be closable; non-modal full-screen covers are banned

- Modals / dialogs: at least two close paths out of {close button, Esc key, backdrop click}; focus moves into the dialog on open.
- Drawer / menu overlays: same close paths.
- Non-modal full-screen covers (splash screens, never-resolving "loaders", announcement layers) must not persistently cover the page: auto-dismiss ≤1.5s or do not exist. A permanent full-screen cover blocks every control beneath it — the whole page counts as dead interaction.

## Pre-delivery check (folds into Verification — no extra tooling)

**Static check** (grep, zero-cost) — on the built entry HTML and JS source:

```bash
# placeholder hrefs (verify each hit before "fixing": brand/logo/back-to-top and existing-id anchors are legitimate — I1)
grep -rnoE 'href="#"[^>]*>' index.html src/ dist/ 2>/dev/null
grep -rnoE 'href="javascript[^"]*"' index.html src/ dist/ 2>/dev/null

# every in-page anchor target id exists
node -e 'const f=require("fs").existsSync("dist/index.html")?"dist/index.html":"index.html";const s=require("fs").readFileSync(f,"utf8");const ids=new Set([...s.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));let bad=0;for(const m of s.matchAll(/href="#([^"]+)"/g))if(!ids.has(m[1])){console.log("dead anchor: #"+m[1]);bad++}process.exit(bad?1:0)'

# buttons without handler evidence (on* attr / submit|reset in form) — confirm each remaining one has a JS binding referencing its id|class|data-*
grep -rnoE '<button[^>]*>' index.html src/ dist/ 2>/dev/null | grep -viE 'on(click|pointer|mouse|touch)' | grep -vE 'type="(submit|reset)"'
```

Note: the greps are a heuristic first pass (a `href="#"` on the brand logo, a `<label for>` CSS toggle, or a delegated binding can all be legitimate) — the visual click check is the ground truth. For `--react` deliverables the built `dist/index.html` contains no rendered DOM (anchors live in the JS bundle), so the node anchor check is meaningful only for `--html` — rely on the visual click check there.

**Visual click check** (folds into the "interaction-integrity check" step of Verification): click the main CTA and every nav item in the real browser — each must produce an observable effect (navigation / scroll / modal / state change / form feedback). No effect → attribute to a variable (missing handler? wrong id? overlay blocking?), fix, re-click to verify.

Notes:

- **SPA / client routes** (`<a href="/pricing">` handled by a router): legitimate — the href has a real target and the router responds; do not "fix" it into `href="#"`.
- **Pure-CSS toggles** (checkbox-hack accordions/menus): legitimate, preferred for no-JS robustness; do not add redundant JS handlers.
- **Brand / current-section nav items**: a nav item pointing at the section already in view, or the logo returning to page top, is alive-by-design — covered by the I1 exceptions; don't "repair" it into something fake.
- **Primary navigation** should prefer `<a href="real-url">` enhanced by JS over JS-only buttons — the link stays alive even if the script fails.
