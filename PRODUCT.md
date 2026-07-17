# CaNaMED — PRODUCT.md

## Register
**Product** (app UI). Design serves the tool: a facilitated-session instrument,
not a marketing surface. Explicitly NOT a funnel — no hero-with-CTA, no social
proof, no conversion patterns.

## Who / what / why
Medical students (B1–B2 EFL readers, France × Japan) and their facilitators run
live problem-based-learning workshops: a clinical case (Module A), a
breaking-bad-news roleplay (Module B), team decisions, a live leaderboard,
verifiable certificates. Used INSIDE supervised classroom sessions on laptops,
tablets and phones — mixed ambient light, projector sometimes, both themes real.
It is also a research instrument (GDPR/APPI consent flows are load-bearing).

## Brand personality
"Clinical Editorial" — the digital product of a good university press or a
well-designed medical journal. Credible, calm, typographically confident,
institutionally bilingual (Université de Caen Normandie × Nagoya University).
Colour = meaning: Nagoya blue (primary), Caen amber (marginalia/accents),
meeting teal (everything shared). Warm paper ground is committed brand
(user-approved, pre-existing identity — identity-preservation wins).

## Anti-references (from the owner, verbatim intent)
- "AI-default look": glassmorphism, bento grids, neumorphism, purple gradients,
  Inter-for-everything, emoji-as-icons (now purged), SaaS landing chrome.
- Marketing/conversion advice of any kind.
- Figurative clip-art illustration; anything that reads "generated".

## Strategic design principles
1. Typography carries hierarchy (Source Serif 4 display voice / Source Sans 3
   UI; letterspaced-caps kickers used sparingly as an editorial signature —
   NOT on every section).
2. Tokens only: tokens.css is the single source of truth; never write raw
   hex/px in stylesheets.
3. Hairlines before shadows; paper before chrome; restraint before delight.
4. WCAG AA is non-negotiable (compliance page is published): 4.5:1 body
   everywhere, visible focus, 1rem floor, all three themes (light/dark/
   high-contrast) first-class. Consent/privacy wording is IMMUTABLE.
5. Structure is stable: presentational change only unless the owner approves
   composition changes explicitly (they did for the splash, once, on mocks).

## Hard constraints
Vanilla HTML/CSS/JS, no frameworks. Strict CSP (`style-src 'self'`, no font/
icon CDNs — everything self-hosted or inline). Perf budget: 337 KB gz JS+CSS
on the splash (index.html markup is uncounted). Per-device Playwright
coverage for every UI change (iPhone/iPad/Android/desktop). PWA shell-version
3-file lockstep on every shipped asset change.
