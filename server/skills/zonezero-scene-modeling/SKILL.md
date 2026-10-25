---
name: zonezero-scene-modeling
description: Turn a homeowner's walk-around or drone video into an accurate ZoneZero Scene Kit model (scene.js) of the house, its massing, materials and every ember-relevant object, then check it against the footage. Use for the survey, scene generation and fidelity-check steps.
---

# ZoneZero scene modeling

You model one property for a wildfire **ember** simulation. Two things matter, in this order:
1. **Fire facts**: materials, and what touches or sits within 5 ft / 30 ft of the house.
2. **Recognizability**: the homeowner must look at the render and say "that's my house".

Work in this order every time.

## 1. Orient
- The wall the camera faces at the START of the video is **North** (front). +x = East, -z = North.
- Decide left/right from the camera's view at the start: the camera looks toward +z (south), so **East (+x) is on the LEFT of
  the frame and West (-x) is on the RIGHT**. Mirroring this is the #1 error. Check it twice.

## 2. Measure from things of known size
Never guess raw feet. Count, then derive (see `references/measurements.md`):
- Stories × ~9.5 ft = wall height to the eaves (1 story ≈ 9–10, 2 stories ≈ 18–21).
- Garage doors: 2-car ≈ 16 ft wide, 1-car ≈ 9 ft, both ≈ 7 ft tall. A 2-car garage bay is ≈ 20–24 ft wide.
- Front door ≈ 3×7 ft, typical window ≈ 3×4 ft, a car ≈ 6×15 ft, fence ≈ 6 ft tall.
- Use them to size the footprint and set distances (e.g. "shrub is half a garage-door width from the wall" ≈ 8 ft).

## 3. Model the massing (house shape)
Real houses are rarely one box. Read `references/massing.md` and pick the closest pattern:
- `kit.house` = the largest/tallest block. `kit.wing` = every part with its own roof line (forward garage, L/T leg, one-story
  section, bump-out). A shallow wing with a gable roof becomes a **cross gable** whose roof runs back into the main roof.
- Ridge direction: a **front-facing gable** (triangle facing the street) means the ridge runs front-to-back: ridge "z" for a
  wing on the N wall. A side-gable/eave facing the street means ridge "x".
- Hip vs gable: hip = sloped on all sides, no triangular wall. Gable = triangular wall at the ends.
- Put the garage door on the wing that holds it; put the porch on the main block.

## 4. Inventory everything that burns or catches embers
See `references/materials.md` for how each looks on video. Include, with a `// seen at m:ss` comment above each:
gutters (one per wall run, debris true if leaves/needles visible or trees overhang), vents (gable, eave, foundation; screened?),
decks (underside open?), fences (does it touch the house?), every shrub/plant bed within ~30 ft (individually, with color),
bark mulch beds, firewood, furniture, propane, vehicles, trees within 30 ft, neighbors within ~30 ft, the forest edge.

## 5. Place things where they physically are
- **Nothing grows on pavement.** Trees, shrubs, grasses, mulch and firewood never sit on a driveway, street, path, patio or
  pool. Cars go on driveways/streets; furniture, planters and doormats on patios/paths. A plant next to a driveway sits
  beside its edge: x = driveway.x ± (driveway.w/2 + plant radius + 1).
- **Circular drives:** use `kit.paving({ ..., shape: "ring", inner })`; the island in the middle stays unpaved for its tree
  and shrubs. Round patios: `shape: "circle"`. Pools: `kind: "pool"`.
- **Size paving to the footage**: don't let a driveway or street rectangle swallow lawn, beds or the island.
- Nothing inside a neighbor's footprint; neighbors don't overlap the house or each other.

## 5b. Place things relative to the house
- Coordinates are of the object center; the house is centered at (0,0). A shrub "against the N wall" sits at z = -d/2 - (radius + 0.5).
- Keep plants, firewood and objects OUT of the footprint (main block and wings). Leave ≥ 0.5 ft.
- Neighbors: center x/z so that the gap between footprints matches what you see (≥ 2 ft).

## 6. Cameras
Add 4–6 `kit.camera` calls at clear, different moments. Match the real camera height (drone ≈ 40–90 ft, walking ≈ 5.5 ft) and
aim (`lookAt`) at what the frame centers on. Bad cameras make the fidelity check meaningless.

## 7. Self-check before answering (see `references/mistakes.md`)
- [ ] Not mirrored (East on the left at the start).
- [ ] Stories, roof style and ridge direction per block match.
- [ ] Every wing has d ≥ 1.5 ft and its own roofStyle; the garage is on the right block.
- [ ] Nothing inside the footprint; vents below the roof peak; values inside the API ranges.
- [ ] No plant, mulch or firewood on any paving; trees beside (not on) driveways/streets; island plants use a ring drive.
- [ ] Every paving rectangle matches the paved area you see (no swallowed lawns or beds); pools modeled as pools.
- [ ] Each hazard has a `// seen at m:ss` comment and the right material/condition.
- [ ] Colors: siding, trim and every plant use hex colors sampled from the footage.

`examples/forest_house.js` is a complete, validated model of a two-story craftsman with a forward garage — use it as the
template for structure, comments and level of detail.
