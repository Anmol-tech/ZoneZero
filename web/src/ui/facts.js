// One source of truth for result wording. Every panel formats these numeric facts;
// none of them lets generated prose calculate times, differences or coverage.
export const PLANNED_SCENARIOS = 24;

export const toSeconds = (t) => {
  if (t === null || t === undefined) return null;
  const [m, s] = String(t).split(':').map(Number);
  return m * 60 + s;
};
export const formatSeconds = (s) => (s === null || s === undefined ? 'no house ignition' : `${s} s`);

// Mirrors server/pipeline.py result_facts(): baseline vs. final at the tested wind, plus the all-wind check.
export function resultFacts(state) {
  if (!state) return null;
  // Every round at the originally tested wind counts (fix rounds and same-wind tests); other directions don't.
  const all = state.fix_rounds || [];
  const testedWind = all[0]?.wind ?? state.conditions?.wind;
  const rounds = all.filter((round) => (round.wind ?? testedWind) === testedWind);
  const sims = state.sims || [];
  const base = rounds[0]?.before ?? sims[0]?.result ?? null;
  const final = rounds.at(-1)?.after ?? base;
  const facts = {
    wind: state.conditions?.wind ?? sims[0]?.wind ?? null, mph: state.conditions?.mph ?? sims[0]?.mph ?? 30, durationS: 90,
    baselineS: base ? toSeconds(base.houseIgnitedAt) : null, finalS: final ? toSeconds(final.houseIgnitedAt) : null,
    hasBaseline: Boolean(base), tested: rounds.length > 0, finalSpec: state.final_spec ?? state.spec_versions?.at(-1)?.n ?? null,
  };
  facts.delayS = facts.baselineS !== null && facts.finalS !== null ? facts.finalS - facts.baselineS : null;
  const agent = state.agent;
  if (agent?.type === 'swarm' && agent.local_check?.grid?.length) {
    const checked = agent.local_check.grid.length, noIgnition = agent.local_check.survives;
    facts.swarm = { id: agent.id, checked, noIgnition, ignited: checked - noIgnition, complete: checked === PLANNED_SCENARIOS };
  }
  return facts;
}

// Deterministic headline + tone. Coverage and outcome are separate: a partial check never reads as a pass.
export function verdict(facts) {
  if (!facts?.hasBaseline) return null;
  const sw = facts.swarm;
  if (sw && !sw.complete) return { tone: 'neutral', title: `All-wind check incomplete: ${sw.checked} of ${PLANNED_SCENARIOS} scenarios verified` };
  if (sw && sw.ignited === 0) return { tone: 'success', title: `No house ignition observed in any of ${PLANNED_SCENARIOS} tested scenarios` };
  if (sw) {
    const helped = facts.tested && (facts.finalS === null || (facts.baselineS !== null && facts.finalS > facts.baselineS));
    return { tone: sw.noIgnition === 0 ? 'danger' : 'warning',
      title: helped ? `Changes helped, but ignition occurred in ${sw.ignited} of ${PLANNED_SCENARIOS} scenarios` : `House ignition occurred in ${sw.ignited} of ${PLANNED_SCENARIOS} scenarios` };
  }
  if (facts.baselineS === null) return { tone: 'success', title: 'No house ignition observed in the selected test' };
  if (facts.finalS === null) return { tone: 'success', title: 'No house ignition observed after changes in the selected test' };
  return { tone: 'danger', title: `House still ignites after changes (${formatSeconds(facts.baselineS)} → ${formatSeconds(facts.finalS)})` };
}

// "At the tested wind" sentence, built only from numbers with explicit units.
export function testedWindLine(facts, direction) {
  if (!facts?.hasBaseline) return '';
  const where = `At the tested wind (${facts.wind === null ? '—' : direction(facts.wind)}, ${facts.mph} mph, ${facts.durationS} s)`;
  if (!facts.tested) return `${where}: ${formatSeconds(facts.baselineS)}; no fixes were tested.`;
  if (facts.delayS !== null) return `${where}: ignition ${formatSeconds(facts.baselineS)} → ${formatSeconds(facts.finalS)}, ${facts.delayS} s later; the house still ignited.`;
  return `${where}: ${formatSeconds(facts.baselineS)} before fixes → ${formatSeconds(facts.finalS)} after.`;
}

export function scopeLine(facts, direction) {
  if (!facts?.hasBaseline) return '';
  const scene = facts.finalSpec === null ? '' : ` · scene v${facts.finalSpec}`;
  return `${facts.tested ? 'After tested changes' : 'Original modeled property'}${scene} · wind ${facts.wind === null ? '—' : direction(facts.wind)} · ${facts.mph} mph · ${facts.durationS} s`;
}

// A plan is stale when tests it did not see exist. Plans without provenance are "legacy".
export function reportFreshness(state) {
  if (!state?.report) return 'none';
  const scope = state.report_scope;
  if (!scope) return 'legacy';
  const swarmChecked = state.agent?.type === 'swarm' ? state.agent.local_check?.grid?.length || 0 : 0;
  const newerSims = (state.sims || []).length > scope.sims;
  const newerSwarm = state.agent?.type === 'swarm' && swarmChecked > 0 && (state.agent.id !== scope.swarm_id || swarmChecked > (scope.swarm_checked || 0));
  return newerSims || newerSwarm ? 'stale' : 'current';
}

// Whether a report priority was part of the tested set. Prefers the catalog id; legacy reports fall back to titles.
export function fixInTestedSet(fix, appliedIds, catalog) {
  const id = fix.fix_id || Object.keys(catalog).find((key) => catalog[key].title.toLowerCase().trim() === String(fix.title || '').toLowerCase().trim());
  return Boolean(id && appliedIds.has(id));
}
