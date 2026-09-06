import test from 'node:test';
import assert from 'node:assert/strict';

import { filterOodaRecordsForIdentity } from '../lib/oodaProcessor.js';

const records = [
  { incident_id: 'a', workspace_id: 'workspace-a' },
  { incident_id: 'b', workspace_id: 'workspace-b' },
  { incident_id: 'global-without-workspace' }
];

test('OODA visibility returns only exact authorized workspaces', () => {
  const visible = filterOodaRecordsForIdentity(records, { workspace_ids: ['workspace-a'] });
  assert.deepEqual(visible, [{ incident_id: 'a', workspace_id: 'workspace-a' }]);
});

test('OODA visibility fails closed without workspace authority', () => {
  assert.deepEqual(filterOodaRecordsForIdentity(records, {}), []);
  assert.deepEqual(filterOodaRecordsForIdentity(records, { workspace_ids: [] }), []);
});

test('OODA wildcard authority preserves operator-wide visibility', () => {
  assert.deepEqual(filterOodaRecordsForIdentity(records, { workspace_ids: ['*'] }), records);
});
