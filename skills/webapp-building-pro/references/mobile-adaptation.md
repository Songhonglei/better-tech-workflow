# Mobile Web Adaptation (detailed rules)

> Purpose: hard mobile-adaptation rules for generated web artifacts. Principle: **responsive by default** — desktop-first design is fine, but it must not break at 375px mobile viewport.
> Scope: websites/webapps (`--html` / `--react` deliverables). Canvas-based immersive pages (full-screen 3D scenes and the like, `--three`) are exempt — they follow their own verification flows.
> When generating HTML/CSS, satisfy R0–R6; before delivery, do the static + visual check at the bottom of this file (folds into the Verification flow, no extra tooling).

## Device-priority routing (decide before coding)

Before generating, decide whether the requirement is mobile-primary or desktop-primary:

| Signal | Examples | Route |
|---|---|---|
| **Explicit mobile** | "phone App", "mini-program", "mobile", "mobile web", "H5", "responsive", "mobile-friendly" | **Mobile-primary**: mobile-first writing (default mobile styles, `md:`/`lg:` for desktop), and mobile experience is the main goal — pre-delivery check must pass clean |
| **Implicit mobile scenario** | QR-code / food-delivery / check-in / fieldwork / photo-upload / location / social-share / push / vertical content (short video / live / chat-style UI) | **Mobile-primary** |
| **Desktop-primary scenario** | Admin dashboards / data boards / report analytics / editors / big-screen visualization / office tools / complex form workflows | **Desktop-primary**: desktop-first writing, but mobile-adaptation floor unchanged (R0 required + R2 no fixed width), same pre-delivery check |
| **Default (no signal, ~52%)** | Landing pages / official sites / general tools | **Responsive default**: mobile-first writing (Tailwind convention), same pre-delivery check |

> Note: ~52% of requirement texts have no device signal — these fall back to "responsive default" (most requirements are desktop-primary). The routing's point is **catch the explicit ones (mobile-primary), fall back the defaults (responsive)**, not 100% accuracy.
> Note: the routing differs in **writing requirements** (mobile-primary = mobile-first + mobile experience is the main goal; desktop-primary = desktop-first layout + mobile floor), **the pre-delivery check is the same for everyone** — "stricter" means writing requirements lean toward mobile experience, not a stricter check.

## R0. viewport meta — required

Every HTML page's `<head>` must have:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Without it, real-device browsers lay out at ~980px then shrink-to-fit — invisible in desktop emulators, but on real devices it's all tiny text and misalignment. This is a hard veto.

## R1. Responsive layout: mobile-first + Tailwind breakpoint convention

- **Write mobile styles by default** (single column, vertical flow at 375px), then layer desktop styles with `md:` (≥768px) / `lg:` (≥1024px) prefixes. Don't write desktop styles then patch with `max-sm:`.
- Multi-column grids: `grid-cols-1` on mobile, `md:grid-cols-2` / `lg:grid-cols-3` on desktop. Never a fixed 3+ column grid at all breakpoints.
- Flexible containers wrap: `flex flex-wrap`, mobile stacks vertically `flex-col md:flex-row`.
- Navigation: hamburger menu / drawer on mobile, `md:flex` expanded horizontal on desktop. Hover-open dropdowns must also support tap trigger (see R5).
- Large tables: wrap with `overflow-x-auto` to allow local horizontal scroll, or switch to card list on mobile.

## R2. No fixed pixel width >375px — the main cause of full-page horizontal scroll / element off-screen

No element (container, image, card, canvas) may have a fixed width exceeding the 375px mobile viewport:

- ❌ `w-[1200px]`, `min-width: 800px`, `width: 640px`, fixed two-column `grid-cols-[400px,400px]`
- ✅ `w-full`, `max-w-full`, `max-w-screen-xl mx-auto px-4` (max-width container + centered + padding)
- Desktop fixed-width container: `w-full max-w-6xl mx-auto`, not `w-[1152px]`
- Images / video / iframe / canvas: `max-w-full h-auto` (or `object-cover`), prevent content from breaking the container
- Long text / URLs / code blocks: `break-words` / `overflow-x-auto`, prevent unbroken long strings from widening the page

## R3. Font size: body text ≥14px (16px recommended), auxiliary text ≥12px

- Body, list, form, table text ≥ `text-sm` (14px), recommended 16px; auxiliary/caption text minimum 12px.
- 12px is the floor (the no-flag threshold), not a recommendation — never below 12px; 9–11px text is unreadable on mobile.
- Heading levels should be conservative on mobile: `text-3xl md:text-5xl`, not `text-6xl` on mobile too (breaks lines / overflows).

## R4. Touch targets ≥44px

- Buttons, links, icon buttons, form controls: click area width and height both ≥44px (iOS HIG; lenient floor 32px).
- Small icon buttons: use padding to reach the click area, `p-3` (icon 20px + padding to reach 44px), not just a 16px icon.
- Adjacent clickable elements: ≥8px spacing to prevent mis-taps.

## R5. Touch-friendly: hover-dependent → tap

- Any feature that depends on `:hover` to be visible/usable (dropdown menus, hover cards, key actions in tooltips) must be tap-triggered or always-visible on mobile — touchscreens have no hover.
- Hover effects may remain as desktop enhancement (`md:hover:`), but must not be the only entry point to a feature.

## R6. Notch safe-area (only when full-screen background or bottom-fixed elements are needed)

- Add `viewport-fit=cover` to viewport meta:
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- Top/bottom-fixed elements (fixed bottom bar, full-screen hero) use safe-area padding:
  `padding-bottom: env(safe-area-inset-bottom)` (Tailwind: `pb-[env(safe-area-inset-bottom)]`)

## Pre-delivery check (folds into Verification — no extra tooling)

> Route-conditional: the static grep check always applies; the visual check below is required only when routing = mobile-primary or responsive-default (desktop-primary → static grep is enough). Do not deliver with a red mobile check on the applicable route.

**Static check** (grep, zero-cost):

```bash
# viewport meta must exist in the built entry HTML
grep -o '<meta name="viewport"[^>]*>' dist/index.html   # React build
grep -o '<meta name="viewport"[^>]*>' index.html        # --html mode

# no fixed pixel widths beyond 375px on elements (token-level extraction: max-w-* containers — R2's recommended pattern — are excluded even on mixed lines)
grep -rhoE '[a-z:-]*w-\[([4-9][0-9]{2}|[0-9]{4,})px\]' src/ | grep -v 'max-w-' | grep -vE '^(sm|md|lg|xl|2xl):'
grep -rnE '(min-)?width:\s*([4-9][0-9]{2}|[0-9]{4,})px' src/ | grep -v '@media' | grep -v 'max-width'

# note: the greps are a heuristic first pass (raw CSS may still flag desktop-only rules inside multi-line @media blocks — verify context before "fixing"); the 375px visual check is the ground truth.

# no zoom lock (exception: full-screen immersive pages may use it intentionally)
grep -rn 'user-scalable=no\|maximum-scale=1' dist/index.html index.html src/
```

**Visual check** (mobile-viewport screenshot from Verification step 2 — 375px wide, real device semantics — required only when routing = mobile-primary or responsive-default; desktop-primary → the static greps above are enough): look at it yourself and confirm —

- No full-page horizontal scroll (page does not scroll sideways; no horizontal scrollbar)
- No element sticking off-screen (cards / images / buttons cut off at the right edge)
- Text readable without zooming (nothing below 12px)
- Controls tappable (buttons/links not cramped together, not tiny)

Any defect → attribute to a variable (which element, which class), fix, re-shoot to verify.

Notes:

- **Immersive full-screen pages** may intentionally use `user-scalable=no` / `maximum-scale=1` to prevent accidental pinch-zoom breaking the experience — intentional design, not a defect; normal web pages still forbid it.
- Don't hide the entire desktop layout with `hidden md:block` to fake responsiveness — a mobile view that drops half the content is a defect, not adaptation.
