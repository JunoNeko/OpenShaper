# Smooth station lofting (`yForX`, cardinal station spline, and end-cap winding)

## 1. Machine-precision `yForX`

`tForX` stops once `x` is within the legacy `POS_TOLERANCE` (0.03 mm). Where an outline
or rocker curve is steep in `x` (especially approaching a pointed nose), that 0.03 mm
tolerance in `x` is multiplied by the slope `dy/dx`, and discrete iteration-count jumps
turn `y(x)` into a staircase of up to ~0.3 mm steps that show up as nose creases in the
3D mesh.

`yForX` now runs up to 8 Newton polish steps from the `tForX` starting guess until
`|x - x(t)| < 1e-12`, removing the staircase while keeping `tForX` itself unchanged for
legacy-compatible callers.

## 2. Cardinal station spline (`STATION_TENSION = 0.5`)

Previously `loftSection` blended linearly between the two bracketing cross-section
stations. That guarantees exact interpolation at each station, but creates a C⁰ tangent
corner across the hull at every interior station whenever neighbouring rail shapes differ.

`splineWeights` replaces the linear blend with a local cubic Hermite / cardinal
(Catmull–Rom) spline over the real interior stations:

- **Interpolation & C¹ continuity:** Passes through every station exactly with a shared
  longitudinal slope from both sides, eliminating station creases. At the outermost real
  stations the slope is clamped to 0 so the spline joins the held tip profiles cleanly.
- **Local support:** Each interval reads at most four stations (its two endpoints and one
  neighbour either side), so editing a station only affects adjacent intervals.
- **Why `STATION_TENSION = 0.5`:**
  - `tension = 1.0` collapses to zero slopes at every station (C¹ flat spots / pinching
    between stations, or piecewise linear without Hermite easing).
  - `tension = 0.0` (standard un-damped Catmull–Rom) uses the full secant slope across
    neighbours, which swings noticeably when rail presets change sharply between unevenly
    spaced stations.
  - A global clamped C² cubic spline was also evaluated: it is smoother still, but
    inserting a station reshaped the hull globally by up to ~4 mm (1.3% volume shift).
  - **`STATION_TENSION = 0.5`** halves the cardinal tangent swing. It preserves exact C¹
    continuity across every station and local 4-station support while cutting overshoot in
    half (keeping golden-board station-insertion shift well under a millimetre and
    preserving convex rail zones on smooth transitions).

## 3. Consistent end-cap winding

Both `capEnd` (single-loop boards) and `capRow` (tail-cutout boards) previously wound
their end-cap triangles in the same direction as the adjacent band edges rather than
opposite to them. `orientOutward` fixed the bulk shell by majority normal direction,
leaving the two end caps inverted relative to the side bands. Reversing both end caps
makes every tessellated board a consistently oriented closed manifold shell.
