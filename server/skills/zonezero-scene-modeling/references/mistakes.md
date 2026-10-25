# Mistakes seen in past runs (and the fix)

| Mistake | Symptom | Fix |
|---|---|---|
| Mirrored layout | garage on the wrong side in every render | At the start East (+x) is on the LEFT of the frame. Flip x signs. |
| One-box house | flat, generic massing; fidelity says "missing garage projection" | Add a wing for each separate roof line. |
| Wrong ridge | side gable where the footage shows a front triangle | Front-facing triangle → ridge perpendicular to that wall. |
| Plant inside footprint | validator: "inside the house footprint" | Plants sit outside the wall: z = -d/2 - radius - 0.5, and outside wings too. |
| Wing too shallow / zero | validator: "d out of range" | Use d ≥ 1.5 (bump-outs ≈ 2–4, garages ≈ 8–14). |
| Masonry as siding | validator: siding must be wood|stucco|fiber_cement | Use the real siding + `wainscot: "stone"` on the house. |
| Gable vent too high | validator: "above the roof peak" | Vent h ≤ wall h + ~10. |
| Huge forest | validator: forest w/d out of range | Forest w, d ≤ 300; it is clamped anyway. |
| Gutters missed | "Clogged gutter" never appears though trees overhang | One gutter per eave wall; debris true under trees. |
| Tree/shrub on the driveway or street | validator: "sits on the driveway" | Move it beside the paving edge, or shrink the paving to the real paved area. |
| Circular drive as a rectangle | island tree/shrubs end up "on the driveway" | `paving({ shape: "ring", inner: 0.4 })` around the island; plant the island. |
| Grass/shrub on the front path | validator: "sits on the path" | Path is narrow (3–5 ft); put plants beside it. |
| Plant inside a neighbor | validator: "inside neighbor … footprint" | Neighbors are buildings; landscaping goes around them. |
| Pool missing | blue rectangle in footage, lawn in render | `paving({ kind: "pool" })`. |
| Bad cameras | renders show sky or the back of the house | Match height (drone 40–90 ft) and aim at the frame center. |
| Missing colors | everything default green/gray | Add sidingColor, trimColor and plant color hex values from the footage. |
| Copying the example house | Every model gets a chimney, porch, 3 wings and hip roofs | Model only what this video shows; the example is for detail level, not structure. |
| Glass walls as small windows | A wall of sliding doors renders as two punched windows | `glass: ["N"]` on the house or wing with that wall. |
| One color for every block | A red-brown panel volume renders as the house color | `sidingColor` on that wing. |
