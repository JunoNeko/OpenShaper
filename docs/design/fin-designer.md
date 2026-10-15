# Fin designer — standalone Futures fin design for CNC and print

Status: **steps 0–5, 4a and 7–11 done, plus insertion clearance; 12 (section and taper panes) next.** The `/fin` page is live with the outline pane. Tab spec and fixture: `docs/specs/fins/futures-tabs.*`.
Kernel: `packages/kernel/src/fin-design/` (tab outline, `FinDesign` model, defaults,
rules, readouts, blade sections, blade surface, placement, NACA presets, meshes); export: `fin-step.ts`; io: `fin-json.ts`; store: `fin-store.ts`, `fin-edits.ts`; render2d: `FinCurveEditor.tsx`, `fin-curve-view.ts`; web: `apps/web/src/fin/`, route `/fin` (offline, like `/app`). This is the agreed scope and build order. Update the status line as steps land.

## Goal

A standalone fin designer at `/fin`. A shaper starts from a default fin, edits its
outline, foil section and thickness taper by dragging points, and exports a solid for
CNC milling (**STEP, the priority**) or 3D printing (STL). The fin is its own document,
independent of any board. It does not touch the board's `FinSpec`/`FinConfig`.

Out of scope: DXF, importing STEP/STL, FCS or other box systems, a single fused solid
(see [STEP topology](#step-topology)).

## Requirements

### Futures tabs

The tab is the part that sits in the Futures box. Bases are industry standard and **not
editable**. The user picks one of:

| Tab               | Length | Depth | Thickness | Notches | Cant  | Sides |
| ----------------- | ------ | ----- | --------- | ------- | ----- | ----- |
| Side / quad front | 113    | 17.7  | 6.35      | side    | 0–20° | L / R |
| Quad rear         | 113    | 12.7  | 6.35      | centre  | 0–20° | L / R |
| Centre            | 113    | 12.7  | 6.35      | centre  | 0°    | —     |

All dimensions in mm.

- Futures is a US standard, so the source dimensions are in inches. The app always shows
  and writes mm.
- Quad rears use the centre tab geometry but take cant and a side: they sit further
  back where the tail is thinner, hence the shallower tab.

The notch geometry comes from the user's AutoCAD drawings of the **box slot**: 113.5
long, with the side drawing marked 17.7 deep. The tab is slightly smaller than the slot.
Each feature keeps its drawn size and is placed from its own end of the 113 mm tab.

**Rear, trailing end (both tab families):**

- Ø4.4 U-slot open to the end, centre 6.4 below the tab top, 3.3 in from the end.
- Bottom-rear corner R1.0.

**Front, leading end:** a V-notch the grub screw seats in.

| Front notch        | Included angle | Apex below top | Front-face angle | Setback at top | Setback at bottom |
| ------------------ | -------------- | -------------- | ---------------- | -------------- | ----------------- |
| Centre / quad rear | 100°           | 4.5            | 101°             | 2.0            | 0.7               |
| Side / quad front  | 90°            | 5.5            | 101°             | 3.8            | 2.1               |

These readings are transcribed from screenshots. Step 0 pins them in a fixture that the
user signs off before anything depends on it.

### Blade

- **Outline:** dragged freely, with these rules:
  - The root chord is not tied to the tab, and the fin may extend behind the tab
    without limit.
  - The leading-edge root may overhang the tab's **top-front corner by at most 2.5 mm**.
    The grub screw sits at the front of the box.
  - The leading and trailing edges must each keep rising from root to tip, so every
    horizontal slice cuts the outline exactly twice. A drag that breaks this is clamped.
  - **Raised rear** (long-based fins, e.g. keels and twins). Behind the tab, the blade's
    underside may rise from the base to a raised low point before the trailing edge
    climbs to the tip, so the fin can be rocked onto the box's rear pin without its
    tail hitting the board. The outline chain then runs down the trailing edge to the
    low point and forward along the underside to the base. Height still falls all
    the way from the tip, so the rules above already allow it, and the editor must
    let control points form it: add points on the trailing edge, move them behind
    and above the base, and end the chain anywhere on the base.
    `raised-rear.test.ts` and `fin-step.test.ts` build one end to end.
- **Section (horizontal foil):**
  - One shape, scaled to the local chord.
  - Modelled as **two independent curves**, inside and outside, each measured from the
    chord line. One model covers every foil below, and more can be added without
    changing the file format.
  - **Centre fins: always symmetric**, like a boat keel. The inside curve mirrors the
    outside, so one curve is edited. Symmetric NACA sections (NACA 00xx) are allowed.
  - **Side fins default to a flat inside face** with an editable outside curve. Both
    curves can be edited, so cambered or concave-inside foils are possible.
  - **NACA presets** (`naca.ts`): NACA 4-digit (camber, camber position, thickness)
    generates both curves, which stay editable afterwards. The convex face is the
    outside face; 00XX is symmetric. Closed trailing edge (the blade's 0.5 mm minimum
    blunts it), and thickness applied square to the chord rather than the camber
    line, so a cambered face never curls back past its leading edge: within 0.16%
    chord of the textbook shape for a 2412, 0.35% for a 4412. Other series can be
    added as further presets on the same two-curve model.
  - Section thickness always comes from the taper, and the whole section scales with
    it, so a preset keeps its camber-to-thickness ratio (a 2412 stays 2 : 12) at any
    thickness. (The first draft of this plan said camber stays a fraction of chord;
    uniform scaling is what the owner specified: the foil's thickest point scales to
    the taper.)
  - The foil may be thicker than the tab (e.g. 7.0) and overlap the box slot.
- **Taper (thickness from base to tip):** the thickness at the thickest point of the
  section, as a function of height.
  - Usually straight, then curving near the tip; that curve is how flex is controlled.
  - Example: if the taper says 8 mm at 15 mm below the tip, the section there is
    scaled to 8 mm thick.
- **Minimum thickness 0.5 mm** at the leading edge, trailing edge and tip, for rider
  safety. Sections are closed shapes (rounded leading edge, blunt trailing edge), never
  knife edges.
- **Cant:** the lean of the blade relative to the tab, 0–20°, typed by the user. Futures
  builds cant into the fin (FCS builds it into the box).
- **Left / right:** side and quad-rear fins mirror; the inside curve always faces
  inboard.
- **Placement on the tab** (added after the step 5 review; `fin-placement.ts`):
  - **Defaults are rear-aligned:** the trailing-edge root on the tab's rear end, the
    usual convention.
  - **Across the tab:** a flat inside face is flush with the tab, and a symmetric foil
    is centred. A curved inside face (most NACA foils) has its chord line flush, so
    the curve overhangs the tab inboard.
  - **Nudge arrows:** forward / back moves the fin along the tab, with a hard stop at
    the 2.5 mm front overhang and, going back, at the insertion-clearance limit below. Left / right slides the blade
    across the tab, so a strongly curved inside face can be brought back over it,
    within the range that keeps the tab under the foil (its centre plane between the
    root section's faces at their thickest point).

### Insertion clearance (agreed working model; `fin-clearance.ts`)

A Futures fin is fitted rear first: its rear slot hooks the pin at the back of the box,
then the fin rocks down about the pin until the tab seats. While tilted, anything
behind the tab swings toward the board.

Model: pivot at the rear slot's centre (3.3 mm from the tab's rear end, 6.4 mm below
the tab top). The fin must tilt until the tab's bottom-front corner clears the board:
about **9.4° for the side tab, 6.7° for the centre tab**. A point x mm behind the tab's
rear end must then sit at least `(6.4 + (3.3 + x)·sin θ) / cos θ − 6.4` above the
base: for a side fin, 0.6 mm at the rear end, 2.0 mm at 8 mm back and 3.6 mm at 18 mm back; for a centre or quad-rear tab, 0.4, 1.4 and 2.5 mm.

Agreed with the owner as a working model (defaults are not critical; what matters is
that the raised rear can be edited). Built as the `rear-clearance` rule, which reports
how much to raise the rear, and the backward nudge stops at the last clear position.
A rear-aligned fin with a flat base therefore cannot move back at all. The outline
pane should draw the line dashed behind the tab (steps 10 and 12).

### Readouts

All shown in mm and degrees:

- **Area:** the outline above the tab top; the tab is excluded.
- **Depth.**
- **Sweep:** the angle from the leading-edge root to the tip. Read-only; editing the
  outline changes it.
- **Root chord.**
- **Front overhang,** with a warning past the limit.

### Files

- Save and open `.fin.json` (versioned), plus IndexedDB autosave.
- Export STEP (AP214, mm) and STL (binary, mm).

## Design decisions

- **Placement:** inside the existing packages, not a new package.

  | Package  | New code                                 |
  | -------- | ---------------------------------------- |
  | kernel   | `packages/kernel/src/fin-design/` (pure) |
  | export   | fin STEP and STL writers                 |
  | io       | `.fin.json`                              |
  | store    | `createFinStore`                         |
  | render2d | `FinCurveEditor`                         |
  | apps/web | the `/fin` route                         |

  The route shares the SPA's offline support and desktop build. Splitting it out gains
  nothing under GPL-3.0-or-later.

- **Units:** the kernel stays in cm like the rest of the kernel. Conversion to mm happens
  at the UI, file and export edges. The STEP writer already takes a `unit` option.
- **Cant as a lean of horizontal sections:** each horizontal slice is shifted sideways
  as height increases. Thickness is corrected by 1/cos(cant), so the taper value is the
  true thickness. This keeps the blade root exactly on the tab-top plane. A true rotation
  would tilt the root and need it trimmed against that plane, which cannot be exact in
  STEP.
- **Own curve editor:** `FinCurveEditor` is new, built on `render2d`'s viewport, hit
  testing and drawing. It does not generalise `SplineEditor`, which is about 1.7k lines
  tied to `BoardState` through about 10 actions. Fin curves also need their own rules
  (fixed endpoints, rising edges, overhang limit). The board editor stays untouched.
- **Default fins:** fitted from `docs/specs/fins/side.foil` and `center.foil`, the same
  FinFoil reference outlines behind `fin-templates.generated.ts`.
- **Oracles:** BoardCAD-LE has no fin designer, so the golden-data rule is met with:
  - the tab fixture (step 0);
  - analytic cases (rectangle/triangle area, known sweep, thickness at a station);
  - topology checks (closed shells, every edge shared by exactly two faces).

### STEP topology

As built in step 5 (`packages/kernel/src/fin-design/blade-surface.ts`,
`packages/export/src/fin-step.ts`):

```
blade  3 faces: one bicubic B-spline surface wrapped around the blade, closed in u
       on a seam (outside face, trailing-edge cap, inside face, leading-edge cap),
       plus flat root and tip caps
tab    14 faces: two flat sides, then one face per profile segment: PLANE for a line,
       CYLINDRICAL_SURFACE for the slot end and the R1.0 corner
```

- **One wrapped surface, not two skins.** The 0.5 mm minimum makes the edges blunt,
  so each section is a closed loop with four corners. One surface with C0 knots at
  the corners (`uBreaks`) shares its edges with itself and the caps exactly, the way
  the board's two patches share the stringer. Corners in the outline or taper crease
  along the height the same way (`vBreaks`, added to `interpolateSurface` for this;
  the board's output is byte-identical).
- **Tip:** sections stop 0.1 mm under the tip and a flat sliver closes the blade. A
  surface pinched to a point is legal but often fails to import.
- **Accuracy:** fitted to 0.05 mm and refined until met. What remains is in the last
  0.2 mm under the tip, at the edge corners (about 0.08 mm on the defaults). CI holds
  the whole blade to the board STEP's 0.15 mm and all but the top 0.5% to 0.05 mm.
- **Touching, not overlapping (changed from the plan).** The plan sank the blade 1 mm
  into the tab. But the root foil is wider than the 6.35 mm tab (8 mm by default) and
  often longer, so a sunk blade leaves a 1 mm lip below the base outside the tab, and
  the fin would not seat. The blade and tab are two solids that **touch on the
  tab-top plane** (z = 0); CAD Combine / Join merges them. A single fused solid is
  still a possible later step.
- **Tab position across the fin:** from `tabCentreY` (flush with a flat inside face,
  centred under a symmetric foil, plus the user's sideways nudge). First built centred
  under the thickest point; changed after review, since a flat inside face is
  conventionally flush with the tab.
- **Orientation** is measured from the geometry, as for the board. Tests read the file
  back and check every edge is used once in each direction per solid, every flat face
  winds counter-clockwise about its outward normal, and every face points out.

The Part 21 encoding moved to `packages/export/src/step-writer.ts`, shared with the
board exporter, whose output was diffed byte-for-byte before and after (12 files:
test board and the three golden boards, in mm, cm and in).

Building this exposed a board STEP bug: the hull loops run clockwise, so hull and caps
use their shared edges in the same direction. Recorded as P46 in `PROPOSALS.md`.

#### Verification

OpenCascade (via `occt-import-js` 0.0.23, run outside the repo) reads each sample as
two closed solids with positive volume; blade volumes agree with the kernel's
integrated section areas to 0.1–0.2% (tessellation reads slightly low), and the tab
volume equals profile area × 6.35 mm exactly.

| date       | app                       | fins                                                  | result                                                                                                     |
| ---------- | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | OpenCascade (wasm 0.0.23) | side R 7°, side L 20°, quad rear R, centre (defaults) | 2 solids each, closed, volumes match                                                                       |
| 2026-10-15 | Fusion 360                | same                                                  | Imports; Combine / Join gives one body. Review asked for rear alignment and sideways placement (now built) |

Manual pass for Fusion (and any other CAD/CAM): imports without repair; two bodies;
Combine / Join gives one body; depth, root chord and thickness match the designer;
a 3-axis toolpath generates on each side of the blade.

### Related finding (separate fix)

The board STL (`packages/export/src/stl.ts`) writes kernel cm with no unit conversion,
so slicers that assume mm import boards 10× too small. The fin STL writes mm. The board
STL needs its own change, which is user-visible: P47 in `PROPOSALS.md`.

## Build order

Each step is independently testable and committable. The STEP prototype (5) comes
before the UI so the biggest unknown is answered first.

| #   | Step                                                                                                                                                                                                                   | Size | Model                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------- |
| 0   | Spec and fixture: `docs/specs/fins/futures-tabs.md` + JSON fixture of the three tabs. The user signs off.                                                                                                              | S    | Opus                 |
| 1   | Kernel: exact tab outline (lines + arcs) per tab type; tests against the fixture.                                                                                                                                      | S    | Sonnet               |
| 2   | Kernel: `FinDesign` model (LE/TE curves, section, taper, cant, side, tab), default fins, rule checks (overhang ≤ 2.5, rising edges, taper ≥ 0.5).                                                                      | M    | Opus                 |
| 3   | Kernel: readouts (area excluding the tab, depth, sweep, root chord, overhang). Analytic tests.                                                                                                                         | S    | Haiku                |
| 4   | Kernel: `bladeSection(design, h)`: closed foil from chord × section × taper, cant lean + cos correction, L/R mirroring, 0.5 mm minimum. Tests: thickest point = taper value; L/R mirror exactly; measured lean = cant. | M    | Opus                 |
| 4a  | Kernel: NACA 4-digit section generator → inside/outside curves, trailing edge blunted to 0.5 mm. Tests against published NACA ordinates (e.g. 0012, 2412); 00xx comes out exactly symmetric.                           | S    | Sonnet               |
| 5   | **⚠ Riskiest.** STEP of the default fin: blade skins + caps, tab faces, two solids. Part 21 writer extracted with board output byte-identical. Structural tests, plus manual import into Fusion/FreeCAD recorded here. | L    | Opus                 |
| 7   | Kernel: preview/STL mesh, two closed shells. Every edge shared by exactly two triangles.                                                                                                                               | M    | Sonnet               |
| 8   | io: `.fin.json` v1 read/write, round-trip test.                                                                                                                                                                        | S    | Sonnet               |
| 9   | Store: `createFinStore` with undo; pure `fin-edits.ts` enforcing the rules (clamped drags); nudge actions over `nudgeFore` / `nudgeLateral`.                                                                           | M    | Sonnet + Opus review |
| 10  | render2d: `FinCurveEditor` (drag points/handles, rule callbacks).                                                                                                                                                      | M    | Sonnet               |
| 11  | Web: `/fin` route, tab picker, L/R, cant 0–20°, mm readouts, overhang warning, fore/aft and sideways nudge arrows (with keyboard shortcuts in `shortcuts.ts`).                                                         | M    | Sonnet               |
| 12  | Web: outline pane (over the true tab), section pane (both curves; symmetric lock for centre; NACA preset picker), taper pane.                                                                                          | M    | Sonnet               |
| 13  | Web: 3D preview (the `Fins3D.tsx` pattern, `frameloop="demand"`).                                                                                                                                                      | S    | Sonnet               |
| 14  | Web: IndexedDB autosave + save/open `.fin.json`.                                                                                                                                                                       | S    | Sonnet               |
| 15  | Web: STEP/STL export buttons; docs page, `docs/registry.ts`, precache entries.                                                                                                                                         | S    | Haiku                |
| 16  | Export: STL in mm from the step 7 mesh.                                                                                                                                                                                | S    | Haiku                |
| 17  | e2e: load the default fin, drag a point, area and sweep change, STEP downloads.                                                                                                                                        | S    | Haiku                |

Step 6, the single fused solid, is deliberately absent; see above.

### Risks

- **Step 5:** a closed solid that real CAD packages accept. Structural tests catch
  malformed files but not every importer quirk. Manual import into Fusion and FreeCAD is
  the acceptance check, as for the board STEP.
- **Tab transcription (0–1):** the dimensions come from screenshots of box-slot drawings,
  so the user's sign-off on the fixture is the gate.
- **Rising-edge rule (2, 10):** clamping drags must feel natural. If it fights the user,
  revisit slicing along the span line instead of horizontally.
