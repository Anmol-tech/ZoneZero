# Recognizing materials and ember hazards on video

## Siding
- **wood**: lap boards with visible grain/knots, shakes or shingles, board-and-batten; often stained brown or painted; weathered gray when old.
- **fiber_cement**: very straight, uniform lap lines, crisp painted finish, no grain; common on 2000s+ craftsman homes.
- **stucco**: smooth or sand-textured, no lines; common in CA, Mediterranean styles.
- A stone/brick band at the base → `wainscot: "stone" | "brick"` (keep siding as the material above it).

## Roof
- **asphalt**: flat-looking shingles in regular rows, gray/black/brown. Most common.
- **wood_shake**: thick irregular wooden shakes, brown/gray, rough shadow lines. HIGH risk.
- **tile**: curved clay/concrete tiles (S-shapes), terracotta or brown.
- **metal**: standing seams (straight vertical ribs), sheen.

## Gutters and debris
- Gutter = horizontal trough along every eave. `debris: true` if you see leaves/needles in or above it, plants sprouting,
  or if trees/conifers overhang that roof edge (needles accumulate even if not visible).

## Vents
- Gable vents: louvered rectangle/triangle high in the gable. Eave/soffit vents: under the overhang. Foundation vents: small
  rectangles near the ground. `screened: true` only if you can see fine metal mesh; louvers alone are NOT ember-resistant.

## Plants (use `color` from the footage)
- **juniper**: dense, dark blue-green, scale-like foliage, upright or spreading — very flammable.
- **conifer**: pine/fir/cedar/arborvitae with needles; arborvitae = narrow column.
- **tree**: broadleaf (maple, birch, oak); autumn yellow/orange/red is common in footage.
- **shrub**: rounded bushes (boxwood, barberry = burgundy, hydrangea).
- **grass**: ornamental grass clumps (fountain grass) — light tan/green, airy.

## Ground cover
- **bark** mulch: dark brown chips in beds — embers smolder in it.
- **gravel**: gray/white stones.

## Fences
- Wood privacy fence attached to the house corner (`attachedToHouse: true`) is a classic wick into the wall.
- Note gates: a gate at the house is part of the fence touching the house.
