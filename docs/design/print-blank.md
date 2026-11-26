# Printing a blank: fin box cavities (print version, owner request 2026-11)

**Export → STL blank for printing…** writes the board as one closed solid, channels cut,
with a cavity in the bottom for each fin's box or plug and no fins. The real boxes are
then set in resin, as in a foam blank.

## Cavity outlines (`packages/kernel/src/fin-cavities.ts`)

No maker publishes cavity drawings; they sell router jigs. So the outlines are what the
jigs cut. Gecko Surfboards publishes 3D-printed jigs for the real hardware
(geckosurfboards.com/surfboard-building-router-jigs, 8 mm thick, run with a 3/8"
straight bit in a 19.5 mm guide bushing). Each opening was sliced from its STL and
brought in all round by the cutter's offset, (19.5 − 9.525) / 2 ≈ 5 mm:

| Cavity           | Jig opening (mm) | Cavity (mm)  | Published hardware (mm)     |
| ---------------- | ---------------- | ------------ | --------------------------- |
| Futures flange   | 164.0 × 41.5     | 155.1 × 31.5 | box 149 × 31.75 (5⅞" × 1¼") |
| Futures box body | 139.5 × 22.5     | 129.5 × 12.5 |                             |
| FCS II plug      | 120.6 × 46.9     | 110.6 × 36.9 | plug at most 110 × 37.5     |

The FCS II jig's two end ticks (alignment marks) were removed. Its outline is symmetric
end to end, so its orientation along the fin doesn't matter.

Depths, all editable in the dialog:

- **Futures flange step:** 2.4 mm. That is the 1.587 mm flange plus 0.8 mm for resin
  (owner).
- **FCS II plug:** 18.5 mm. Plugs vary, and this is safe (owner).
- **Futures box body:** 3/4" for F boxes (thruster sides, quad fronts) and 1/2" for X
  boxes (centres, quad rears), each plus 0.8 mm. These come from Fiberglass Hawaii's
  placement guide, not a measurement.

Each cavity is centred on its fin's base and runs along it, toe included. It stands
square to the uncut bottom there, as a jig sitting on the board cuts it. Boxes and
plugs carry the fin's cant themselves. Depth is measured from the bottom as cut,
channels included, so a box sits flush. Glass-on fins get no cavities. FCS X-2 plugs
aren't supported yet.

`cavityProblems` warns when a cavity leaves under 3 mm of board above its floor.

## Cutting (`packages/export/src/print-blank.ts`)

The cavities are cut with Manifold (`manifold-3d`, Apache-2.0, WebAssembly):

1. The hull is the kernel's mesh (`tessellateBoard`), merged.
2. Each cavity step is its outline extruded along the cavity's axis, from 2 cm outside
   the bottom to its depth.
3. All the cavities are subtracted at once. Fins are left off.

It is a separate entry point, `@openshaper/export/print-blank`, loaded dynamically
(`apps/web/src/print-blank-loader.ts`), so the editor fetches the 46 KB chunk and the
541 KB `.wasm` only on that export. The `.wasm` is precached, so blanks export offline.

Two things this needed elsewhere:

- **Content-Security-Policy.** `script-src` gains `'wasm-unsafe-eval'`, which lets the
  page compile WebAssembly and nothing else: no `eval()`, no `new Function()`.
- **Mesh winding.** A solid modeller rejects a shell whose edges don't each run once
  each way. Both of `tessellateBoard`'s end caps had been wound the same way as their
  bands since the loft was written; the shell was oriented by its majority and nothing
  read edge directions. They are now wound against their bands, on both the
  single-loop and the cutout paths. That changed the characterization snapshots'
  index checksums and normal sums, and nothing else: positions, counts and bounds are
  identical. `tessellate-winding.test.ts` pins it. The cutout path also repeats points
  where its halves meet; Manifold's merge welds those.

On the owner's square-tailed channel board, a Futures or FCS II thruster blank cuts in
about half a second in the browser, as a closed solid of about 173,000 triangles.
