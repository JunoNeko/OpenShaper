# Futures fin tabs

The reference geometry for the fin designer's tab, step 0 of
[`docs/design/fin-designer.md`](../../design/fin-designer.md).
[`futures-tabs.json`](futures-tabs.json) is the fixture that step 1's kernel tab outline
is tested against. [`futures-tabs.svg`](futures-tabs.svg) draws the same numbers, for
comparison with the source drawings.

Status: **signed off** by the project owner, 2026-10-15.

## Source

AutoCAD drawings of the Futures **box slot**, supplied by the project owner, titled
"Center, Quad Rear" and "Side Fin, Quad Front".

- The slot is 113.5 long; the tab is slightly smaller, so **the tab is 113**. Each end's
  features keep their drawn sizes and are measured from their own end. Only the straight
  middle is shorter.
- The slot drawing gives the side height as 17.7. The tab uses **17.7** (owner's decision;
  the nominal 3/4″ is 19.05).
- The tab is **6.35** thick (1/4″). The blade's foil may be thicker (e.g. 7.0) and
  overlap the box slot.
- No clearance is subtracted from the notch or slot features.

## Which tab each fin uses

| Fin       | Tab      | Height | Cant (blade lean vs tab) | Side  |
| --------- | -------- | ------ | ------------------------ | ----- |
| Side      | `side`   | 17.7   | 0–20°                    | L / R |
| Quad rear | `centre` | 12.7   | 0–20°                    | L / R |
| Centre    | `centre` | 12.7   | 0°                       | —     |

Quad rears sit further back, where the tail is thinner, so they use the shallower
centre tab. Unlike a centre fin, they take cant and a side.

## Frame

- Units mm.
- **x** runs from the rear (trailing) end at 0 to the front (leading) end at 113. +x is
  toward the nose, matching the app's tail-at-x=0 rule.
- **y** runs up from the tab bottom at 0 to the tab top at the tab height. The tab top
  is the blade root plane.
- The thickness (6.35) is the extrusion across the fin, centred on the tab's mid-plane.

## Rear end (both tabs)

- The rear end is a vertical face at x = 0.
- **U-slot:** Ø4.4, open to the rear end. Its centreline is 6.4 below the tab top.
  Straight sides run from x = 0 to x = 3.3, ending in a semicircle centred at
  (3.3, height − 6.4).
- **Bottom-rear corner:** R1.0.
- The top-rear corner is sharp.

## Front end: grub-screw V-notch

Points, in order from the tab top down the front:

```
T  top-front corner        (113, height)          the forward-most point of the tab
U  upper mouth of the V    (113, height − m)      T→U is vertical
A  apex of the V           (113 − s, a)
D  lower mouth of the V    intersection of the lower flank with the front face
B  bottom-front corner     (113 − b, 0)
```

- **Front face:** the line through B at **101°** to the bottom edge, leaning forward
  going up (11° from vertical). Only its part from B to D is tab edge. Above D, the
  drawings show it continuing as an extension line that clears T.
- **V-notch:** the upper flank runs A→U. The lower flank leaves A at the drawn
  included angle and stops where it meets the front face, at D.

| Dimension                        | Symbol | Centre / quad rear   | Side / quad front |
| -------------------------------- | ------ | -------------------- | ----------------- |
| Height                           |        | 12.7                 | 17.7              |
| Upper mouth below top            | m      | 4.5                  | 5.5               |
| Apex inset from T                | s      | 2.0                  | 3.8               |
| Apex height above bottom         | a      | 6.0 (owner-measured) | 7.7               |
| Bottom-front corner inset from T | b      | 0.7                  | 2.1               |
| V included angle                 |        | 100°                 | 90°               |
| Front face angle                 |        | 101°                 | 101°              |

### Derived points

Computed from the table above. Step 1 must reproduce them to 0.001 mm.

| Point / angle            | Centre / quad rear | Side / quad front |
| ------------------------ | ------------------ | ----------------- |
| T                        | (113, 12.7)        | (113, 17.7)       |
| U                        | (113, 8.2)         | (113, 12.2)       |
| A                        | (111, 6)           | (109.2, 7.7)      |
| D                        | (112.971, 3.452)   | (111.946, 5.381)  |
| B                        | (112.3, 0)         | (110.9, 0)        |
| Upper flank above horiz. | 47.726°            | 49.821°           |
| Lower flank below horiz. | 52.274°            | 40.179°           |

How each derived value is calculated:

- **Upper flank** = atan2(U.y − A.y, U.x − A.x).
- **Lower flank** = included angle − upper flank.
- **D** = A moved along the lower flank direction until it reaches the front-face line
  x = B.x + tan(11°)·y.

### Checks against the drawings

- **Front-face line:** extended above the tab it passes 1.77 (centre) and 1.34 (side)
  in front of T. This matches the extension lines in both drawings.
- **Notch angles on the side tab:** with the drawn apex (3.8 in, 7.7 up), the 90°
  included angle splits about 50° / 40°. The drawing measures the same split.

## Decisions recorded at sign-off

- **Centre apex height `a` = 6.0.** The centre drawing gives no dimension for it; the
  owner measured it.
- **Small radii are not modelled.** The drawings appear to round the U-slot mouth
  corners and the bottom-front corner slightly. They are modelled sharp: the owner
  confirmed they don't matter for fit, and the CNC cutter radius rounds them anyway.

## Weight-saving holes

Futures tabs have material removed to save weight: four through-holes, each a slot with fully
round ends (owner's measurements, mm):

|                                    | 3/4" (side)                    | 1/2" (centre)                                     |
| ---------------------------------- | ------------------------------ | ------------------------------------------------- |
| Holes                              | 4                              | 4                                                 |
| Size                               | 16 long × 8 tall, end radius 4 | same                                              |
| Gap between holes                  | 6.5                            | 6.5                                               |
| First hole's front end             | 13 behind the tab front        | same                                              |
| Centre height above the tab bottom | 8.85 (centred on the tab)      | 6.3 (level with the rear slot, 6.4 below the top) |

The four holes span 83.5 mm, ending 16.5 mm from the rear end, clear of the rear slot (5.5 mm
deep). Defined in `FUTURES_TAB_HOLES` (`futures-tab.ts`) and cut through the tab in the STEP, the
STL and the preview. The 13 mm front position is read from a photo; change it there if a
measurement says otherwise.
