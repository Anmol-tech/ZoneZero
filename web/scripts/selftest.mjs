import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentSummary, phaseStates } from '../src/ui/assessment.js';

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
