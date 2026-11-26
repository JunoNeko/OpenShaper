# Fin integration: OpenShaper and OpenFinShaper (phase 1)

Owner design, 2026-11 (newfinUI, finchooser). Two kinds of people: those who want
generic fins on the board to tune the tail, and those who design fins and shape at once.

## One kind of fin

Every fin on a board is a fin design (`fin-design/`), the same thing OpenFinShaper edits.
`FinSpec.design` holds it, and `base`, `depth`, `foil` and `cant` follow from it
(`withFinDesign`). Boards from before keep their generic blades (no `design`) until a fin
is chosen for them.

- **Library** (`fin-library.ts`): OpenFinShaper's starting fins (side, centre, quad rear,
  twin, keel, single) in sets per setup (Thruster, Quad, Five-fin, Twin, Keel, 2+1,
  Single) and sizes S/M/L. M is a medium (112 mm thruster side); S and L are 6 % in
  depth, the base 80 % of that, held back further if the designer's rules
  (`validateFinDesign`) would otherwise fail (overhang, a small keel's rear clearance).
  A test checks every setup × system × set × size against those rules.
- **Tabs:** Futures sides 3/4", rears and centres 1/2"; FCS II and X-2 on FCS 1 tabs;
  singles and a 2+1's centre on a US box whatever the system (`baseFor`, `placeOnBase`).
- **Fin dot:** every fin measurement is to the fin dot, the bottom of the trailing edge
  (owner, 2026-11): `trailingFromTail` and `insetFromRail` are the dot's, toe turns about
  it, and dragging a fin moves its dot. On a fin with a raised rear (`findRaisedRear`) the
  dot is under the corner where the trailing edge meets the rear's underside; otherwise
  it is the trailing-edge root (`finDotX`). The box follows the fin: its slot's back end
  is the fin's own distance from the dot to the back of its tab, so a different fin moves
  the box, not the dot. The outline view draws the dot, the slot and the flange or plug.
- **Who owns what:** the board places a fin (distance from the tail, inset from the rail,
  toe-in, all to the dot); the fin owns its shape and its cant. On FCS the plugs carry the cant: 5° or
  9° for front sides and quad rears, 0° for a centre (`plugCant`, `plugCantFor`), added
  to the blade's own (0 on FCS tabs).
- **Choosing:** a set for every fin at a size, or one fin alone (and its mirror while
  Symmetrical is on) from the library fins its role takes (`withFinSet`,
  `withLibraryFin`). The panel shows the set, or "Mixed".
- **Storage:** each design is stored in the `.board` file as the `.fin.json` document
  OpenFinShaper writes; a damaged one opens as a plain fin.

## 3D and clearance

- The 3D view and the STL draw a designed fin as OpenFinShaper's blade (`fin-board.ts`):
  the designer's frame turned over onto the board (a rotation, so faces stay outward),
  the tab's middle on the fin's position, the root on the bottom (`bottomZAt`), toe and
  any plug cant applied. The tab stays inside the board and is not drawn.
- **Boxes** (3D toolbar, on by default) draws each Futures flange or FCS II plug outline
  on the bottom (`finBoxPatches`, from `finCavities`).
- The Fins panel lists `cavityProblems`: a box with under 3 mm of foam above it, read at
  the box (a side box near a thin rail is where it comes through the deck); a box or
  flange within 10 mm of the rail, or past it in plan; a box across a channel wall.

## Your own fins

- **My fins** (`my-fins.ts`): an IndexedDB store of named `.fin.json` texts, newest first,
  fed by imported `.fin.json` files (such as custom fins designed in OpenFinShaper); the
  chooser lists them with Use and delete. A fin from it keeps its name on the board
  (`FinSpec.name`), handed per side and set on the board's tab (`setOwnFin`).

## Next (phase 3)

US box and Gearbox as board systems.
