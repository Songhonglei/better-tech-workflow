# references/website-design.md — Website design specifics

## Aesthetic direction lock (mandatory every time)

- Before writing code, describe the vibe in one sentence, then expand it into: font pairing (contrast along the serif+sans axis — never pair two similar sans-serifs), color stance (primary + accent 70-20-10), layout stance (asymmetric/editorial/brutal-minimal/luxury/retro-futuristic…), motion ideas, 1 signature detail.
- Re-derive it from the context of each task; don't look the same as your last output — swapping in a different set of stereotypical "premium" defaults (Space Grotesk and the like) is still defaults.

## Complete anti-slop ban list

- Fonts: Inter/Roboto/Arial/system default fonts; use paired fonts with character.
- Gradients: no purple-blue gradients, no `bg-clip-text` gradient text.
- Icons: no emoji — use SVG such as Lucide/Heroicons.
- Layout: no centered-symmetric default layouts, no cookie-cutter card grids, no nested cards (cards are the lazy answer).
- Components: no uncustomized shadcn/MUI/Bootstrap default themes.
- Scaffolding: no lowercase eyebrow kicker on every section, no 01/02/03 numbering, no side >1px border-left color bars, no glassmorphism abuse, no hero-metric templates, no headings overflowing their containers.
- Backgrounds: cream/beige backgrounds are a saturated AI default; "warmth" is carried by accent + fonts + imagery, not by a beige background.
- Content: no "John Doe"/"Acme"/99.9% fake data, no Unsplash links, no "Elevate/Seamless/Unleash" copy tone; button copy starts with a verb.

## Color / typography

- Write colors in OKLCH; three-tier tokens: primitive (palette) → semantic (surface/text/accent) → component (button/card).
- Give neutrals 0.005–0.015 chroma leaning toward the brand color; dark/light theme is not a default — first write one sentence about "who uses it under what ambient light", then choose.
- Headings 1.1–1.3 line-height, display cap clamp ≤6rem, letter-spacing ≥ -0.04em, h1–h3 `text-wrap: balance`; type scale at 1.25 ratio; tabular-nums for numbers.
- Body text 65–75ch, ≥16px, line-height 1.5–1.75 (mobile floor: body ≥14px, auxiliary ≥12px — see `references/mobile-adaptation.md` R3).

## Motion (Kowalski decision order)

Should it move at all (keyboard operations performed 100+ times/day never animate) → purpose (spatial continuity/state indication/feedback) → easing → duration.

- Button press 100–160ms; entrances ease-out, on-screen movement ease-in-out; no ease-in, no bounce/elastic abuse; recommended curve `cubic-bezier(0.23,1,0.32,1)`.
- Animate only transform/opacity (properties that trigger layout/paint are banned); popovers scale from their trigger point (centered modals excepted); stagger 30–80ms; exit = 60–70% of entrance duration.
- grain/noise layers only on a `fixed pointer-events-none` pseudo-element.

## Layout / engineering

- Overlapping elements via `grid-area: 1/1` instead of absolute; breakpoint-free responsive grids `repeat(auto-fit, minmax(280px,1fr))`.
- Semantic z-index tiers (sticky=10/dropdown=20/overlay=30/modal=40/toast=50).
- Forms: visible labels (not placeholders posing as labels), errors shown nearby + in plain language + with a recovery path; touch targets ≥44×44; images declare width/height to prevent CLS, fonts `font-display: swap`.
- **No horizontal scrolling on mobile** — test all of 375/768/1024/1440 breakpoints. Coverage: 375px is checked by the mobile pre-delivery check (static grep + mobile-viewport screenshot, see `references/mobile-adaptation.md`); 768/1024/1440 are covered by the desktop-viewport screenshot in Verification (desktop + mobile viewports) — mobile-specific defects are checked at 375px, desktop breakpoints are visually verified.

## 3D effects on pages (Three.js hero/section scenes)

- **Technique ladder first**: DOM/CSS → 2.5D camera-facing planes → full 3D — pick the least complex option that preserves the requested depth; a full model with controls is overkill for decorative depth behind copy.
- **Content stays in the DOM**: headings, copy, CTA, labels, legends remain semantic HTML (the canvas decorates or spatially illustrates them); decorative canvases get `aria-hidden` + `pointer-events:none`; interactive 3D targets need a named DOM/keyboard/touch alternative.
- **Never a black canvas**: ship a static poster/CSS composition that shows before the first GPU frame and on WebGL/shader/asset failure; the CTA never hides behind a loader.
- **Scroll choreography**: GSAP/ScrollTrigger when motion has a designed timeline — one bounded progress value drives camera + shader + DOM (no competing wheel listeners/timelines); refresh after layout settles, kill timelines on teardown, branch for `prefers-reduced-motion`, recompose (not just shrink) on mobile.
- **Custom-shader discipline**: a flat-color/UV control renders first, then one effect at a time; uniforms small, named, bounded; document coordinate spaces; on compile failure reveal the fallback, don't leave a dead canvas.
- **Housekeeping**: one renderer, one animation scheduler per page; pause when the tab is hidden; dispose geometries/materials/render targets/listeners on teardown.

## Auditing / rewriting existing projects

1. Discover: read all real files (never judge from the prompt alone; for multi-page projects read every page).
2. Render and screenshot whenever possible; mark confidence separately for code-determined vs visually inferred findings.
3. Go through the principle checklist item by item: location + severity + one line of "why it looks AI".
4. When fixing, preserve functionality/props/routing/data flow; don't silently add dependencies.
5. **Re-review**: hunt specifically for new problems introduced by the fixes (ARIA added without corresponding visual styles, tokens leaking hardcoded values, visual balance shifted) — a re-review usually catches 3–8 more.
