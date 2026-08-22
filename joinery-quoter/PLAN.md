# Joinery Quoter — Build Plan

A standalone, offline, single-file HTML quoting tool for joinery manufacturers. Replaces
`quote_master_tb.xlsx` (v2.71). Room-by-room quoting, saved quotes, editable and
self-documenting rate catalogue, a first-run setup wizard, a statistics dashboard for price
trends across jobs, dark UI, and white-background PDF export of the client summary.

This document is the complete specification. The calculation engine section is **normative** —
every formula was reverse-engineered from the source workbook and verified numerically
(see §13 Acceptance Tests). Do not "improve" the maths; reproduce it exactly.

---

## 1. Constraints (non-negotiable)

| Constraint | Requirement |
|---|---|
| Runtime | Opens by double-clicking an `.html` file from a local disk or OneDrive folder. `file://` must work. |
| Network | **Zero** network requests. No CDN, no Google Fonts, no analytics, no fetch. Must work with the machine offline. |
| Build step | None. The deliverable is hand-authored HTML/CSS/JS. No npm, no bundler, no TypeScript compile. |
| Dependencies | None. Vanilla JS only. PDF via the browser's own print engine (`window.print()` + a print stylesheet) — **do not** vendor jsPDF/html2pdf. |
| Server | None. Nothing depends on the user's Umbrel server or any host. |
| Browsers | Current Chrome and Edge (Chromium). Firefox best-effort. No IE. |
| Theme | Dark by default. Print output is always white. |

---

## 2. Decisions already made

These were confirmed by the user. Do not re-open them.

1. **Storage** — IndexedDB as the working store (instant quote list, search, open) **plus**
   explicit *Save to file* / *Open from file* using `.joq` files (JSON with a different
   extension) so the real copies live in the job folder on OneDrive.
2. **PDF export** — client-facing summary only: the per-room spec + price table, **and** the
   options-pricing block (alternate doors/panels and alternate benchtops). No internal cost
   breakdown in the PDF. The internal numbers stay on screen only.
3. **Rate history** — each quote **freezes a snapshot** of the catalogue it was priced with.
   Reopening an old quote never silently reprices it. A *Re-price at current rates* action
   re-runs it against the live catalogue and shows a before/after diff before committing.
4. **Audience** — generic tool for any joinery shop, **seeded** with the rates extracted from
   the source workbook. Company name, logo, tiers, overhead model and every rate are editable
   in Settings. Nothing is hardcoded to one business.

5. **Settings are self-documenting.** Every value carries an explanation of what it feeds and
   a worked example using the user's own numbers, so the pricing model can be fine-tuned by
   someone who did not build the original spreadsheet. See §8.1.
6. **A first-run wizard** walks a new user through the handful of values that matter, with
   every field pre-filled from the seed so it can be skipped entirely. See §8.2.
7. **The landing page is a dashboard** aggregating every saved quote into price trends,
   benchmarks and pipeline statistics. See §7.

Two further calls made while planning (stated, not asked):

8. **Rooms are unlimited.** The spreadsheet was capped at 8 columns (F–M); the tool is not.
9. **The full internal cost engine is kept**, on screen, in the dark UI — margins, COGS,
   overhead recovery, warnings, hour tallies, bonus pool. That machinery is the actual value
   of the sheet; it is reproduced faithfully.

---

## 3. Deliverable & file layout

```
joinery-quoter/
├─ joinery-quoter.html      ← THE deliverable. Self-contained, ~4–6k lines.
├─ seed-catalogue.json      ← provided. Inline this into the HTML as the factory default.
├─ PLAN.md                  ← this file
└─ samples/
   └─ 3-stewart.joq         ← optional: a saved quote reproducing the acceptance test
```

`seed-catalogue.json` already exists in this folder and holds every rate table extracted from
the workbook. **Embed its contents verbatim** in a `<script type="application/json"
id="seed-catalogue">` block (or as a JS object literal). It is the factory reset baseline —
on first run it is copied into IndexedDB as the user's live catalogue.

Keys prefixed with `_` in the seed file (`_formula`, `_derived`, `_rateFormula`, `_note`) are
documentation for the implementer. Ignore them at runtime; do not render them.

### Internal code organisation

Single file, but keep it structured with clearly delimited sections in this order:

1. `<style>` — design tokens, dark UI, then the `@media print` block last
2. Seed catalogue JSON
3. `db.js` block — IndexedDB wrapper
4. `calc.js` block — the pure calculation engine (**no DOM access whatsoever**)
5. `stats.js` block — pure aggregation over many quotes for the dashboard (also DOM-free)
6. `registry.js` block — the settings field registry (§8.1)
7. `charts.js` block — the five SVG chart primitives (§7.5)
8. `ui.js` block — rendering and event handling
9. `print.js` block — builds the print DOM
10. `tests.js` block — the acceptance tests from §13, runnable from a hidden dev panel

The engine must be a pure function `computeQuote(quote, catalogue) → results`, and the
aggregator a pure `computeStats(quoteResults, filter) → aggregates`. Keeping both DOM-free is
what makes §13 testable.

---

## 4. Domain model

### 4.1 Catalogue (see `seed-catalogue.json`)

A catalogue is: company details, client tiers, adjustment steps, the overhead model, the CNC
model, travel rates, warning thresholds, the bonus model, and an ordered list of **sections**.

Each section has an `id`, `title`, `kind`, `costBucket`, optional `hoursBucket`, `unitLabel`,
and an array of `items`.

`kind` determines how an item's effective rate is derived:

| `kind` | Rate derivation | Sections |
|---|---|---|
| `simple` | `item.rate` | benchtops, drawers, innerDrawers, handles, hardware, roomExtras |
| `labour` | `item.rate` (per hour) | officeLabour, factoryLabour, siteLabour |
| `board` | `item.boardCost + item.edgeCost100m / 4 + cncPerSheet(item.cncProfile)` | boardEdge |
| `travel` | `quote.kmFromFactory * item.perKm` | travel |

`costBucket` determines which rollup bucket the line's cost lands in:
`labourOffice` | `labourWorkshop` | `materials` | `overheads`.

`hoursBucket` determines which hour tally the quantity feeds:
`office` | `factory` | `site` | `travel` (see §5.4 — factory and site are **halved**).

The `/ 4` on `edgeCost100m` and the halving of factory/site hours are both in the original
sheet. They are deliberate. Keep them.

### 4.2 Quote

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid",
  "jobName": "3 Stewart",
  "client": "THC",              // free text, seeded from dropdowns.clients
  "clientTier": "T2",           // -> materialMarkup
  "revision": 1,
  "status": "draft",            // draft | sent | won | lost
  "createdAt": "2026-08-22T00:00:00Z",
  "updatedAt": "2026-08-22T00:00:00Z",
  "sentAt": null,               // stamped on draft -> sent
  "decidedAt": null,            // stamped on sent -> won|lost; gives days-to-decision
  "kmFromFactory": 25,
  "notes": "",

  "rooms": [
    {
      "id": "uuid",
      "name": "Kitchen",
      "spec": {                      // client-facing, drives the PDF summary
        "doorsPanels": "Matt (16mm)",
        "benchtop": "Stone (Designer) 40mm",
        "jobSize": "Medium",
        "jobType": "Manufacture/Install"
      },
      "adjust": 0,                   // one of catalogue.adjustmentSteps
      "qty": {                       // sectionId -> itemName -> quantity
        "officeLabour": { "Measure": 1, "Design": 2, "Quote": 0.5, "Nest & Order": 1 },
        "boardEdge":    { "Whiteboard": 13, "Matt": 8 },
        "travel":       { "Trips to measure": 0.5, "Trips in truck": 1 }
      }
    }
  ],

  "options": [                       // alternates priced separately for the PDF
    {
      "id": "uuid",
      "roomId": "uuid",              // null = whole-of-job option
      "label": "2pac S2/VJ doors",
      "kind": "doorsPanels",         // doorsPanels | benchtop | other
      "priceIncGst": 2400,           // manually entered OR computed, see §9.4
      "computed": false
    }
  ],

  "catalogueSnapshot": { /* full catalogue object as at pricing time */ },
  "catalogueVersion": "2.71"
}
```

Quantities are keyed by **item name**, not index, so reordering the catalogue does not corrupt
saved quotes. If a snapshot contains an item name absent from the current catalogue during a
re-price, surface it in the diff as *removed* rather than dropping it silently.

`.joq` file = this object, pretty-printed JSON, UTF-8, no BOM.

---

## 5. Calculation engine (normative)

All money is computed in full floating-point precision and **only rounded for display**.
Never round intermediate values — the acceptance tests in §13 depend on this.

### 5.1 Effective rate per item

```
cncPerSheet(profile) = ((labourRate / 60) * profile.minsPerSheet)
                     * (profile.costPerCutter / profile.sheetsPerCutter)
```
where `labourRate = catalogue.otherLabourRates["CNC Cut/Edging"]` (seeded 66).

With the seeded values: `whiteboard = 34.8333…`, `standard = 36.1428…`.

```
rate(item, section, quote):
  simple | labour  ->  item.rate
  board            ->  item.boardCost + item.edgeCost100m / 4 + cncPerSheet(item.cncProfile)
  travel           ->  quote.kmFromFactory * item.perKm
```

### 5.2 Per-room section subtotals

```
sectionTotal(room, section) = Σ over items of  qty(room, section, item) * rate(item, section, quote)
```
Missing quantities are 0.

### 5.3 Per-room cost buckets

```
labourOffice(room)   = sectionTotal(room, officeLabour)
labourWorkshop(room) = sectionTotal(room, factoryLabour) + sectionTotal(room, siteLabour)
materials(room)      = Σ sectionTotal(room, s) for every s where s.costBucket == "materials"
                       // boardEdge, benchtops, drawers, innerDrawers, handles, hardware, roomExtras
travelCost(room)     = sectionTotal(room, travel)
```

### 5.4 Per-room overhead recovery

```
overheadHourlyRate = overhead.dailyRunningCost / overhead.jobsPerDay / overhead.hoursPerDay
                   = 1120 / 2.4 / 8 = 58.3333…

officeHours(room)  = Σ qty in officeLabour
factoryHours(room) = (Σ qty in factoryLabour) / 2
siteHours(room)    = (Σ qty in siteLabour)    / 2
travelHours(room)  = ((Σ qty in travel) * quote.kmFromFactory / 60) * 2

overheadRecovery(room) = (officeHours + factoryHours + siteHours + travelHours)
                       * overheadHourlyRate

overheads(room) = overheadRecovery(room) + travelCost(room)
```

> The `/2` on factory and site hours, and the `*2` on travel hours (return trip), are both
> from the source sheet. The travel term treats km as minutes at 60 km/h.

### 5.5 Per-room rollup

```
markupFactor  = clientTiers[quote.clientTier].materialMarkup          // T2 -> 1.34
markup(room)  = materials(room) * markupFactor - materials(room)      // MATERIALS ONLY

base(room)    = labourOffice + labourWorkshop + materials + markup + overheads

adjustFactor  = 1 + room.adjust                                       // room.adjust ∈ adjustmentSteps
adjust(room)  = base(room) * adjustFactor - base(room)

exGst(room)   = base(room) + adjust(room)
incGst(room)  = exGst(room) * (1 + gstRate)                           // gstRate = 0.10
```

**Markup applies to materials only.** Labour and overheads are passed through at cost. This is
the single most important behaviour to get right.

### 5.6 Per-room profitability (internal, on-screen only)

```
cogs(room)      = labourOffice * 0.65
                + labourWorkshop * 0.65
                + materials * 1.10
                + overheads

cogsRatio(room) = cogs(room) / incGst(room)
profit(room)    = incGst(room) - cogs(room)
```

`cogs.labourFactor` (0.65) = the proportion of a charged labour hour that is actual wage cost.
`cogs.materialsFactor` (1.10) = materials at cost plus a 10% wastage/handling loading.

Both were hardcoded inside the workbook's formulas. They are now editable settings, seeded in
`seed-catalogue.json` under `cogs`, and they need particularly good help text in the registry
(§8.1) — they are the two values most worth revisiting as wage costs move, and the two least
obvious to anyone reading the tool cold.

### 5.7 Job rollup

```
jobExGst  = Σ exGst(room)
jobIncGst = Σ incGst(room)

// Cost-share breakdown, all inc-GST, as % of the inc-GST total
share.office    = Σ labourOffice(room)   * 1.1
share.labour    = Σ labourWorkshop(room) * 1.1
share.materials = Σ materials(room)      * 1.1
share.markup    = (Σ markup(room) + Σ adjust(room)) * 1.1
share.overheads = Σ overheads(room)      * 1.1
shareTotal      = sum of the five
```

Hour tallies for the whole job: `Σ officeHours`, `Σ factoryHours`, `Σ siteHours`,
`Σ travelHours` (post-halving/doubling, as §5.4).

### 5.8 Warnings

| Condition | Message | Severity |
|---|---|---|
| any room `cogsRatio > warnings.roomCogsRatioMax` (0.80) | "Room profit too low in *{room}*. Decrease cost of goods or increase markup." | red |
| `share.materials / shareTotal > warnings.jobMaterialsRatioMax` (0.56) | "Materials are too high a share of total job cost." | amber |

Show these as a banner above the job summary and flag the offending room's card.

### 5.9 Bonus pool (internal panel)

```
pool = (jobIncGst * bonus.poolPctOfTotal * bonus.poolMultiplier) + (Σ adjust(room) / 2)
office  = pool * 0.50
factory = pool * 0.25
site    = pool * 0.25
```

---

## 6. UI specification

### 6.1 Screens

Top-level navigation is four tabs: **Dashboard · Quotes · Settings**, plus the editor which
opens over them. Dashboard is the landing page.

**A. Dashboard (landing).** Specified in full in §7.

**B. Quote list.** Table of saved quotes: job name, client, tier, rooms, total inc GST, status
chip, updated date. Search box filters on job name + client. Status is set here and in the
editor header; changing it stamps `sentAt` / `decidedAt`, which the dashboard needs for win
rate and days-to-decision. Actions per row: Open, Duplicate, Export `.joq`, Delete (with
confirm). Toolbar: **New quote**, **Open from file…**.

**C. Quote editor.** The main working screen. Three regions:

- *Header bar* (sticky): job name, client, client tier selector, revision, km from factory,
  status. Live **Total inc GST** on the right, always visible. Buttons: Save, Save to file,
  Export PDF, Re-price.
- *Rooms* — one collapsible card per room, in a vertical stack. Add Room / Duplicate Room /
  Delete Room / drag to reorder. Each room card contains:
  - Spec row: name, doors/panels, benchtop, job size, job type (dropdowns from
    `catalogue.dropdowns`, all free-text-overridable).
  - Line-item sections, collapsible, one per catalogue section, in catalogue order. Each shows
    only the items with a non-zero quantity **plus** an "+ add item" picker — do **not** render
    all 86 rows always; that was the spreadsheet's weakness. Each row: item name, qty input,
    unit label, rate (read-only, with a tooltip showing its derivation for `board`/`travel`),
    line total.
  - Room footer: the §5.5 rollup — labour, materials, markup, overheads, adjust dial, ex GST,
    inc GST — plus COGS %, profit, any warning flag, and the historical benchmark chip from
    §7.3-F comparing this room against your own median for that room type and size.
  - Adjust dial: a select of `adjustmentSteps` shown as percentages (−20% … +30%).
- *Job summary panel* (right rail on wide screens, bottom section on narrow): per-room price
  table, cost-share breakdown with a simple CSS bar chart, hour tallies, bonus pool, warnings.

**D. Options.** A tab or panel within the editor: list of options, each with a label, an
optional room association, a kind, and a price. See §9.4.

**E. Settings.** Specified in full in §8. Tabbed editor over the whole catalogue, rendered from
the field registry, every field carrying its own explanation:
- Company (name, ABN, phone, email, logo upload → stored as a data URL, terms text, validity days)
- Client tiers (add/edit/remove, edit `materialMarkup`)
- Overhead model (daily running cost, jobs per day, hours per day → shows derived hourly rate live)
- CNC model (both profiles → shows derived $/sheet live)
- Travel (per-km rates, default km)
- COGS factors and warning thresholds; bonus model
- **Catalogue** — per section: add/edit/remove/reorder items and their rates. Editable grid.
  Adding a whole new section is also supported (id, title, kind, costBucket, hoursBucket, unit).
- Dropdown lists (rooms, doors/panels, benchtops, job size, job type, clients)
- Hourly rate builder — the advisory calculator from the `C` sheet (base rate, efficiency,
  super %, workcover %, bonus %, profit %, underquote % → suggested hourly). Display only;
  it does not feed pricing.
- Import catalogue / Export catalogue / **Reset to factory defaults** (with confirm)

### 6.2 Dark theme

Define as CSS custom properties on `:root` so the print block can override cleanly.

```css
--bg:        #14161a;   /* page */
--surface:   #1c1f25;   /* cards */
--surface-2: #23272e;   /* inputs, table stripes */
--border:    #2e343d;
--text:      #e6e9ee;
--text-dim:  #97a0ad;
--accent:    #4a9eff;   /* interactive, focus */
--good:      #3fb87f;
--warn:      #e0a33e;
--bad:       #e05c5c;
--money:     #7ee0a8;   /* totals */
```

Type: system UI stack only (`-apple-system, "Segoe UI", Roboto, sans-serif`) — no web fonts,
they'd require a network request. Tabular numerals (`font-variant-numeric: tabular-nums`) on
every numeric cell. 8px spacing grid. Inputs are borderless-until-focused on `--surface-2`,
right-aligned for numbers. Keyboard: Tab moves across a room's qty inputs in visual order;
Enter commits and moves down.

### 6.3 Interaction rules

- Every edit recalculates immediately and updates all totals — no "calculate" button.
- Autosave to IndexedDB, debounced 800ms, with a subtle "Saved 14:32" indicator.
- Undo/redo (Ctrl+Z / Ctrl+Y) over a snapshot stack, depth 50.
- Number inputs accept decimals (the sheet uses 0.5 hours and 0.5 trips routinely).
- Empty/blank qty is treated as 0 and the row is not counted.

---

## 7. Dashboard (landing page)

The dashboard is what opens when the tool launches (after first run). Its job is to answer
*"what are my prices actually doing across jobs?"* — trends, benchmarks and pipeline — using
only the quotes already on this machine. The quote list moves to its own tab.

### 7.1 Data source and cost

Aggregates are derived by running `computeQuote(quote, quote.catalogueSnapshot)` over every
saved quote — **each quote is always evaluated against its own snapshot**, never the current
catalogue. That is what makes the trend lines honest: a quote priced in March reports March
prices forever.

Memoise per quote keyed on `quote.id + quote.updatedAt`, cached in the `meta` store. Recompute
only what changed. Above ~500 quotes, chunk the pass across animation frames with a progress
bar rather than blocking the paint.

### 7.2 Global filter bar

One filter bar governs every panel: date range (presets — last 90 days, this FY, last FY, all
time, custom), client, tier, status, room type. Filter state persists in `meta` so the
dashboard reopens how it was left. Every panel header restates the active filter in words so a
screenshot is never ambiguous.

### 7.3 Panels

**A — Pipeline strip.** A row of stat tiles: quotes in range (count + total inc GST), won
value, win rate, median days to decision, average quote value, median quote value. Each tile
carries its `n` and a sparkline against the previous equal-length period with a % delta.

**B — Price trend by room type.** *The core of the ask.* Line chart: x = month, y = **median**
inc-GST price per room, one series per room type, legend toggles series. Median, not mean —
one $60k kitchen must not drag the line. Companion table: room type | quotes | median | p25–p75
| 12-month change %.

**C — Rate drift.** The supplier-price tracker, and the panel that justifies snapshotting.
Because every quote carries its catalogue, the rate history of any item can be reconstructed
with no extra bookkeeping. Table: item | first-seen rate + date | current catalogue rate | Δ% |
sparkline. Sortable, filterable by section, default sort biggest increase. This is what tells
you Woodmatt board is up 14% since January.

**D — Cost-mix drift.** Stacked area (or stacked bars by quarter) of the five shares from
§5.7 — office, labour, materials, markup, overheads — as a % of total over time, with the
`jobMaterialsRatioMax` threshold (0.56) drawn as a reference line. Answers "are materials
eating my margin".

**E — Margin health.** Histogram of room `cogsRatio` with the 0.80 threshold marked; median
profit % per quote over time; a count of rooms currently over threshold that click through to
the offending quotes.

**F — Benchmark lookup.** Pick a room type + job size → your historical median, p25, p75 and
`n`. Also surfaced **inside the quote editor** as an inline chip on each room card:
*"Kitchen · Medium — your median $14,200 (n=23) · this room is 8% above."* That chip is the
single most useful thing on the dashboard, because it lands at the moment of decision.

**G — Client & tier mix.** Value by client, win rate by client, tier distribution. Small.

**H — Discounting.** Histogram of the `adjust` values actually used, and win rate bucketed by
average quote adjust (list price / 0–10% off / >10% off). Answers whether discounting is
buying work or giving it away.

### 7.4 Statistical honesty rules (normative)

These are requirements, not suggestions. A quoting tool that lies with statistics is worse
than no statistics.

- Display every figure with its `n`.
- Suppress any median where `n < 3`; render "—" with a "needs 3+" hint.
- Suppress a trend line where the series has fewer than 6 points; show the table instead.
- **Never extrapolate, forecast, or fit a predictive line.** Trailing data only.
- Medians for prices; means only for shares and ratios.
- Exclude `draft` quotes from win rate and price benchmarks by default (they are half-finished
  and bias low). A toggle includes them. Drafts still count in the pipeline tile.
- Where a filter reduces a panel below its threshold, the panel says so rather than showing a
  misleading near-empty chart.

### 7.5 Charts

Hand-authored inline SVG. No charting library — that constraint from §1 is absolute. Build
five primitives and reuse them everywhere: `lineChart`, `barChart`, `stackedArea`, `histogram`,
`sparkline`. Each takes `{ series, xLabels, yFormat }` and returns an SVG string. They read the
dark tokens from §6.2. The dashboard is not part of the print output.

### 7.6 Empty and early states

Under 3 saved quotes, the trend panels are replaced by a single explanatory card — trends need
history, here's what you'll see once you have a few jobs — with the pipeline tiles and a
prominent **New quote** button. This is the normal state for a new user and must not look
broken.

---

## 8. Settings and first run

### 8.1 Self-documenting settings

Every setting is declared in a **field registry** — a data structure, not hand-written markup.
Adding a setting means adding one registry entry, and the UI, the help text and the formula
reference all follow from it.

```js
{
  key:     'overhead.dailyRunningCost',
  label:   'Daily running cost',
  unit:    '$/day',
  type:    'number', min: 0, default: 1120,
  group:   'overhead',
  help:    'Everything it costs to open the doors for a day — rent, power, insurance, '
         + 'vehicles, admin wages, software. Not materials, not chargeable labour.',
  affects: ['overheadHourlyRate', 'overheads(room)', 'cogs(room)'],
  formula: 'overheadHourlyRate = dailyRunningCost / jobsPerDay / hoursPerDay',
  example: ctx => `$${ctx.dailyRunningCost} ÷ ${ctx.jobsPerDay} jobs ÷ ${ctx.hoursPerDay} h `
                + `= $${fmt(ctx.overheadHourlyRate)}/hr recovered on every quoted hour.`
}
```

Each field row renders: label, input, unit, and a one-line `help`. An expandable **"Where this
is used"** reveals the `formula`, the list of derived values it feeds (`affects`), and a **live
worked example substituting the user's own current numbers**. That worked example is the point
— it is what makes a value fine-tunable by someone who did not build the original spreadsheet.

**Live impact preview.** When a value is edited while a quote is open, show a delta chip:
*"This job: $12,480 → $12,910 (+3.4%)"*. Saved quotes are unaffected — their snapshots protect
them (§10.3) — and the settings UI must say so explicitly, or the user will assume editing a
rate has silently rewritten their history.

**Groups**, each with a short prose intro explaining the concept before the fields:
Company · Pricing tiers · Overhead recovery · CNC · Labour rates · Travel · COGS & margin ·
Adjustments · Warnings · Bonus · Catalogue · Dropdowns · Advisory hourly-rate builder.

For example, the Overhead recovery intro: *"Your quotes recover fixed costs through hours, not
a percentage. Every hour you quote carries a share of running the shop. Raise the daily cost or
lower the jobs-per-day and every quote gets dearer."*

**Formula reference page.** A single read-only page rendering the whole of §5 with the user's
current constants substituted in, each line linked back to the setting that feeds it. This is
the "what is used where" view in one place, and it doubles as the tool's own documentation.

**Validation.** Warn but allow: `materialMarkup < 1`, COGS factors outside 0.3–1.5, a labour
rate of 0. Block outright: `jobsPerDay <= 0` and `hoursPerDay <= 0` (division by zero), any
non-numeric. Per-field reset-to-default, per-group reset, and a global factory reset behind a
confirm.

### 8.2 First-run wizard

Runs when `meta.firstRunComplete` is falsy. A modal of six steps with progress dots, Back/Next,
and **"Skip — use defaults"** available on every step. Every field arrives pre-filled with the
seeded value, so pressing Next six times yields a working, correctly-priced tool. Nothing is
mandatory.

1. **Welcome** — what the tool is; that everything stays on this machine and nothing is
   uploaded; that quotes should also be saved to file into the job folder as the real backup.
2. **Your business** — name, ABN, phone, email, logo. Only the name reaches the PDF.
3. **What you charge for time** — the labour rate grid (office / factory / site), with one
   sentence clarifying these are charge-out rates, not wages.
4. **Overhead recovery** — daily running cost, jobs per day, hours per day, with the derived
   $/hr updating live beneath and one sentence explaining what it does.
5. **Pricing tiers** — the five tiers and their material markups, editable, with the note that
   markup applies to **materials only** and labour passes through at cost.
6. **Travel & finish** — default km and per-km rates, then a summary card of every choice made,
   an "I'll fine-tune the rest later in Settings" note, and a **Create your first quote**
   button.

On completion set `meta.firstRunComplete = true` and stamp `meta.setupVersion`. The wizard is
re-runnable at any time from Settings → *Run setup again*, pre-filled with current values and
never destructive.

**Getting-started checklist.** A dismissible card on the dashboard for the first few sessions:
set company details · create your first quote · save a quote to file · export a PDF. It
auto-hides once complete or when dismissed, and never returns.

---

## 9. PDF export

### 9.1 Mechanism

`window.print()` against a print stylesheet. No library. The print DOM is built into a
`<div id="print-root">` that is `display:none` on screen and the only visible element in print.

```css
@media print {
  @page { size: A4 portrait; margin: 14mm; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block !important; }
  #print-root, #print-root * {
    background: #fff !important;
    color: #000 !important;
    box-shadow: none !important;
  }
  table { border-collapse: collapse; page-break-inside: auto; }
  tr    { page-break-inside: avoid; }
  thead { display: table-header-group; }   /* repeat headers across pages */
  .page-break { page-break-before: always; }
}
```

Also set `-webkit-print-color-adjust: exact` **off** — we want pure white; explicitly force
white rather than relying on the browser stripping the dark theme.

The user saves via the browser's *Print → Save as PDF*. Note this in the UI: a one-line hint
next to the Export PDF button reading "Opens your browser's print dialog — choose *Save as
PDF*." Set `document.title` to `Quote — {jobName} — Rev {n}` before printing so the suggested
filename is sensible, and restore it afterwards.

### 9.2 What goes on the PDF (client-facing only)

Page 1:
1. **Header** — company logo (if set), company name, ABN, phone, email. Right side: "QUOTATION",
   job name, client, quote date, revision, valid-until date (`date + quoteValidDays`).
2. **Room summary table** — one row per room:

   | Room | Doors / Panels | Benchtop | Type | Price (ex GST) |
   |---|---|---|---|---|

   Only the room's `spec` fields and its `exGst`. **No** labour, materials, markup, overhead,
   COGS or adjust columns. Rooms with a zero total are omitted.
3. **Totals block** — Subtotal ex GST, GST (10%), **Total inc GST** (emphasised).
4. **Options block** — grouped by kind, each row: label, associated room (if any), price. With
   the standing note: *"Options are priced as alternatives to the above and are not included in
   the total."*
5. **Terms** — the `company.terms` text, and the validity line.

There is deliberately no internal breakdown on this document.

### 9.3 What must never appear on the PDF

Cost buckets, markup amounts, the adjust dial, COGS, profit, margin %, hour tallies, bonus
pool, supplier names, item-level rates, warnings. Add an automated check in `tests.js` that
asserts none of these labels appear in `#print-root`'s text content.

### 9.4 Options pricing

Two ways to create an option, both supported:

- **Manual** — type a label and an inc-GST price. `computed: false`.
- **Computed** — pick a room and a substitution (e.g. swap `Whiteboard` sheets for
  `2pac Hampton Sheet` in that room's `boardEdge`). The tool clones the room, applies the
  substitution, runs `computeQuote` on the clone, and stores
  `priceIncGst = clonedRoom.incGst - originalRoom.incGst` as the **delta**. `computed: true`,
  with the substitution recorded so it can be re-derived on a re-price.

Display computed options as a delta ("+$2,400") and manual ones as entered. Both go on the PDF.

---

## 10. Persistence

### 10.1 IndexedDB

Database `joinery-quoter`, version 1.

| Store | Key | Contents |
|---|---|---|
| `quotes` | `id` | full quote objects incl. `catalogueSnapshot` |
| `catalogue` | fixed key `"current"` | the live editable catalogue |
| `meta` | key/value | schema version, last opened quote id, UI prefs, `firstRunComplete`, `setupVersion`, dashboard filter state, dashboard aggregate cache |

Wrap every call in a promise helper. On any IndexedDB failure (private browsing, corrupt
store), fall back to in-memory operation and show a persistent amber banner: "Browser storage
unavailable — use Save to file to keep your work."

### 10.2 File save / open

- **Save to file** — serialise the quote, `Blob`, `URL.createObjectURL`, `<a download>` with
  filename `{jobName} - Rev {n}.joq` (sanitised). Where `showSaveFilePicker` exists, prefer it
  so the user can save straight into the OneDrive job folder and re-save over the same handle;
  fall back to the anchor-download path otherwise.
- **Open from file** — `<input type="file" accept=".joq,.json">` plus drag-and-drop onto the
  quote list. Validate `schemaVersion`, then upsert into IndexedDB by `id`. If a quote with
  that `id` already exists and differs, prompt: *Replace / Import as copy / Cancel*.
- Export/import of the **catalogue** alone uses `.joqcat`, so a shop can distribute one price
  list across several machines.

### 10.3 Snapshot & re-price

On first save, deep-copy the current catalogue into `quote.catalogueSnapshot` and record
`catalogueVersion`. All subsequent computation for that quote uses the snapshot.

**Re-price** action: run `computeQuote(quote, currentCatalogue)`, diff against the snapshot
result, and show a modal listing every changed rate (item, old, new, Δ) and the resulting
per-room and total change. Buttons: *Apply* (replaces the snapshot, bumps `revision`) or
*Cancel* (nothing changes). Items present in the snapshot but missing from the current
catalogue are listed as *removed — quantity retained at old rate*.

---

## 11. Migration path from the spreadsheet

Not a build requirement, but design for it: because quantities are keyed by item name and the
seed catalogue uses the workbook's exact item names, a future `.xlsx` importer can map the
`Q` sheet's F–M columns onto rooms with a name lookup. Keep the seed names byte-identical to
the workbook (they currently are, including `Metabox "N" 500mm` with its embedded quotes and
`Laminate(per. m) 600m` with its odd spacing).

---

## 12. Build order

Work in this sequence; each milestone should be independently verifiable.

| # | Milestone | Done when |
|---|---|---|
| 1 | Skeleton HTML, design tokens, dark shell, nav tabs, seed catalogue inlined | Page opens from `file://`, renders the empty-state dashboard |
| 2 | `calc.js` — pure engine per §5 | §13 tests pass in the dev panel |
| 3 | IndexedDB layer, quote list CRUD, autosave | Create/rename/delete/reopen a quote across a browser restart |
| 4 | Quote editor: rooms, sections, qty grid, live rollups | Reproduce the acceptance-test quote by hand and match §13 |
| 5 | Job summary panel: cost shares, hours, bonus, warnings | Warnings fire at the thresholds |
| 6 | Print stylesheet + `#print-root` builder | PDF matches §9.2, and §9.3's leak test passes |
| 7 | Options (manual + computed) | Options appear on the PDF, computed deltas correct |
| 8 | Settings field registry, self-documenting UI, formula reference page (§8.1) | Every setting has help + a live worked example; registry-coverage test passes |
| 9 | Catalogue editing, import/export, factory reset | Change a rate → new quotes use it, old quotes don't |
| 10 | First-run wizard (§8.2) | Skipping it yields a catalogue byte-identical to the seed |
| 11 | Save/open `.joq`, drag-and-drop, re-price diff modal | Round-trip a quote through a file with no value drift |
| 12 | Chart primitives + dashboard (§7) | Trend/benchmark figures match the aggregate tests; suppression rules hold |
| 13 | Polish: undo/redo, keyboard nav, empty states, responsive | — |

Milestone 2 before any UI work. The engine is the risk; the UI is not.

The dashboard is deliberately last: it consumes the output of everything above it, and it is
the only part that cannot be meaningfully tested until several quotes exist. Build it against
a generated fixture set (§13, test 7) rather than waiting for real data.

---

## 13. Acceptance tests (normative)

These come from the *Bathroom* column (column `I`) of the source workbook and were verified
against the stored spreadsheet values. Hardcode them in `tests.js`.

**Fixture** — client tier `T2` (markup 1.34), `kmFromFactory = 25`, seeded catalogue,
room adjust = 0, quantities:

| Section | Item | Qty |
|---|---|---|
| officeLabour | Quote | 0.5 |
| officeLabour | Nest & Order | 0.5 |
| boardEdge | Whiteboard | 1 |
| boardEdge | Woodmatt | 1 |
| drawers | DTC/Edge 178x500 | 2 |
| handles | Fingerpull (per pull) | 2 |
| hardware | Blum 110d & plate | 4 |
| factoryLabour | Assemble/Set up | 1 |
| siteLabour | Installation | 1 |
| travel | Trips in ute | 0.5 |

**Expected** (tolerance 0.01):

| Value | Expected |
|---|---|
| `cncPerSheet(whiteboard)` | 34.8333… |
| `cncPerSheet(standard)` | 36.1429… |
| rate — Whiteboard | 97.3333… (55 + 30/4 + 34.8333) |
| rate — Woodmatt | 209.8929… (160 + 55/4 + 36.1429) |
| `labourOffice` | 93.00 |
| `boardEdge` subtotal | 307.2262 |
| `drawers` subtotal | 76.00 (2 × 38) |
| `handles` subtotal | 40.00 (2 × 20) |
| `hardware` subtotal | 22.00 (4 × 5.5) |
| `materials` | 445.2262 |
| `markup` (T2) | 151.3769 |
| `labourWorkshop` | 179.00 (86 + 93) |
| overhead hours | 2.41667 (1.0 office + 0.5 factory + 0.5 site + 0.41667 travel) |
| `overheadRecovery` | 140.9722 |
| `travelCost` | 35.00 (0.5 × 25 × 2.8) |
| `overheads` | 175.9722 |
| `exGst` | **1044.5753** |
| `incGst` | **1149.0328** |
| `cogs` | **842.5210** |
| `cogsRatio` | 0.73324 |
| `profit` | 306.5118 |

**Additional assertions:**

1. Changing tier to `T4` (1.51) must change *only* the markup term — labour, materials,
   overheads and hours are unchanged. New markup = `445.2262 × 1.51 − 445.2262 = 227.0654`.
2. Setting room adjust to `+0.1` must scale the whole `base` by 1.1, not just part of it.
3. A room with all-zero quantities produces `exGst = 0` and no warning, not `NaN`.
4. Re-pricing a quote whose snapshot equals the current catalogue produces a zero-length diff.
5. `#print-root` text must not contain any of: `COGS`, `Markup`, `Overhead`, `Adjust`,
   `Profit`, `Margin`, `Bonus`, `Materials`, `Labour`.
6. `.joq` round-trip: export → clear IndexedDB → import → recompute gives byte-identical
   totals.

**Dashboard and settings tests.** Build a generated fixture set of 12 quotes spread across
18 months, with known room types, prices, statuses and two deliberate rate changes in their
snapshots. Assert:

7. Median kitchen price by month matches the hand-computed median of the fixture, and a month
   with a single quote is suppressed (`n < 3` → "—"), not plotted.
8. Rate drift reads rates from each quote's `catalogueSnapshot`, never from the current
   catalogue: bump a live rate and confirm every historical point is unmoved.
9. Win rate excludes `draft` quotes by default and changes correctly when the include-drafts
   toggle is set.
10. A filter that reduces a panel below its `n` threshold shows the suppression message rather
    than a chart.
11. No dashboard code path produces a value for a future date — assert the maximum x of every
    series is ≤ today.
12. **Registry coverage:** every editable key in the catalogue schema has a matching entry in
    the settings field registry, and every registry entry resolves to a real catalogue key.
    A mismatch fails the test — this is what stops settings silently drifting out of sync with
    the model as the catalogue grows.
13. Every registry entry's `example(ctx)` returns a non-empty string given the seeded values.
14. Skipping the first-run wizard entirely leaves a catalogue deep-equal to `seed-catalogue.json`,
    and `meta.firstRunComplete === true`.

---

## 14. Non-goals

Explicitly out of scope for this build. Do not add them.

- Multi-user sync, login, or any server component
- Cutting lists, nesting, CAD, or cabinet-level geometry
- Invoicing, purchase orders, supplier ordering, or accounting integration
- Email sending
- Xlsx import (see §11 — designed for, not built)
- Mobile-first layout. Desktop is the target; the layout should degrade gracefully to a tablet
  but need not be usable on a phone.
- **Forecasting, predicted win probability, or "suggested price" automation.** The dashboard
  reports what happened; it does not guess what will. A tool that invents a number a joiner
  then quotes is a liability.
- Benchmarking against anyone else's data. Every statistic is derived from this machine's own
  quotes and nothing leaves the machine.

---

## 15. Notes for the implementing model

- The single biggest failure mode is "improving" the maths. The halved factory/site hours, the
  `edgeCost100m / 4`, the doubled travel hours, markup on materials only, and the 0.65/1.10
  COGS factors are all intentional business rules carried over from the workbook.
- The second biggest is rendering all 86 catalogue items in every room. The spreadsheet had to;
  this tool must not. Show only what's used, plus an add-item picker.
- Build the settings UI from the field registry (§8.1) from the very first field. Hand-writing
  the markup for a dozen settings and retrofitting a registry afterwards is how the help text
  and the formula reference end up out of sync with the model.
- The dashboard must read each quote's `catalogueSnapshot`, never the live catalogue. Getting
  this wrong makes every historical price silently track today's rates, which turns the whole
  trend feature into an expensive way of drawing a flat line.
- Obey the suppression rules in §7.4 even when they make a panel look sparse. A median over
  two jobs is not a median.
- Round only at the point of display. `toFixed(2)` in a formatter, never in the engine.
- Keep `calc.js` free of DOM references so §13 can run headlessly.
- The seed catalogue's item names must not be tidied, reworded, or re-cased.
