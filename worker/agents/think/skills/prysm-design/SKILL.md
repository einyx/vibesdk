---
name: prysm-design
description: "Apply the Prysm design system (prysm.sh) to any web UI — warm dark canvas, off-white ink, hairline borders, a single terracotta accent, Inter + DM Mono. Use this skill when the user mentions Prysm, prysm.sh, or asks for the platform's look, or builds consoles, dashboards, admin panels, todo/utility apps or landing pages meant to feel like the prysm.sh family. Produces calm, precise, typographic interfaces: a warm dark canvas, hairline structure, machine-faces for data, and one restrained accent."
---

Build the interface in the **Prysm design system**. One rule above all: the
page is a warm dark canvas, one off-white, hairline borders. There is no
chromatic accent in the interface — the brand mark carries the colour, not
the UI. Type does the rest: Inter (or system-ui when unavailable) for
narrative, a monospace face for anything a machine would read.

## Tokens (paste as CSS custom properties, use them everywhere)

```css
:root {
  color-scheme: dark;
  /* Surfaces. The canvas is warm, never neutral grey. */
  --canvas: #2b2622;
  --canvas-soft: #383330;
  --canvas-raised: #322d29;
  --hairline: #3f3a36;
  --hairline-strong: #4d4741;
  /* Ink. Off-white is the default; the rest are steps down. */
  --ink: #f7f5f0;
  --body: #c9c0ad;
  --body-strong: #dad2c1;
  --mute: #aea69c;
  /* The one chromatic colour: the brand mark. Lightened for 4.5:1 on the canvas. */
  --mark: #e0705a;
  --radius: 4px;
  --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

Map these onto whatever theming layer the stack uses (Tailwind config,
CSS variables, styled tokens). Components reference tokens, never raw hex.

## The rules

1. **Warm dark only.** No light theme, no pure black, no neutral greys.
2. **Terracotta (#e0705a) appears only in:** the brand mark, a "wordmark
   dot" after a lowercase name, eyebrow status dots, and states that need
   attention (a `degraded` service). Never as a button, link, or
   background fill.
3. **Type.** Narrative text: `--sans`, weight 400–500, tight tracking on
   headings (-1.2px to -1.6px). Anything a machine would read — labels,
   table cells, code, timestamps, eyebrow labels — uses `--mono`. Body
   narrative is `#c9c0ad`; emphasised text `#dad2c1`; labels `#aea69c`.
4. **Eyebrows.** Every section opens with a mono uppercase label
   (11px, 0.14em letter-spacing, mute colour), optionally preceded by a
   6px dot in the mark colour.
5. **Buttons are inverted ink:** off-white face, canvas text, 3px radius.
   No coloured buttons. Secondary actions are quiet text links with an
   arrow character (→ or ↗), not icons.
6. **Structure over decoration.** Section separators are 1px hairlines.
   Feature lists use mono indices `01 02 03` above a hairline top border —
   never bullets or shadowed cards. Radius is crisp: 4px surfaces, 3px
   controls. No gradients, no glows, no glassmorphism, no drop shadows
   beyond one soft elevation.
7. **Console chrome.** Panels that show real artifacts (tables, logs,
   code) get a bar of three 7px dots (#4d4741), a mono uppercase 11px
   title, and an optional quiet mono flag on the right. Tables are mono
   with hairline rows and tabular numbers. Status dots: neutral (#c9c0ad)
   when healthy, terracotta only when degraded.
8. **Fonts.** Inter and DM Mono are self-hosted in production; when the
   stack cannot ship font files, fall back to system-ui and ui-monospace
   and say so. Do not add decorative display fonts.

## Landscape blocks

When the app wants atmosphere (hero or background), use two large blurred
radial fills in the raised-canvas tones (`#3a3430`, `#46403a`) at low
opacity — quiet depth, not decoration.

## The mark (inline SVG, stroke = currentColor)

```html
<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linejoin="round" width="19" height="19" aria-hidden="true">
  <path d="M4 26 16 5l12 21H4Zm12-21v21M4 26l18-10" class="text-[#e0705a]"/>
</svg>
```

Pair it with a lowercase name and a terracotta dot: `appname<span
style="color:#e0705a">.</span>`

## Applying it

- Marketing/landing shapes: nav with the mark, hero with an eyebrow and a
  short declarative headline (plain weight, no shouting), a "built on"
  strip, numbered features, a centred closing.
- Console/dashboard shapes: sticky top nav with a hairline bottom border,
  a stat row (label / big mono number / note), hairline data tables, event
  logs as mono lines with quiet timestamps.
- Copy voice: short declarative sentences. No exclamation marks. Scope
  claims precisely.

If the design system is unavailable in the stack, approximate with the
nearest influence: warm near-blacks, off-white text, 1px neutral borders,
generous letter-spacing on uppercase labels, and a single warm accent.
