export const WINDS = [0, 45, 90, 135, 180, 225, 270, 315];
export const SEEDS = [1, 2, 3];

// Remote completion and local verification are distinct stages. Only local
// records populate the matrix; missing records must never look like passes.
export function extendedSummary(agent, events = [], now = Date.now() / 1000) {
  if (!agent) return null;
  const launches = events.filter((event) => event.stage === 'agent' && /Launching Managed Agent/.test(event.msg));
  const launched = agent.launched ?? launches.at(-1)?.t ?? agent.started;
  const relevant = events.filter((event) => event.stage === 'agent' && event.t >= (launched || 0));
  const failure = relevant.findLast((event) => event.status === 'fail');
  const done = relevant.findLast((event) => event.status === 'done' && /Local re-check/.test(event.msg));
  const cells = SEEDS.flatMap((seed) => WINDS.map((wind) => {
    const worker = agent.workers?.find((item) => item.wind === wind && item.seed === seed);
    const row = agent.local_check?.grid?.find((item) => item.wind === wind && item.seed === seed);
    const verified = Boolean(row && Object.hasOwn(row, 'houseIgnitedAt'));
    return { wind, seed, worker, verified, houseIgnitedAt: verified ? row.houseIgnitedAt : undefined,
      outcome: !verified ? ['failed', 'cancelled'].includes(worker?.status) ? 'failed' : ['launching', 'running', 'verifying'].includes(worker?.status) ? 'running' : 'pending' : row.houseIgnitedAt === null ? 'no_ignition' : 'ignited' };
  }));
  const checked = cells.filter((cell) => cell.verified).length;
  const holds = cells.filter((cell) => cell.outcome === 'no_ignition').length;
  const status = String(agent.status || 'launching').toLowerCase();
  let phase = agent.local_check && checked === 24 ? 'complete'
    : status === 'partial' ? 'partial'
    : status === 'cancelled' ? 'cancelled'
    : failure || /failed|cancelled|error/.test(status) ? 'failed'
    : /completed|verifying/.test(status) || agent.result ? 'verifying'
    : ['queued', 'launching'].includes(status) || agent.type === 'swarm' && !agent.workers?.some((worker) => worker.id) ? 'launching'
    : agent.id ? 'searching' : 'launching';
  const finished = agent.finished ?? done?.t ?? failure?.t;
  return { cells, checked, holds, phase, active: !['complete', 'failed', 'partial', 'cancelled'].includes(phase),
    launched, finished, elapsed: launched ? Math.max(0, (finished ?? now) - launched) : 0,
    isSwarm: agent.type === 'swarm',
    running: agent.workers?.filter((worker) => ['launching', 'running', 'verifying'].includes(worker.status)).length || 0,
    startedCount: agent.workers?.filter((worker) => worker.id).length || 0,
    failed: agent.workers?.filter((worker) => ['failed', 'cancelled'].includes(worker.status)).length || 0,
    error: agent.error || failure?.msg, timings: agent.timings || {},
    mph: agent.mph, duration: agent.duration || 90 };
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const rounded = Math.floor(Math.max(0, seconds));
  return rounded >= 60 ? `${Math.floor(rounded / 60)}m ${String(rounded % 60).padStart(2, '0')}s` : `${rounded}s`;
}
