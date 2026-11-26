# Bottom channels (print version, owner request 2026-11)

Channels are grooves cut up into the bottom, usually running out through the tail. The
owner wants them for printed boards, typed in as numbers for straight ones and drawn for
curved ones (the reference board: one wide channel centred on the stringer, its walls
bowing out mid-board and flaring to the swallow tips).

## Model (`packages/kernel/src/channels.ts`)

A channel is two walls drawn in plan, a depth along the board and a wall shape:

| Field   | What it is                                                                        |
| ------- | --------------------------------------------------------------------------------- |
| `outer` | Spline in the outline's frame: x from the tail (cm), y out from the stringer (cm) |
| `inner` | The same, or `null` for one channel centred on the stringer                       |
| `depth` | Spline of x against cut depth (cm); the channel is as long as this curve          |
| `wall`  | `square` (vertical step), `bevel` (width), `round` (radius) or `scoop`            |

Each channel is cut on both sides.

## Typed-in or drawn (`channel-layout.ts`)

`BezierBoard.channels` is one of two kinds:

- **Typed in:** `{ from: 'numbers', params }`. The curves are generated from the numbers
  and the board each time (`layoutChannels`, memoised per board). Channels that follow
  the outline therefore follow it as the outline is edited.
- **Drawn:** `{ from: 'drawn', channels, params? }`. This is for walls reshaped by hand
  (step 4). It keeps the numbers the channels started from.

`boardChannels(b)` turns either kind into curves for the loft. Straight channels are
just straight walls, so there is one shape everywhere downstream.

The numbers (`ChannelParams`) are laid out from one cross-section (see "Laid out from a
cross-section" below):

| Number     | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `count`    | Channels across the whole board; an odd count puts one on the stringer            |
| `wall`     | Section: step (with `radius` top and `lip` bottom), scoop or wave                 |
| `width`    | Each channel's width, side by side, at the station                                |
| `depth`    | How deep they are cut                                                             |
| `inner`    | From the stringer to the first wall, there                                        |
| `follow`   | 0 walls parallel to the stringer, 1 each keeps its share of the half-width        |
| `start`    | Where they start toward the tail; 0 runs them out through it                      |
| `end`      | Where they end toward the nose                                                    |
| `station`  | The cross-section they are laid out from: width, offset and follow measured there |
| `fullFrom` | Full depth from here; fading in from nothing at `start` (at `start`, no fade)     |
| `fullTo`   | Full depth to here; fading out to nothing at `end` (at `end`, no fade)            |

Where a number leaves nothing to cut, `boardChannelProblems` says why.
`defaultChannelParams(b, x)` starts four 5 cm steps 5 cm off the stringer, laid out from
`x`, at full depth out through the tail and fading out over the front half of their
length.

The panel is in the sidebar's Shape tab (`ChannelPanel.tsx`), and every change is one
undo step (`setChannels`). Channels are saved in the `.board` file (`board-json.ts`, an
optional `channels` block, still version 2), autosave and share links. Legacy `.brd`
has no place for them.

The print version routes the board editor at `/app` again; the public OpenShaper site
serves only the fin designer. The precache guard no longer rejects the editor's code,
but its page still stays out of the precache.
`BezierBoard.channels` is absent on a board without channels, which is therefore exactly
what it was before: `tessellateBoard`, the STL and every characterization snapshot are
unchanged, byte for byte.

## How the hull is cut (`loft.ts`)

Not through the cross-sections. They are sparse stations blended in between, which would
smear a channel's fade, and could keep its walls sharp only if every station had
matching points on them. Instead:

1. **The bottom is lifted.** A point before the station's widest point (`bottomEnd`) is
   raised by `channelDepthAt(x, y)`. The lift is vertical, not along the normal: channels
   sit on the flat middle of the bottom, within a few degrees of level, and a vertical
   lift can't fold the surface.
2. **Points go on the walls.** `channelAnchors` lists where each ring needs a point:
   - both sides of a square wall, 1 µm apart;
   - across a bevel or round;
   - six spread over each floor.

   Their number never depends on x, because the mesh joins rings point by point.

3. **Walls stay one edge.** `stationRing` takes the board's ladder (`ringFractions`) and
   the anchors at a reference station, and fixes the order of all of them once per board.
   Each other station moves the anchors to its own walls; every other point keeps its
   share of the gap it sits in. So anchor j is the same point index in every ring, and a
   wall is an unbroken edge of the mesh rather than a zigzag.
4. **Anchors that don't fit the bottom are moved onto it.** This happens where a
   channel is designed off the bottom near the tail, toward a pointed tail (where walls
   are held past the channel's end), and in a swallow's notch. Clamping would pile the
   anchors onto one point, which a welded mesh turns into edges shared by four faces.
   Instead `ontoBottom` maps them with a strictly increasing function that is continuous
   along the board:
   - every anchor short of the last centimetre of the bottom keeps its exact place;
   - the anchors past it are squeezed smoothly into that band;
   - only where the anchors run past twice the bottom's reach (a pointed tail) does it
     blend over to scaling them all in.

   So a channel designed off the rail loses only its own wall there. The first version
   scaled every anchor in whenever any ran off. On the owner's board, an outer channel
   11 cm out on a tail 10.6 cm across the half moved the shared wall at 5.5 cm off its
   place, which smeared it into a 1 cm ramp near the tail: a scallop.
   Where a channel fits, nothing moves.

Both loft paths do this: `loftRing` (ordinary tails, the 3D view) and `tessellateCutout`
(swallow and fish). So does the STL writer's own ring sampler (`export/src/stl.ts`).

Measured on the golden shortboard, exporting STL at the default 0.5 cm face size:

| Board                           | Time   | File size |
| ------------------------------- | ------ | --------- |
| Plain                           | 59 ms  | 7.6 MB    |
| Four square channels            | 108 ms | 9.1 MB    |
| The swallow, one curved channel | 131 ms | 8.4 MB    |

### Closing the ends (owner's tail_web, 2026-11)

Channels that run out through a blunt tail leave its outline notched. Every end used to
be closed with a fan: from a hub at the centroid, or to an apex at the tip when the end
looked pointed. A fan covers only a convex outline, so its triangles crossed the
channels' mouths in a web. On a board with channels, blunt ends are now closed by
`triangulatePolygon` (ear clipping, `polygon.ts`) in all three places that cap them:
`tessellateBoard`, the cutout path's half rows, and the STL writer. Boards without
channels keep their fans, so their meshes are unchanged byte for byte.

Two more things showed on the owner's square tail:

- **A vertical tail edge.** A square tail drawn with a vertical edge has no width at
  x = 0 (the outline there is a vertical line), only a hair inside. The mesh took it for
  pointed and coned it to an apex. On a board with channels, such an end is now capped
  flat at the inset station. `boardChannelProblems` also reads the width just inside,
  so a channel running out through it no longer reads as off the bottom.
- **Corner points of a faded step.** A step's corner points were spaced by its radii
  held to the station's depth. Past the channel's end the depth is nothing, so they all
  landed on the wall, and the mesh welded them into edges shared by up to 24 faces. They
  are now spaced by the radii as set, held only to the width.

### The rail past the last wall (owner report, 2026-11)

`stationRing` stretched every span of the ladder between anchors, including the last
one: from the outermost wall to the deck centreline. Wherever that wall sits elsewhere
than at the reference station, the stretch slid the rail's points off the tight curve
the ladder packs them onto. Near the owner's tail that faceted the rail: STL triangles
up to 0.42 mm off the true surface, 0.16 mm at the 99th percentile. The same board
without channels gives 0.23 and 0.08.

Points past the last anchor now ease from moving with it back to their own ladder
places within a short span (`pastLastAnchor`), so the rail and deck are sampled as
without channels: 0.31 and 0.10.

## Checks (`channelProblems`)

- Each wall runs along the board, one point across it at each station.
- The walls don't cross.
- The outer wall stays inside the outline wherever the channel has depth.
- The depth stays under half the thickness.

The Channels panel shows them.

## Tests (`channels.test.ts`)

- Depth for each wall shape.
- Anchor counts that don't change along the board.
- A board without channels gives a bit-identical mesh.
- The wall at a fixed ring index.
- Square walls vertical, with the floor lifted by the depth against `bottomZAt`.
- The deck untouched.
- Watertight on an ordinary tail. On a swallow, closed everywhere except that path's
  existing seam at the nose tip, which is there with or without channels.
- The checks, and scaling with the board.

## Not yet

| Gap                       | Why it matters                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Volume and specs          | They integrate the cross-sections, so they leave channels out: a few tenths of a litre on the test boards                      |
| 2D cross-section view     | Draws the cut over the section (`channelCut`); the scrubbed section between stations, from `loftCrossSection`, doesn't show it |
| Rail bands                | Use `loftCrossSection` too                                                                                                     |
| STEP (`board-surface.ts`) | Fits through the ladder without channels; needs patches split at the walls (step 5)                                            |

## Sections as built (owner review, 2026-11)

The first version cut flat-floored channels with lands, parallel or following the
outline, and its default usually stopped short of the tail. The owner's reference
drawing (four sections, two channels a side, side by side from the stringer to the rail)
and photos showed what shapers build:

| Section      | What it is                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Step         | Deepest at a steep wall on the rail side; the floor ramps straight back up to nothing toward the stringer. A sawtooth |
| Rounded step | The same, with a radius where the floor meets the wall                                                                |
| Scoop        | Concave arcs meeting in sharp ridges; the stringer is a ridge                                                         |
| Wave         | Smooth flutes with rounded crests                                                                                     |

The photos add placement: channels exit through the tail, start as points well up the
board, and fan out toward the tail.

So `ChannelWall` gained `step` (with a corner `radius`, 0 sharp) and `wave`, beside the
existing `scoop` and the flat-floored `square`, `bevel` and `round`. Depth is now worked
from each wall separately (`profileShare(dIn, dOut, u)`), so a section can be one-sided:

- **step** is u × a quarter round within `radius` of the outer wall, a vertical drop
  there;
- **wave** is (1 − cos 2πu) / 2;
- a channel centred on the stringer with a step section is a V.

Anchors follow each section:

- a step gets a vertical pair at its wall, points round its corner and a crease at its
  inner edge;
- scoops and waves get twelve floor points;
- no anchor lands on the stringer itself (`OFF_STRINGER`), so channels that start there
  don't put a second point on the ring's own.

`frontSpread` and `frontWidth` move each channel's centre line and width linearly from
the tail end to the front end, so walls stay straight in the straight layout. Files from
before have neither and read as 1 (unchanged).

`defaultChannelParams` is now that common build:

- four steps side by side from the stringer to 3 cm inside the rail;
- starting as points about two fifths of the way up, with a 70 % spread;
- running out through the tail wherever it is wide enough for 3 cm channels and thick
  enough for the 5 mm depth to stay under half of it.

## Laid out from a cross-section (owner design, 2026-11)

The owner's design for the panel replaced the tail-end layout above it:

- **The cross-section.** The person selects or adds a cross-section, then adds the
  channels there. Width, stringer offset and the follow share are measured at that
  station (`station`); the panel offers to lay them out from the one on show instead.
- **The panel.** Number; Type, picked from icons (step, scoop, wave); Width; Depth;
  Radius top and Radius bottom, for a step; Stringer offset.
- **Align.** Centre–Rail is `follow`, a blend between parallel walls and walls that keep
  their share of the half-width. Tail–Nose is `start` and `end`.
- **Depth blend.** The bar is the channels' length, start to end. Its two handles are
  `fullFrom` and `fullTo`: full depth between them, easing (3t² − 2t³) to nothing from
  each handle to its end of the bar. A shaded band behind the bar draws it. A handle
  on an end is no fade there: the default has the tail one on the start, so the
  channels run out through the tail at full depth. (A first version had a white
  "deepest point" handle on this bar, the depth fading from it both ways; the owner
  pointed out the depth is uniform between the blends, so the point said nothing true.)
- **The step's two radii.** The wall stands `lip` in from the outer edge. A quarter round
  of radius `lip` climbs from the uncut bottom to it; it rises straight; a quarter round of
  radius `radius` turns it into the floor. Each radius is held to the depth at the
  station, so a fading step's lip becomes the whole wall.
- **The cross-section view.** It draws the cut over the section on show
  (`channelCut`): the lifted bottom in green, with the mesh's points on it.

Files saved with the first numbers (tail end, run-in, rail margin, lands) only ever
came from the print version's test builds. They open without their channels.

### Apply and Reset (`channel-apply.ts`)

The owner asked for two buttons. **Apply** puts the channels' points on the other
cross-sections and unlocks them for dragging, the numbers following the drag. **Reset**
clears every edit.

Nothing is written into the cross-section curves. The loft blends those point by point
between stations, which would smear the walls, and walls could only stay parallel with a
station every few centimetres. Instead:

- **Apply** (`applyChannels`) turns `{from: 'numbers'}` into `{from: 'drawn', params}`:
  each wall and depth becomes a curve through _keys_ (a point and a slope; Bézier
  handles a third of the way to each neighbour). There is a key at every real
  cross-section inside the channels, at their ends, where full depth begins and ends,
  at the laid-out wall's own knots, and every 8 cm at most. The walls then stay within
  0.3 mm of the typed-in layout.
- **The cut** is the drawn channels' own: crisp walls between stations, exactly as before.
- **The cross-section view** shows the keys at the station on show (`channelKeys`): a
  point on each wall where it meets the bottom (side-by-side walls share one), and one
  where each channel is deepest. They are drawn as larger green points and dragged as
  their own drag mode in `SplineEditor` (one undo step, 'Edit channels').
  - Dragging a wall key moves the wall across; dragging a depth key sets the depth.
  - `moveChannelKey` sets the value at the station, adding a key if a new cross-section
    has none. It moves the keys between it and the cross-sections either side by a
    smoothstep share (slopes too), so the change eases out from one cross-section to the
    next.
  - A shared wall moves both channels.
- **The panel** shows each channel's offset, width and depth at the cross-section on
  show, live while dragging. The outline view draws the walls in plan.
- **Reset** (`resetChannels`) goes back to `params`.

### Editing in plan and in profile (`use-channel-editing.ts`)

The outline and rocker views edit applied channels too. `SplineEditor` takes draggable
channel points in any pane (`overlays.channelKeys`), drawn and hit on both halves of a
mirrored pane; a drag on the mirrored half is flipped back.

| View          | Draws                                  | Points                                            | Dragging one                                                |
| ------------- | -------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Cross-section | The cut                                | Each wall where it meets the bottom; each deepest | Moves the wall across / sets that channel's depth           |
| Outline       | The walls in plan (`channelPlanLines`) | Each wall at its ends and every cross-section     | Moves the wall across there: curved channels, drawn in plan |
| Rocker        | The deepest depth above the bottom     | At the ends and every cross-section               | Deepens every channel there (`moveChannelDepths`)           |

Every edit goes through the same keyed curves and eases out to the cross-sections either
side. To edit somewhere new, add a cross-section there. Points can't yet move along the
board (a channel's start and end), and the rocker's vertical scale makes fine depth
edits easier zoomed in or on the cross-section.

## Curved channels: walls drawn with points and handles (owner design, 2026-11)

The owner's reference board has two channels from the stringer, deepest down the middle,
their outer walls sweeping in from near the rail at the tail to meet the stringer at a
point. A first version laid such walls out from numbers (a "meet at the stringer"
switch and an early–late curve slider); the owner judged that numbers can't cover the
curves shapers draw, and asked for plain Bézier editing instead. So:

- **Applied walls are spline targets** (`{ kind: 'channel', index, wall }` in
  `SplineTarget`, `packages/store/src/edits.ts`). The outline view adds one for each wall
  of applied channels (`channelTargets`), drawn green, and every outline tool works on
  them: drag a point or a handle, double-click to add a point, Delete, the point
  inspector, undo. A wall two side-by-side channels share is one target, and an edit to
  it is written to both (`sameCurve`). `withSpline` holds every point and handle on the
  board's side of the stringer, so a wall dragged onto it stops there: that is how a
  channel is closed to a point.
- **Apply gives walls few points**: a straight wall its two ends; one that follows the
  outline a point at each cross-section it passes, and midway points only where the
  curve through those strays more than 0.2 mm from the laid-out wall (`WALL_FIT`).
- **Cross-section drags bend the wall in place** (`bendAt`): the curve is split exactly
  at the cross-section if it has no point there, then each point moves by the eased
  share (smoothstep out to the neighbouring cross-sections), its handles shifted by the
  bend and tilted by its slope, so smooth points stay smooth and the handles drawn in
  the outline view are kept. The depth curve, which has no handles to keep, is still
  re-keyed (`withKeyAt`).
- **A step turned round** (`deepAt: 'stringer'` on the step wall): the floor ramps from
  nothing at the outer wall to the steep wall on the stringer side. A wall on the
  stringer meets its mirror image at full depth, so it has no wall and no radii there
  (`profileDepth`'s `onStringer`): two of them from the stringer make the V. Off the
  stringer it is the step's sawtooth facing the other way.
- **Mesh points where walls meet** (`MIN_ANCHOR_SPAN`): walls that close to nothing, and
  are held there past the channels' end, would put every one of a channel's ring points
  on one spot. Below 5 mm a channel's points are spread over 5 mm instead, on the uncut
  bottom just outside its tip. The cut's last few millimetres to the point are therefore
  sampled less finely; the depth has usually faded there.

Not yet: walls must still run along the board (one point across at each x); the panel
says so if a handle is dragged back on itself.

### The rail where walls sweep across the bottom (owner report: rail scalloping, 2026-11)

A wall drawn from near the rail at the tail to near the stringer up the board moves the
last anchor a long way from where it is at the reference station (the middle of the
channel). Two things then showed on a hard rail as a serrated edge:

- **Rail points eased by profile fraction.** `pastLastAnchor` pushed the points past the
  last anchor out by the anchor's shift, easing back over a span that grows with it, and
  blended to an even stretch when the shift was large: either way they came out evenly
  spaced, thinned over the hard edge the ladder had packed, and slid over it at a
  different station each. They are now eased in the ladder's measure (`ladderMeasure`:
  the share of a plain ring's points up to a fraction, its density linear between the
  ladder's samples, so both it and its inverse are smooth): moved by counts of points,
  they keep the ladder's packing. Measured on a hard-railed shortboard with a swept
  wall: 0.032 cm worst second difference along the board before, 0.011 after, 0.0006
  without channels.
- **Where the cut stops.** The cut was applied up to the rail's widest point
  (`bottomEnd`), found on 64 samples: as that stepped, rail points switched between cut
  and uncut. It is now found exactly (golden section).

### A channel run out through the rail (owner report: ragged rail, 2026-11)

Lifting every point up to the rail's widest point by the channel's depth lifted the
rail's lower side too: where a channel ran out through a hard rail, the lifted lower
side rose over the uncut upper side, and the surface folded over itself, ragged flaps
in a print. Now (`channelCutAt`):

- **The bottom ends where it turns into the rail** (`railStart`: the first point out
  from the stringer where the profile is steeper than 45°, found by bisection; on a
  hard rail, the edge). Up to there a point is lifted by the depth, as before.
- **The rail is cut off at the channel's floor**: the floor is the bottom's height at
  the rail's start plus the depth. The points from the rail's start to where the
  profile first rises back above the floor (`railCutEnd`, on the rail's lower side, or
  past its widest point where the floor is above it) are cut away, and spread evenly
  along the floor between the two, in order: no fold, and no points stacked on a
  vertical rail. Past that the rail is untouched.
- **Walls reach a hard rail's edge.** Anchors were kept inside 95% of the way to the
  widest point; on a hard rail that is short of the edge, so a step's wall near it was
  pulled in and drawn sloping. They now reach the rail's start, less 0.5 mm, where
  that is further out.

On the owner's board no ring crosses itself any more (13 did, at the tail corner), and
the step's wall stays vertical to within a millimetre of the rail. A channel deep
enough to cut a thin rail away whole leaves the floor and the upper side coinciding
there: the rail is gone, which is what such a channel does.

The owner's board also ran its channel out through the rail at the tail corner: the
outer wall's first point had been dragged to 4 cm up the board, and a wall is held
straight back from its first point, 12.2 cm out where the tail is narrower. The panel
says so ("runs off the bottom"). There the step's wall crosses the rail at an angle,
which is a real edge, not a sampling fault.

### The rail's start as a fixed boundary (owner report: rail cuts wrapping onto the deck, 2026-11)

Easing the points past the last wall in the ladder's measure kept them packed, but a
wall that moves fast (where its drawn end meets the stretch held behind it) still
pushed points from the rail's upper side round onto its lower side, one every few
stations. The mesh joins point k to point k, so each crossing cut the corner with a
facet across the rail: a crease wrapping from the rail onto the deck.

`pastLastAnchor` now takes where the rail starts on both stations (`railFrom` here,
`railRef` at the reference) as a boundary no point crosses. The bottom's points stay
between the last wall and the rail, spread in the ladder's measure; the rail's track
where it starts and ease back to their own places up it, so the deck is sampled
exactly as without channels. On the owner's board the number of points on the rail is
the same at every station (it varied 37 to 46 near the tail), and creases running
across the rail's upper side went from 121 to 7, all at a corner of the drawn outline.
