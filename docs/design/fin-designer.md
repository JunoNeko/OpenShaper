# Fin designer — standalone Futures fin design for CNC and print

Status: **all steps done (0–17, with 4a and insertion clearance); user-testing round 1 (R1–R7) done; round 2 (S1–S3, T1) done; foil slices (T2–T7) done.** Open follow-ups: P46 / P47 in `PROPOSALS.md` (board STEP loop winding, board STL units); section drags take ~5 ms per move (up to ~60 ms when clamped); STEP export runs on the main thread (~1 s), as the board's does. The `/fin` page edits the outline, foil section and taper, with a 3D preview, autosave, `.fin.json` Open / Save and STEP / STL export; documented at `/docs/fin-designer`. Tab spec and fixture: `docs/specs/fins/futures-tabs.*`.
Kernel: `packages/kernel/src/fin-design/` (tab outline, `FinDesign` model, defaults,
rules, readouts, blade sections, blade surface, placement, NACA presets, meshes); export: `fin-step.ts`; io: `fin-json.ts`; export: `fin-stl.ts`; store: `fin-store.ts`, `fin-edits.ts`; render2d: `FinCurveEditor.tsx`, `fin-curve-view.ts`; web: `apps/web/src/fin/`, route `/fin` (offline, like `/app`). This is the agreed scope and build order. Update the status line as steps land.

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

## User testing, round 1

Feedback from the owner's first session on the deployed `/fin`, and the agreed fixes.

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Size | Model                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------- |
| R1  | **Done.** **NACA picker bug.** It was an `<input list>`, and the browser filters a datalist by the current text, so after one Apply only that code was offered. Replace with a preset dropdown plus a free 4-digit field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | S    | Sonnet               |
| R2  | **Done.** **Left/right named bottom-up**, the fin makers' convention (the board seen from below, nose up). The geometry is unchanged; the names swap. No saved files need keeping, so `.fin.json` `hand` simply flips meaning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | S    | Sonnet               |
| R3  | **Done.** **⚠ Riskiest. Swappable panes.** Large pane left (profile at first), three small panes right (foil, thickness, 3D); an icon on a small pane swaps it with the large one. The large pane's toolbar holds its view's controls: profile — depth, point tools; foil — symmetric / flat / NACA, point tools; thickness — root thickness, point tools; 3D — side, cant, nudge. Readouts and rule warnings stay visible. Nudge arrows sit directly under the 3D view when it is small. Phones stack the views, large first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | L    | Sonnet + Opus review |
| R4  | **Done.** **Point tools** on every curve: add (midway along the selected span), delete, smooth, corner. NACA presets drop from 17 to 6 points per face (`NACA_SEGMENTS` 5): worst error 0.011% of chord (0.012 mm on a 110 mm chord), measured; 4 points would be 0.065%, 3 points 0.38%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | M    | Sonnet               |
| R3a | **Done.** **Raised-rear underside.** Horizontal sections below a raised rear ended on its underside, so the underside was the sections' 0.5 mm trailing edges: a thin flap. Now the underside is found (`findRaisedRear`: the outline's end, walking back from the trailing-edge root, while it runs backward and rises at under 45°), and below its corner each section's foil runs over the full chord, to the trailing edge carried down from the corner along its tangent, and is cut off at the underside (`foilCut`). The cut ends form the underside, with the foil's thickness: 4.7 mm at the tab's rear end on the owner's test fin, thinning to 0.5 mm at the corner. Sections stay horizontal, so the surface, mesh and STEP topology are unchanged; the underside gets rows of its own (`raisedRearHeights`) and its own deviation slices. Fins without a raised rear are unchanged. Owner's fin: fit deviation 0.038 mm overall (as before), 0.0096 mm on the underside; OpenCascade reads two closed solids. | L    | Opus                 |
| R5  | **Dropped.** A Fit button: the owner found the existing pan and zoom cover it (right-click pan dropped earlier for the same reason).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —    | —                    |
| R6  | **Done.** **Thickness pane upright:** root at the bottom, tip at the top, to the fin's real height so it lines up with the profile. Needs a view transform in `FinCurveEditor` beyond `yScale`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | M    | Sonnet, Opus checks  |
| R7  | **Done.** Docs page, e2e, full CI gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | S    | Sonnet               |

Also found in testing (fixed alongside R1–R3): the 0.5 mm minimum was a plain max(t, 0.5 mm),
which left a visible crease where the foil ran down to it, along the trailing edge and at the
tip. The padding now blends in over a 0.5 mm thickness band (`padThickness` in `blade.ts`, a C2
polynomial smooth max that is exactly 0.5 mm at zero foil thickness). Each section is scaled
through its inverse (`unpadThickness`), so after padding the thickest point is exactly the
taper's thickness, and near the tip the foil shrinks smoothly into a uniform 0.5 mm slab instead
of switching to a plain max. The foil is untouched where it is 1 mm or thicker. The blade fit
also closes its seam exactly now (the shared surface solver reproduces the loop's ends only to
~1e-15 cm).

## User testing, round 2

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Size | Model |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----- |
| S1  | **Convex to the edges.** The 0.5 mm minimum was padding where the foil was thin, which left the last few percent of the chord parallel-sided (a flat). Now the foil is scaled to the taper less the minimum and the minimum is added all the way along (symmetric: half each face; otherwise the outside), so faces stay convex to edges that end at 0.5 mm. The thickest point is still exactly the taper. Replaces `padThickness` / `unpadThickness`. NACA proportions now hold above the minimum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | S    | Opus  |
| S2  | **No creases from sharp outline bends.** Stretching the foil edge to edge on horizontal slices ties every point to both edges, so a sharp bend (the owner's hooked tip: the trailing edge turns from vertical to nearly level 97 mm up) shifted whole slices at once and creased the blade right across. The foil is now laid over smoothed copies of the edges (`foilEdges`: a Gaussian-weighted local line fit over 5% of the chord, exact for straight edges, pushed outward so it never lies inside the blade), and over the last 30% of the chord at each edge it is drawn back to the real edge (`FIN_EDGE_PIN`, a C2 blend), so edges end at exactly 0.5 mm. A first version cut the foil off at the real edge instead; in Fusion that bulged the trailing edge wherever it bent (up to 1.6 mm), so cutting now applies only on a raised rear's underside (`findRaisedRear`, restored from round 1 for that alone, fading out 3 mm above the corner), which keeps 2.5–2.6 mm at the tab's rear end. On the hooked tip the face's worst bend across the turn fell from 19 /cm to 3 /cm up to 30 mm behind the tab; in the last 5–15 mm before the edge it follows the edge's own sharp turn. Rows, mesh rings and deviation slices are spaced by how far the edges travel (`bladeRowHeights`), not height. STEP fit: defaults 0.022–0.028 mm, the owner's raised-rear fin 0.022 mm (was 0.038), the hooked tip 0.078 mm, all in the top 1% of the height; OpenCascade reads every file as two closed solids. | L    | Opus  |
| S3  | **No crease line at outline corners.** The STEP fit creased the whole blade (a C0 knot all the way round) at the height of every corner point in the outline, which Fusion draws as a line across the blade. With the foil laid over smoothed edges only the edge itself has the corner, so outline corners no longer crease the surface (taper corners still do: they kink the thickness across the section). The fit turns each edge corner between rows packed around every outline point's height and above the root (±0.05–4 mm), and its v-parameters follow the edges' travel (`SurfaceFitOptions.vParams`, new and unused by the board, whose output is unchanged) instead of averaging over every point of the section, which let the many points that barely move outvote a trailing edge running nearly level. Dense check (200 slices × 157 points): defaults ≤ 0.019 mm, the owner's fins ≤ 0.038 mm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | M    | Opus  |
| T1  | **Raised-rear twist.** Owner saw a distortion where a raised rear's underside turns up into the trailing edge. Measured on finely sampled sections, the true shape there bends no more than elsewhere (≈3.5 /cm); the visible fault was the fit: its worst error, 0.07 mm, sat on the narrow trailing-edge strip just below the corner. The denser rows of S3 bring it to ≤ 0.038 mm. The thick-to-thin switch stays above the corner (3 mm, `REAR_FADE`): moving it below made a real kink (56 /cm), and longer fades thicken the edge above the corner more (0.71 mm at 3 mm, 1.05 mm at 10 mm).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | S    | Opus  |

## Foil slices

Asked for in round 2 testing, as manual control where the automatic shape needs help.

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Done |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T2  | Model: `FinDesign.slices` (height as a fraction of the depth, and a foil), lowest first, at least `FIN_SLICE_MIN_GAP` (2%) apart and from the root and tip; rules check every slice's foil and name it. `.fin.json` version 2 adds `slices`; a fin without any is still written as version 1, so it opens in the designer before slices.                                                                                                                      | ✓    |
| T3  | Blade: `foilAt(design, eta)` blends the foils either side with `smoother` (6t⁵ − 15t⁴ + 10t³), easing flat into each slice, so the shape changes smoothly through it (no line at a slice); above the top slice it stays as that slice. Each height scales its own blended foil to the taper, its thickest point found per height; the 0.5 mm share between faces blends too (½ symmetric, all outside otherwise). STEP, STL and the preview need nothing new. | ✓    |
| T4  | Profile: **Add slice** (halfway up the biggest gap); slices drawn as level guides, dragged to move (one undo step per drag), picked to select their foil (`FinCurveEditor` `guides`).                                                                                                                                                                                                                                                                         | ✓    |
| T5  | Foil view: tabs (Root, then each slice by height), **Remove slice**; NACA, inside face and point tools act on the selected foil (`activeFoil` in the store; `getFoil` / `withFoil`).                                                                                                                                                                                                                                                                          | ✓    |
| T6  | Thickness view: the same guides, at the fraction of the depth, draggable.                                                                                                                                                                                                                                                                                                                                                                                     | ✓    |
| T7  | Docs (Foil slices section), e2e (add, shape, export, save as v2, reopen), full gate.                                                                                                                                                                                                                                                                                                                                                                          | ✓    |

## FCS single tab base

Asked for by the owner for small canard fins, which plug into an FCS 1 style single plug.

- `FinDesign.base`: `futures-side` (Futures 3/4"), `futures-centre` (Futures 1/2"), `fcs-single`. Each position defaults to its Futures tab (`defaultFinBase`); `.fin.json` writes `base` (version 2) only when it differs.
- FCS single tab (`fin-tab.ts`): a plain block, 20.5 mm long × 13.5 mm deep × 6.35 mm thick, held by a grub screw in the side of the plug (no notch or slot). It drops straight in, so the Futures front-overhang limit, the rear-pin clearance rule and line, and the clearance stop on nudges don't apply. Instead the tab must sit wholly under the blade's root (`tab-cover`). The plug carries the cant (0°, 5° or 9°), so the fin has none (`cant` rule; the field is greyed out). A flat inside face sits flush with the tab, as on Futures.
- `placeOnBase`: moving onto FCS centres the root over the tab and zeroes the cant; moving onto Futures rear-aligns the fin.
- STEP/STL/preview take the tab from `finTabOutline(base)`; OpenCascade reads the FCS block as an exact 20.5 × 13.5 × 6.35 mm solid (1757.4 mm³).
- Canard starting fin (`defaultCanard`, New fin → Canard, left / right): the owner's canard (69.3 mm base, 80.6 mm deep, 8 mm root, flat inside), on the FCS tab, centred, no cant. `FinStart` (a position or `canard`) is what New fin takes.

Not ours: the console's `THREE.Clock` deprecation comes from `@react-three/fiber` (harmless,
goes with a fiber update); `share-modal.js` is not in the repository, most likely a browser
extension.
