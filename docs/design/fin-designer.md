# Fin designer — standalone Futures fin design for CNC and print

Status: **steps 0–2 done.** Tab spec and fixture: `docs/specs/fins/futures-tabs.*`.
Kernel: `packages/kernel/src/fin-design/` (tab outline, `FinDesign` model, defaults,
rules). This is the agreed scope and build order. Update the status line as steps land.

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
- **Section (horizontal foil):**
  - One shape, scaled to the local chord.
  - Modelled as **two independent curves**, inside and outside, each measured from the
    chord line. One model covers every foil below, and more can be added without
    changing the file format.
  - **Centre fins: always symmetric**, like a boat keel. The inside curve mirrors the
    outside, so one curve is edited. Symmetric NACA sections (NACA 00xx) are allowed.
  - **Side fins default to a flat inside face** with an editable outside curve. Both
    curves can be edited, so cambered or concave-inside foils are possible.
  - **NACA presets:** NACA 4-digit (camber, camber position, thickness) generates both
    curves, which stay editable afterwards. Other NACA series can be added later as
    further presets on the same two-curve model.
  - Section thickness always comes from the taper. A NACA thickness digit sets only the
    _shape_ of the thickness distribution; camber stays a fraction of chord.
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

```
blade: outside skin + inside skin   B-spline surfaces, sharing seam edges at LE and TE
       root face + tip cap          planes (the 0.5 mm minimum means the tip is a small
                                    flat cap, not a point where the surfaces close up)
tab:   planar faces with line and circle edges (U-slot, R1.0 corner, V-notch)
```

This mirrors the board STEP: two hull patches sharing the stringer seam, plus two flat
caps. So the seam sharing, measured orientation and structural tests in
`packages/export/src/step.ts` carry over (see `docs/design/step-export.md`).

The blade root is sunk 1 mm into the tab and **the two are written as two overlapping
solids in one file**. This was chosen as the easiest path; the user combines them in
CAM if needed. A single fused solid needs exact curve trimming at the tab edges. It is a
possible later step, not part of this plan.

The Part 21 writer is extracted from `step.ts` for reuse. **The board STEP output must
stay byte-identical** (`step.test.ts` already asserts byte-identical output for the
same inputs).

### Related finding (separate fix)

The board STL (`packages/export/src/stl.ts`) writes kernel cm with no unit conversion,
so slicers that assume mm import boards 10× too small. The fin STL writes mm. The board
STL needs its own change, which is user-visible and so goes in `PROPOSALS.md`.

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
| 9   | Store: `createFinStore` with undo; pure `fin-edits.ts` enforcing the rules (clamped drags).                                                                                                                            | M    | Sonnet + Opus review |
| 10  | render2d: `FinCurveEditor` (drag points/handles, rule callbacks).                                                                                                                                                      | M    | Sonnet               |
| 11  | Web: `/fin` route, tab picker, L/R, cant 0–20°, mm readouts, overhang warning.                                                                                                                                         | M    | Sonnet               |
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
