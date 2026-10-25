"""Prompts for every Argon stage. Kept together so they are easy to tune."""
from pathlib import Path


def load_skill(name: str) -> str:
    """Concatenates a skill folder (SKILL.md, references/, examples/) into one instruction block."""
    root = Path(__file__).with_name("skills") / name
    parts = [(root / "SKILL.md").read_text()]
    for sub in ("references", "examples"):
        for f in sorted((root / sub).glob("*")):
            parts.append(f"\n\n<<< {sub}/{f.name} >>>\n{f.read_text()}")
    return "".join(parts)


SYSTEM = (
    "You are ZoneZero, a wildfire home-hardening assistant. You reason about how wind-blown embers ignite homes, "
    "grounded in IBHS and CAL FIRE guidance (Zone 0 = the first 5 ft around the house must be ember-resistant). "
    "You are precise, you cite video timestamps, and you never invent objects you did not see."
)

# The scene-modeling skill rides in the system instruction of every modeling call (survey,
# generate, repair, fidelity). It is a stable prefix, so Gemini's implicit cache makes it cheap.
SYSTEM_MODELING = SYSTEM + "\n\nYou have the following skill. Follow it.\n\n" + load_skill("zonezero-scene-modeling")

CONVENTIONS = """Coordinate conventions (feet):
- The house footprint is centered at the origin. +x = East, -z = North, y = up.
- The wall the camera faces at the START of the video is the NORTH wall (front of the house). Walk direction then tells you E/S/W.
- Walls: N at z=-d/2, S at z=+d/2, E at x=+w/2, W at x=-w/2.
"""

KIT_DOC = """Scene Kit API (the ONLY calls allowed; no other JavaScript, no loops, no variables needed):
kit.house({ w, d, h, roof: "asphalt"|"wood_shake"|"tile"|"metal", siding: "wood"|"stucco"|"fiber_cement",
            stories: 1|2|3, roofStyle: "hip"|"gable"|"flat", ridge: "x"|"z",          // ridge axis of a gable/hip roof
            wainscot: "none"|"stone"|"brick",                                          // masonry band at the base of the walls
            garage: { wall, x, width }, porch: { wall, x, w, d },                      // x = offset along that wall from its center
            sidingColor: "#rrggbb", trimColor: "#rrggbb" })   // call first, once. w along x, d along z, h = wall height (eaves)
kit.wing({ wall, offset, w, d, h, roof, roofStyle: "hip"|"gable"|"flat", ridge, siding, stories, garage: { wall, x, width } })
                                                              // an attached section sticking out of the main block's `wall`:
                                                              // w = width along that wall, d = depth away from it, own roof (<= 4 wings)
kit.chimney({ x, z, h })                                      // masonry chimney; h = height above ground
kit.vent({ wall: "N"|"E"|"S"|"W", x, h, screened })          // x = offset along the wall from its center, h = height above ground
kit.gutter({ wall, debris })                                  // one per wall that has a gutter
kit.deck({ wall, depth, length, offset, material: "wood"|"composite", underside: "open"|"enclosed", debris })
kit.fence({ from: [x, z], to: [x, z], material: "wood"|"metal"|"masonry", attachedToHouse })
kit.plant({ x, z, kind: "juniper"|"shrub"|"tree"|"conifer"|"grass", height, color: "#rrggbb" })   // tree = broadleaf; conifer = pine/fir
kit.forest({ x, z, w, d, density: 0.05-1, height })            // a stand of conifers (e.g. forest edge behind the lot)
kit.neighbor({ x, z, w, d, h, roof, siding, sidingColor })    // a neighboring building (center x,z); keep >= 2 ft from our footprint
kit.paving({ x, z, w, d, kind: "driveway"|"path"|"patio"|"street"|"pool", shape: "rect"|"circle"|"ring", inner })
                                                              // ring = circular drive around an unpaved island (inner 0.1-0.9)
kit.mulch({ x, z, w, d, material: "bark"|"gravel" })          // rectangle centered at x,z
kit.firewood({ x, z })
kit.object({ x, z, kind: "patio_furniture"|"trash_bin"|"propane_tank"|"car"|"doormat"|"planter", material: "wood"|"plastic"|"metal"|"fabric"|"wicker" })
kit.camera({ id, pos: [x, y, z], lookAt: [x, y, z], videoTimestamp: "m:ss" })   // >= 4, matching real video moments (use the real camera height, e.g. 60+ ft for drone shots)
kit.note("short text")                                        // optional assumptions
Make it LOOK like the video: match stories, roof style and ridge direction, garage/porch placement, siding and plant colors,
neighbors, driveway/street and any forest edge. Fire-relevant facts (materials, what touches what) matter most.
HOUSE SHAPE: real houses are rarely one box. Use kit.house for the largest block and kit.wing for every part that sticks out
with its own roof line: a forward or side garage (put the garage door on the wing), an L or T leg, a lower one-story section,
a bay/bump-out. A front-facing gable means the main ridge runs front-to-back (ridge "z" when the front is the N wall).
Use the right roofStyle per block (hip vs gable), the right height per block, and add chimneys you can see.
Plant detail: give every plant a color that matches the footage (autumn yellow, burgundy, dark evergreen) and a realistic height."""

SURVEY = """Watch this entire walk-around video of a home (with any narration).
Build an inventory of everything relevant to wildfire EMBER risk near the house: roof and siding materials, gutters (and whether
they hold leaves/needles), vents (attic, foundation/crawlspace, gable; screened or not), decks (material, open underside, debris),
fences (material, does it touch the house), plants within ~30 ft (especially junipers / dense shrubs against walls), mulch,
firewood, furniture, propane, vehicles, doormats, anything combustible within 5 ft of the walls.
Be EXHAUSTIVE and specific: scrub the whole video, zoom into frames, list every gutter run, every visible vent, every plant bed and
shrub near the walls, every fence segment, and the condition of each (clogged? touching? dense? dry?). Record the single BEST
timestamp where each item is clearly visible (seen_at[0]) - it will be shown to the homeowner as evidence.

{conventions}

Return ONLY JSON:
{{
  "summary": "one sentence about the property",
  "house": {{"approx_w_ft": n, "approx_d_ft": n, "wall_height_ft": n, "stories": n, "roof": "...", "roof_style": "hip|gable|flat",
             "siding": "...", "siding_color_hex": "#rrggbb", "wainscot": "none|stone|brick", "garage": "which wall, where",
             "porch": "which wall, where",
             "shape": "footprint and massing: main block + each wing/garage/bump-out (which side, size, stories, roof style, ridge direction)",
             "chimneys": "where, if any", "notes": "..."}},
  "surroundings": {{"neighbors": ["position/size/material of each nearby building"], "forest_edge": "where, how far", "driveway_street": "..."}},
  "objects": [
    {{"kind": "gutter|vent|deck|fence|plant|mulch|firewood|object", "description": "...", "material": "...",
      "location": "e.g. NE corner, touching the E wall", "approx_position_ft": [x, z], "distance_to_house_ft": n,
      "seen_at": ["m:ss"], "condition": "e.g. gutter full of needles / shrub touching siding",
      "ember_risk": "high|medium|low: why it matters"}}
  ],
  "camera_moments": [{{"timestamp": "m:ss", "camera_position_ft": [x, y, z], "looking_at_ft": [x, y, z], "shows": "..."}}],
  "uncertain": ["things you could not determine from the video"]
}}
Give 4-6 camera_moments spread across the video, each a clear view of a different side of the house."""

GENERATE = """Write scene.js: a 3D model of this property using ONLY the Scene Kit API below. It will be compared side by side
with frames from the real video, then used to simulate an ember storm, so materials and what-touches-what matter more than looks.

{kit}
{conventions}

Inventory from the video survey:
{inventory}

Rules: call kit.house first. Every object in the inventory must appear (be detailed: individual shrubs, each gutter, each vent,
plant colors, neighbors, paving, forest edge). Put a `// seen at m:ss` comment above each hazard so it can be traced to the video. Put a kit.camera at each camera_moment
(id = short name, videoTimestamp exactly as given). Keep everything within 150 ft. Return ONLY one ```js code block."""

FIX_SCENE = """Your scene.js failed validation. Fix it and return ONLY one ```js code block with the full corrected file.
Errors:
{errors}

Current scene.js:
```js
{code}
```"""

FIDELITY = """Fidelity check. For each camera below you get the REAL video frame and then the RENDER of the current model from the
same viewpoint. Compare them. Look for: missing or extra objects, wrong side of the house (check for a mirrored layout), wrong materials
(roof/siding/fence), fence touching vs not touching the house, plants against walls, deck size/side, gutter or vent placement,
AND the overall look: house SHAPE (missing or wrong wings, garage projecting forward or not, L/T shape, lower sections), number of
stories, roof style/ridge direction per block, gable ends, garage and porch position, siding/plant colors and sizes, neighbors,
driveway/street, forest edge, and whether the camera framing matches. Ignore lighting and the low-poly style.
Also fail anything physically impossible in the render: a tree or shrub on a driveway, street, path or pool; paving covering
lawn, beds or a drive island; objects inside buildings; floating or overlapping objects.

Current scene.js:
```js
{code}
```

Answer with a ```json block FIRST:
{{"pass": true|false, "score": 0-10, "issues": [{{"camera": "id", "problem": "...", "fix": "..."}}]}}
pass = true only if score >= 8 AND every ember-relevant element is present, on the correct side, with the right material.
If pass is false, follow it with ONE ```js block containing the full corrected scene.js (Scene Kit calls only)."""

MITIGATE = """You are watching a recorded ember-storm simulation of this property (wind from {wind} deg at {mph} mph).
The overlay shows ignitions as they happen. The simulator's ignition log and house state are below.

Property model:
{describe}

What the homeowner's real video shows (inventory with timestamps):
{inventory}

Simulation result:
{result}

{history}

Mitigation catalog (the ONLY fixes you may use; `target` is an object id from the property model, or "all" where allowed):
{catalog}

Tasks:
1. Describe the ignition chain you SEE in the video, with timestamps (what caught embers, what it spread to, how the house ignited).
2. Choose the smallest, cheapest set of catalog fixes that should break that chain (prefer $ over $$$; Zone 0 first).

Return ONLY JSON:
{{"failure_chain": [{{"time": "m:ss", "object_id": "id", "what": "...", "why": "...", "seen_in_video_at": "m:ss or null"}}],
  "diagnosis": "one or two sentences",
  "fixes": [{{"fix": "catalog_id", "target": "id or all", "why": "...", "evidence": "what in the real video shows this problem",
              "seen_in_video_at": "m:ss or null"}}],
  "expected_effect": "what should change in the next run"}}"""

VERIFY = """Verification. Video 1 is the simulation BEFORE the fixes, video 2 is AFTER, same wind and same random seed.
Fixes applied: {applied}
Before: {before}
After: {after}

Watch both. Did the fixes break the ignition chain you were targeting? Is there a new or remaining path to the house?
Return ONLY JSON:
{{"verified": true|false, "chain_broken": true|false, "house_survives": true|false,
  "observations": ["timestamped things you saw in video 2"], "remaining_risk": "..."}}"""

REPORT = """Write the homeowner's report for this property. Plain language, no jargon, honest about limits.
Property: {summary}
Wind tested: {winds}
Original run: {before}
Fixes applied, in order, with verified effect: {steps}
Final run: {after}
Catalog (for cost bands): {catalog}

Return ONLY JSON:
{{"headline": "one sentence",
  "fixes_ranked": [{{"title": "...", "cost": "$|$$|$$$", "why": "what it stops, in one sentence", "effect": "e.g. house ignition 0:21 -> survives"}}],
  "zone0_checklist": ["short actionable item", "..."],
  "caveats": "one or two sentences: this is a planning aid based on IBHS/CAL FIRE ember guidance, not a certified assessment"}}"""
