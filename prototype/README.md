# StackSense prototype

A clickable prototype of **StackSense**, built from *StackSense — Prototype UI & Flow Spec* (Oct 3, 2026).
It is kept as the UX reference for the production app (`web/`, backed by `backend/`); see the root `README.md`.
It walks Maya, the demo persona, through an intake that rewrites itself after every answer. The intake ends in three outputs:

1. a **Health Impact Map** (radar and stacked bars across 8 body areas)
2. a **buy list** (stack cards with product picks and affiliate links)
3. a **daily dosage calendar** (Today, Month, export and reminders)

Every answer is pre-filled with Maya's, so you can tap **Continue** through her whole path. Change any answer and the flow, the signals and the stack change with it. A small rules engine drives this, not a script.

## Run it

No build step and no dependencies. Open `prototype/index.html` in a browser, or serve the folder:

```sh
cd prototype
python3 -m http.server 8080   # then open http://localhost:8080
```

To get one self-contained HTML file you can send or host anywhere:

```sh
python3 tools/bundle.py        # run inside prototype/; writes prototype/dist/stacksense-prototype.html
```

## Using the viewer

- **Left panel**: every frame from section 10 of the spec (F01–F34 and the b-variants, D1–D3 desktop), plus the section 9 edge states (X1–X6). Clicking a frame replays Maya's answers up to that point.
- **Centre**: the 390 × 844 phone, or the 1440 × 900 desktop frame (Phone / Desktop toggle).
- **Right panel**: what the current frame changes (from the spec), Maya's answer, the live engine state (confidence, signals, stack, cost) and the **demo success test**. Its three moments tick off as you reach them: restless legs → iron path, vegetarian → collagen excluded, birth control → St John's wort blocked.
- **Pre-fill Maya's answers**: turn it off to answer from scratch.
- Keyboard: `→` presses the primary button, `←` goes back, `Esc` closes a sheet.
- Deep links: `index.html#F27`, `#F06b`, `#X3` and so on.
- On a phone-sized screen the app fills the screen and the frame list moves behind the **Frames** button.

## What's wired

| Spec | In the prototype |
|---|---|
| Adaptive intake (A1–D3) | Cards appear only when a signal or goal calls for them. Snoring (A2) and knee swelling (B9) lead to stop cards. Pregnancy (B6) switches to a pregnancy-safe library. Thyroid, liver, gallstones and blood thinners (C1/C2) hide the affected supplement. |
| Confidence ring | Weighted by card. Maya's ring reads 31% → 48% at B2 and 62% after B5, as in the spec. "Not sure" counts half. |
| Insight rail and branch toasts | Tags fade in and the rail pulses. Tap a tag to see the answers behind it. Toasts auto-dismiss after 2.5 s. |
| Controls | Drag-to-rank (A1), draggable energy line with 3 presets (B1), body map front/back (B8), PSS-4 swipe cards plus source micro-card (B11), medicine search with autocomplete after 3 letters and a live interaction check (C1), budget slider (D1), pill stepper and powders toggle (D2), five time pickers and run days (D3). |
| Lab entry | "I already have bloodwork", B7 "Yes, enter values" and the locked iron card all open it. Ferritin under 30 unlocks iron; 30–50 is borderline; 50 and over rules it out. |
| Here's what we heard (E) | Signals grouped by body area. Tap a chip to see its sources. Remove a chip and the stack, needs and cost update live, with a summary of what changed. |
| Analysis (F26) | Four beats over about 7 s, including the strike-through list. Moves on to F27 by itself. |
| Results (F27–F31) | Radar ↔ bars toggle with build-up animation. Tap an area for its contributors, then filter the cards to that area. Gap callout under 50%. "When you might notice" strip. Expandable cards. Product sheet with best match, alternative and filtered-out items. Excluded drawer. Optimizer when over budget. Low-confidence state. |
| Calendar (F32–F34) | Ramp-up from Mon 5 Oct 2026. NEW badges with a 3-day check-in. Ferritin test task on Wed 7 Oct. Re-scores on 19 Oct, 2 Nov and 30 Nov. Ashwagandha off-weeks 9–22 Dec. Race day 13 Dec. Refill reminders 5 days before each bottle runs out. Checking a slot fills the ring. Per-slot reminder toggles, an `.ics` export and a doctor note. |
| Desktop (D1–D3) | Results dashboard (map and stack side by side), calendar month with day detail, and a printable weekly sheet. |

The Health Impact Map uses the spec's demo scoring, so Maya's chart matches it exactly: Sleep 69%, Energy 71%, Joints 83%, Mood 92%, Performance 90%, Skin & hair 40%, Immunity 100%, Heart 100%, which is 7 of 8 areas at two-thirds or more.

## Where it differs from the spec

- **Pills on the busiest day.** The spec says "5 pills + 2 scoops" and "max pills on any day: 5". Its own schedule adds up to 6 on Mon/Wed/Fri: D3 1, omega-3 2, B12 1, ashwagandha 1 and curcumin 1. D2's note ("avoids a 7th pill") also implies 6. The prototype calculates the count and shows **6 pills + 2 scoops**, inside Maya's limit of 6.
- **Prices** are CAD demo values per dose, set so Maya's stack comes to about $78/month, inside her $80.
- **Thorne Curcumin Phytosome** is marked out of stock to demo the "Swapped — original unavailable" fallback, as the spec describes. NOW CurcuBrain is promoted.
- **Ashwagandha's best match** links to the brand's site as a stand-in for the brand affiliate program.
- **Affiliate links** are Amazon.ca search links with the placeholder tag `stacksense0c-20` (from the spec). Swap in a real tag before sharing.
- **Product thumbnails** are neutral placeholders, as the spec asks, until licensing is checked.
- **Today** in the calendar is fixed at **Mon 19 Oct 2026** (day 15: full stack, curcumin still NEW, first re-score).
- Desktop frames are `DESK1`–`DESK3` internally so they don't collide with intake cards D1–D3. The frame list still labels them D1–D3.

## Code map

```
index.html        viewer shell: frame list, phone/desktop stage, notes panel
css/styles.css    design tokens from section 2 of the spec, components, viewer layout
js/data.js        persona, body areas, signals, the 22 cards with Maya's answers, supplements, products, medicines
js/engine.js      answers → signals → stack → impact map → calendar; formatting, .ics and doctor note
js/charts.js      radar, stacked bars, confidence and day rings (hand-built SVG/HTML)
js/ui.js          shared pieces: stack card, product row, sheets, toasts
js/intake.js      welcome, privacy, question cards and controls, stop cards, lab entry
js/results.js     review (E), analysis (F26), map (F27), stack (F28–F31)
js/calendar.js    Today (F32), Month (F33), export (F34), weekly sheet
js/desktop.js     desktop frames D1–D3
js/app.js         state, routing, frame jumping, viewer panels, boot
tools/bundle.py   single-file build
```

To change the demo, edit `js/data.js`. Each card has a `show` rule, Maya's answer (`maya`) and the spec note (`spec`). Each supplement lists the signals that add it (`primary`) and its contribution to each body area (`contrib`).

*StackSense gives general information, not medical advice. This prototype contains demo content only.*
