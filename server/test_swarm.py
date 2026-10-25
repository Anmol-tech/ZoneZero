import json
import re
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import swarm


class FakeRun:
    def __init__(self, folder):
        self.dir = Path(folder)
        self.state = {"spec_versions": [{"n": 0}], "final_spec": 0}
        self.mph = 30
        self.events = []

    def path(self, name):
        return self.dir / name

    def spec(self, n):
        return {"snapshot": "same-current-home", "version": n}

    async def emit(self, stage, message, status="info", **data):
        self.events.append({"stage": stage, "message": message, "status": status, **data})


class SwarmTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, fail_one=False, never_finish=False):
        lock = threading.Lock()
        calls, jobs, cancelled = [], {}, []
        active = peak = 0

        def start(prompt, files):
            nonlocal active, peak
            wind, seed = map(int, re.search(r"wind FROM (\d+) degrees, seed (\d+)", prompt).groups())
            key = f"remote-{wind}-{seed}"
            with lock:
                active += 1
                peak = max(peak, active)
                calls.append((wind, seed, json.loads(files['/workspace/zz/property.json'])))
            time.sleep(.02)
            with lock:
                active -= 1
            if fail_one and (wind, seed) == (225, 3):
                raise RuntimeError('provider unavailable')
            jobs[key] = (wind, seed)
            return key

        def poll(key):
            wind, seed = jobs[key]
            return {"status": "in_progress" if never_finish else "completed", "output_text": json.dumps({
                "wind": wind, "seed": seed, "houseIgnited": False, "houseIgnitedAt": None,
                "diagnosis": "one assigned scenario", "fixes": [],
            })}

        def simulate(path, wind, seed, mph):
            # Intentionally disagree with one remote agent: local truth must win.
            ignites = (wind, seed) == (225, 3)
            return {"houseIgnited": ignites, "houseIgnitedAt": "0:42" if ignites else None, "chain": []}

        with tempfile.TemporaryDirectory() as folder:
            run = FakeRun(folder)
            with patch.object(swarm.g, 'client', return_value=SimpleNamespace(interactions=object())), \
                 patch.object(swarm.g, 'start_agent', side_effect=start), \
                 patch.object(swarm.g, 'poll_agent', side_effect=poll), \
                 patch.object(swarm.g, 'cancel_agent', side_effect=cancelled.append), \
                 patch.object(swarm.tools, '_node', return_value='{}'), \
                 patch.object(swarm.tools, 'simulate', side_effect=simulate), \
                 patch.object(swarm.tools, 'apply_fixes', return_value={"applied": [], "rejected": []}):
                await swarm.run_swarm(run, concurrency=24, poll_interval=.001, timeout=.005 if never_finish else 10)
            return run.state['agent'], calls, peak, cancelled

    async def test_24_distinct_remote_agents_overlap_and_share_the_same_snapshot(self):
        result, calls, peak, _ = await self.exercise()
        self.assertEqual(len(calls), 24)
        self.assertEqual(len({(wind, seed) for wind, seed, _ in calls}), 24)
        self.assertGreater(peak, 1)
        self.assertEqual(len({case['id'] for case in result['workers']}), 24)
        self.assertTrue(all(snapshot == {"snapshot": "same-current-home", "version": 0} for _, _, snapshot in calls))
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['local_check']['survives'], 23)
        case = next(case for case in result['workers'] if case['key'] == '225-3')
        self.assertFalse(case['agent_agrees'])
        self.assertEqual(case['result']['houseIgnitedAt'], '0:42')

    async def test_one_failed_agent_does_not_discard_other_scenarios(self):
        result, calls, _, _ = await self.exercise(fail_one=True)
        self.assertEqual(len(calls), 24)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(len(result['local_check']['grid']), 23)
        failed = [case for case in result['workers'] if case['status'] == 'failed']
        self.assertEqual([case['key'] for case in failed], ['225-3'])

    async def test_timed_out_remote_agents_are_cancelled_and_never_marked_passed(self):
        result, _, _, cancelled = await self.exercise(never_finish=True)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(cancelled), 24)
        self.assertEqual(result['local_check']['grid'], [])
        self.assertTrue(all(case['status'] == 'failed' for case in result['workers']))


if __name__ == '__main__':
    unittest.main()
