# Swallow Tail tool (print version)

Owner design, 2026-11. A panel in the Shape tab cuts a swallow notch into the tail and
sets how its inside wall climbs to the deck; the notch is then shaped in the outline view.

## What is stored

- **The notch is the outline.** Apply rewrites the tail of `board.outline`
  (`swallowTailOutline`): the notch bottom on the stringer at `x = depth`, the tip at the
  tail where the outline was `width / 2` wide, joined straight. Concave tails were
  already supported (`outline-cutout.ts`), so volume, area, the mesh and the exports all
  read the notch from the outline as before. Dragging the stringer point (the depth) and
  the tip's handle (the curve) are ordinary outline edits.
- **The wall is `board.swallow`**, `{ kind: 'bevel', angle }` (degrees from upright) or
  `{ kind: 'round', size }` (radius / thickness). Absent: the upright wall concave tails
  always had, and the old meshing path, unchanged.

## The wall

At height `h` of a wall `t` thick (deck less bottom at the stringer), the wall stands
`o(h)` back from the notch line: `h·tan(angle)` for a bevel; 0 up to `t − r`, then a
quarter round of `r = size·t`. It is measured along the station, as `o / |t.x|` out from
the bottom's notch edge, `t` the notch line's direction where it crosses the station, so
it changes smoothly everywhere. (Offsetting the line square to itself, or by true
distance, both jumped where the line curls round a tip to run across the board: the
offset ran forward off the stations there, leaving a step across the deck about a
wall's width from the tail and a ragged deck line behind it; owner board, 2026-11.)
Where the wall would take more than 60 % of the foam between the notch and the rail
(toward a tip), it is made smaller whole, about its top: a round stays a round of
smaller radius, a bevel keeps its angle, and it stands upright below. (Squeezed across
only, it stood steep with a pinched corner at the deck: a nob on each tip.) Its points
are spaced on the full-size wall and carried onto the smaller one, so they stay on the
round as it shrinks. The top, `o(t)`, is the deck
line drawn dashed.

Forward of the notch bottom the offset lines still meet on the stringer, further forward
the higher they are: the deck is notched in a V that closes where the deck line meets the
stringer. Dragging that point solves for the angle or size that puts it there
(`wallForDeckApex`, bisection; the deck line's end moves monotonically with either).

## Squeeze

A notched station's section is squeezed into the foam beside the notch: the bottom from
the notch's edge, the deck from the deck line (`notchSqueeze`). Only foam within a reach
of the edge moves: 4 cm, or 2.5 notch widths where that is more, up to the rail, as
`edge·(1 − px/reach)^k` (k = 2, easing to 1 near a tip so it never folds; every limit
rounded). Squeezed evenly out to the rail, as upright swallows still are, the whole
section moved with the notch, and where the notch closes onto the stringer that motion
stopped dead: a faint crease across the deck and rail.

The squeeze only spreads the deck's points; each sits at the board's own deck height
where it lands, so the deck in the notch is the board's deck cut away at the deck line.
(Carried with its point, the deck's height at the stringer rode out to each tip, the
deck rising up to 7 mm toward the tips: a kick, owner report 2026-11.) The bottom is
still squeezed with its heights, as it carries the channel cut; on the owner's board
that differs from the board's own bottom by under 1 mm. Volume and the surface lookups
(`bottomZAt`, `deckZAt`) follow the same squeeze; volume is integrated off the squeezed
section, and the foam the wall takes agrees with the mesh's to 0.01 % of the board.

## Mesh

`tessellateCutout` with a set wall: each half ring is the section (bottom points squeezed
into `[yB, yOut]`, deck points from the rail's widest point into `[yD, yOut]`), then
eight points down the wall. The wall ends on the ring's first point inside the notch, or
on the stringer in the V, so no wrap edge is closed; the halves meet there. A row with no
wall (past the deck line's point) is fanned to from the last row that has one, and the
step out of the bottom's notch gets the wall's upright foot as one triangle. Stations
are added at the notch bottom and across the V, and packed toward each end. The end
stations stay 1.6 mm in, where a section is still well formed, and are fanned out to a
point on the board's own end: each tail pod to a point of its own, the two halves of
the nose to one on the stringer. (Capped flat there instead, as hand-folded swallows
still are, a round nose came out cut square, centimetres wide.) Tests check the mesh is closed (every
edge shared by two triangles) for bevel, round and upright, at STL density too.

## Volume

Each station's area is integrated off its squeezed section plus the wall. The area turns
sharply at the notch bottom and the deck line's point, which the adaptive integral
stepped over (37 cm³ high on a test board), so it is split there (`swallowBreaks`).
Boards without a set wall integrate exactly as before (their even-squeeze estimate reads
about 0.3 % under their mesh on a test board; left as it was).

## Channels in the notch

A channel's walls are anchored to ring points (`anchorFractions`) so each wall is one
unbroken mesh edge. In a notch the bottom starts off the stringer, and the anchors used
to be measured from there, millimetres off the walls the cut is made at (which are
measured from the stringer). The cut's edge then fell between whichever ring points were
nearest at each station and hopped between them: a jagged edge in the notch (owner
report, 2026-11; upright walls too). Now an anchor that fits on the bottom stays at its
wall (`offNotch`); those inside the notch are scaled, in order and apart, onto the first
2.5 mm of the bottom, a band that closes as the notch reaches the stringer.

Walls squeezed past the bottom (held on past a channel's end to a narrow nose, say) were
squeezed exponentially, which put walls a few centimetres past it a micron apart, and a
square step's two wall points (2 µm apart) on one: edges shared by dozens of faces. The
squeeze is now rational (the same at its knee), and anchors squeezed past the bottom
keep at least 1e-4 of the profile apart.

The wall's points are spaced evenly along its profile, not its height, so a rounded
wall's turn into the deck is as finely sampled as its upright part.
