// Keep observed risk, scene edits, and simulated fixes separate.
export const PHASES = [
  { title: "Reviewing your footage", detail: "Identify materials & nearby fuels", stages: ["prepare", "survey"] },
  { title: "Building your property model", detail: "Write the 3D model", stages: ["generate"] },
  { title: "Comparing the model with your video", detail: "Match viewpoints and correct", stages: ["fidelity"] },
  { title: "Testing the original property", detail: "Baseline ember storm", stages: ["simulate"] },
  { title: "Applying and testing changes", detail: "Fix, re-test, verify", stages: ["fix", "verify", "guardrail", "wind"] },
  { title: "Checking additional wind directions", detail: "24 scenario agents", stages: ["agent"] },
  { title: "Preparing your action plan", detail: "Rank the next steps", stages: ["report", "done"] },
];

export function assessmentSummary(state) {
  const sims = state?.sims || [];
  const before = sims[0];
  const latest = sims.at(-1);
  const fixes = new Map();
  for (const round of state?.fix_rounds || []) for (const fix of round.applied || []) {
    const key = `${fix.fix}:${fix.target}`;
    if (!fixes.has(key)) fixes.set(key, fix);
  }
  const applied = [...fixes.values()];
  const grouped = new Map();
  for (const fix of applied) {
    if (!grouped.has(fix.fix)) grouped.set(fix.fix, { ...fix, targets: [], changed: 0 });
    const group = grouped.get(fix.fix);
    group.targets.push(fix.target);
    group.changed += fix.changed || 0;
  }
  const fixGroups = [...grouped.values()];
  const sceneEdits = (state?.spec_versions || []).filter((v) => v.label.startsWith("fidelity fix")).length;
  const suggestions = state?.report?.fixes_ranked || [];
  const pendingTests = Math.max(0, sims.filter((sim) => /^AFTER\b/.test(sim.label || '')).length - (state?.fix_rounds || []).length);
  let title = "A little footage. A clearer way forward.";
  let description = "See where embers could start a fire around your home, and which changes are worth considering.";
  let tone = "neutral", label = "Ready when you are";
  if (state?.status === "error") {
    title = "This assessment needs another try.";
    description = "The run stopped before it could finish. Any completed steps are saved in Agent activity.";
    tone = "danger"; label = "Run interrupted";
  } else if (state && state.status !== "done") {
    title = "Getting to know this home.";
    description = "Follow the agent from the original footage to a model, an ember test, and a practical action plan.";
    label = "Assessment in progress";
  } else if (latest) {
    if (latest.result.houseIgnited) {
      title = "A fire path to the house was found.";
      description = `The house ignited at ${latest.result.houseIgnitedAt} in the latest simulation. Review the remaining risks and the agent’s action plan below.`;
      tone = "danger"; label = "House ignition detected";
    } else if (before.result.houseIgnited && applied.length) {
      title = "The tested fixes broke the fire path.";
      description = `The original model ignited at ${before.result.houseIgnitedAt}. After the agent applied changes to the model, the house did not ignite in the latest test.`;
      tone = "success"; label = "Improvement verified";
    } else {
      title = (latest.result.ignited || []).length ? "The house held. Nearby risks remain." : "No ignition was observed in this test.";
      description = applied.length
        ? "The house did not ignite in the latest simulation. Review the changes tested in the model and the recommendations below."
        : "The house did not ignite under the tested conditions. The action plan contains recommendations; no mitigation fixes were applied or re-tested.";
      tone = (latest.result.ignited || []).length ? "warning" : "success";
      label = "No house ignition in this test";
    }
  }
  return { before, latest, applied, fixGroups, sceneEdits, suggestions, pendingTests, title, description, tone, label };
}

export function phaseStates(state, events) {
  if (!state) return PHASES.map(() => "pending");
  if (state.status === "done") return PHASES.map(() => "complete");
  const stages = events.map((e) => e.stage);
  const current = Math.max(0, ...PHASES.map((p, i) => p.stages.some((s) => stages.includes(s)) ? i : -1));
  return PHASES.map((_, i) => i < current ? "complete" : i === current ? (state.status === "error" ? "error" : "active") : "pending");
}
