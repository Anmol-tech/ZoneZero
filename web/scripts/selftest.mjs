import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentSummary, phaseStates } from '../src/ui/assessment.js';
import { WINDS, SEEDS, extendedSummary, durationLabel } from '../src/ui/extended.js';

const simulation = (houseIgnited, time = null) => ({ result: { houseIgnited, houseIgnitedAt: time, ignited: ['mulch'] } });
const base = () => ({ status: 'done', sims: [simulation(false)], fix_rounds: [], fidelity: [], spec_versions: [], report: { fixes_ranked: [{ title: 'Replace bark mulch', cost: '$' }] } });

test('a corrected model is not counted as a tested mitigation', () => {
  const run = base();
  run.spec_versions.push({ label: 'generated' }, { label: 'fidelity fix 1' });
  const result = assessmentSummary(run);
  assert.equal(result.sceneEdits, 1);
  assert.equal(result.applied.length, 0);
  assert.equal(result.suggestions.length, 1);
  assert.match(result.description, /no mitigation fixes were applied or re-tested/);
  assert.doesNotMatch(result.title, /fixes broke/);
});

test('only an observed before/after improvement is described as breaking the fire path', () => {
  const run = base();
  run.sims = [simulation(true, '0:32'), simulation(false)];
  run.fix_rounds = [{ applied: [{ fix: 'clear_gutters', target: 'all' }] }];
  const result = assessmentSummary(run);
  assert.equal(result.tone, 'success');
  assert.equal(result.title, 'The tested fixes broke the fire path.');
  assert.match(result.description, /0:32/);
});

test('a failed latest wind test takes precedence over an earlier successful mitigation', () => {
  const run = base();
  run.sims = [simulation(true, '0:32'), simulation(false), simulation(true, '1:07')];
  run.fix_rounds = [{ applied: [{ fix: 'clear_gutters', target: 'all' }] }];
  const result = assessmentSummary(run);
  assert.equal(result.tone, 'danger');
  assert.match(result.description, /1:07/);
  assert.doesNotMatch(result.title, /broke/);
});

test('repeated applications do not inflate the count of distinct tested fixes', () => {
  const run = base();
  run.fix_rounds = [{ applied: [{ fix: 'screen_vents', target: 'v1' }] }, { applied: [{ fix: 'screen_vents', target: 'v1' }, { fix: 'screen_vents', target: 'v2' }] }];
  assert.equal(assessmentSummary(run).applied.length, 2);
  assert.equal(assessmentSummary(run).fixGroups.length, 1);
  assert.equal(assessmentSummary(run).fixGroups[0].targets.length, 2);
});

test('a recorded after-test awaiting agent verification remains explicitly pending', () => {
  const run = { ...base(), status: 'running' };
  run.sims = [{ ...simulation(true, '0:32'), label: 'BEFORE' }, { ...simulation(false), label: 'AFTER FIX 1' }];
  const result = assessmentSummary(run);
  assert.equal(result.pendingTests, 1);
  assert.equal(result.applied.length, 0);
  assert.equal(result.label, 'Assessment in progress');
  run.fix_rounds.push({ applied: [{ fix: 'screen_vents', target: 'all' }] });
  assert.equal(assessmentSummary(run).pendingTests, 0);
});

test('an interrupted generation step does not appear as a completed assessment', () => {
  const run = { ...base(), status: 'error' };
  const progress = phaseStates(run, [{ stage: 'survey' }, { stage: 'generate' }, { stage: 'error' }]);
  assert.deepEqual(progress, ['complete', 'error', 'pending', 'pending']);
  assert.equal(assessmentSummary(run).tone, 'danger');
});

test('a run still preparing its video makes no final simulation claim', () => {
  const run = { ...base(), status: 'running', sims: [], report: null };
  assert.equal(assessmentSummary(run).label, 'Assessment in progress');
  assert.deepEqual(phaseStates(run, [{ stage: 'prepare' }]), ['active', 'pending', 'pending', 'pending']);
});

test('remote success claims do not populate locally verified scenario cells', () => {
  const result = extendedSummary({ id: 'agent-1', status: 'completed', started: 100, result: { survives: 24 } }, [], 120);
  assert.equal(result.phase, 'verifying');
  assert.equal(result.checked, 0);
  assert.equal(result.holds, 0);
  assert.ok(result.cells.every((cell) => cell.outcome === 'pending'));
});

test('the matrix maps wind and seed precisely and preserves unchecked cases', () => {
  const result = extendedSummary({ status: 'completed', local_check: { grid: [
    { wind: 225, seed: 3, houseIgnitedAt: '0:43' },
    { wind: 45, seed: 1, houseIgnitedAt: null },
  ] } });
  assert.equal(result.checked, 2);
  assert.equal(result.holds, 1);
  assert.equal(result.phase, 'verifying');
  assert.equal(result.cells.find((cell) => cell.wind === 225 && cell.seed === 3).outcome, 'ignited');
  assert.equal(result.cells.filter((cell) => cell.outcome === 'pending').length, 22);
});

test('duplicate verification records cannot make the matrix appear complete', () => {
  const result = extendedSummary({ status: 'completed', local_check: { grid: Array(24).fill({ wind: 0, seed: 1, houseIgnitedAt: null }) } });
  assert.equal(result.checked, 1);
  assert.notEqual(result.phase, 'complete');
});

test('completed verification freezes elapsed time at the final event', () => {
  const grid = SEEDS.flatMap((seed) => WINDS.map((wind) => ({ seed, wind, houseIgnitedAt: null })));
  const result = extendedSummary({ id: 'a', status: 'completed', started: 105, local_check: { grid } }, [
    { stage: 'agent', status: 'running', t: 100, msg: 'Launching Managed Agent' },
    { stage: 'agent', status: 'done', t: 190, msg: 'Local re-check of the agent plan: 24/24' },
  ], 999);
  assert.equal(result.phase, 'complete');
  assert.equal(result.holds, 24);
  assert.equal(result.elapsed, 90);
});

test('an agent error is terminal even if the remote status was not updated', () => {
  const result = extendedSummary({ id: 'a', status: 'in_progress', launched: 100 }, [
    { stage: 'agent', status: 'fail', t: 125, msg: 'Agent error: unavailable' },
  ], 900);
  assert.equal(result.phase, 'failed');
  assert.equal(result.active, false);
  assert.equal(result.elapsed, 25);
  assert.equal(durationLabel(result.elapsed), '25s');
  assert.equal(durationLabel(72), '1m 12s');
});

test('swarm worker progress is distinct from a verified scenario outcome', () => {
  const agent = { type: 'swarm', id: 'swarm-1', status: 'running', launched: 100,
    workers: [{ wind: 0, seed: 1, status: 'launching' }], local_check: { grid: [] } };
  let result = extendedSummary(agent, [], 105);
  assert.equal(result.phase, 'launching');
  assert.equal(result.checked, 0);
  assert.equal(result.cells.find((cell) => cell.wind === 0 && cell.seed === 1).outcome, 'running');
  agent.workers[0].id = 'actual-remote-job';
  result = extendedSummary(agent, [], 110);
  assert.equal(result.phase, 'searching');
  assert.equal(result.startedCount, 1);
});

test('a partially failed swarm remains inspectable without appearing complete or active', () => {
  const result = extendedSummary({ type: 'swarm', status: 'partial', launched: 100, finished: 140,
    workers: [{ wind: 0, seed: 1, status: 'failed', error: 'provider unavailable' }],
    local_check: { grid: [{ wind: 45, seed: 1, houseIgnitedAt: null }] } }, [], 999);
  assert.equal(result.phase, 'partial');
  assert.equal(result.active, false);
  assert.equal(result.failed, 1);
  assert.equal(result.checked, 1);
  assert.equal(result.holds, 1);
  assert.equal(result.elapsed, 40);
  assert.equal(result.cells.find((cell) => cell.wind === 0 && cell.seed === 1).outcome, 'failed');
});
