import { createHash } from 'node:crypto';

const NULL_MARKERS = new Set(['', 'null', 'none', 'na', 'n/a']);
const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/i;
const UNIT_PATTERN = /^[a-z%$][a-z0-9_./%$-]{0,39}$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCsv(text) {
  const source = String(text ?? '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter(item => item.some(value => String(value).trim() !== ''));
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase();
}

function parseObservedAt(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('observed_at is required.');
  if (/^\d{10,13}$/.test(text)) {
    const number = Number(text);
    const ms = text.length <= 10 ? number * 1000 : number;
    if (Number.isSafeInteger(ms)) return ms;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid observed_at: ${text}`);
  return parsed;
}

function normalizeMetricValue(value) {
  const text = String(value ?? '').trim();
  if (NULL_MARKERS.has(text.toLowerCase())) return { metric_value: null, value_state: 'missing' };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`metric_value must be finite or blank/null, received: ${text}`);
  return { metric_value: parsed, value_state: 'observed' };
}

function required(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeRow(row, defaults, importedAt, lineNumber) {
  const workspace_id = required(defaults.workspace_id, 'workspace_id');
  const audience_segment = required(row.audience_segment || defaults.audience_segment, 'audience_segment');
  const source = required(row.source || defaults.source, 'source');
  const account_id = required(row.account_id || defaults.account_id, 'account_id');
  const page_id = String(row.page_id || defaults.page_id || '').trim() || null;
  const content_id = String(row.content_id || row.post_id || defaults.content_id || '').trim() || null;
  const metric_name = required(row.metric_name, 'metric_name');
  const unit = required(row.unit, 'unit');
  if (!METRIC_NAME_PATTERN.test(metric_name)) throw new Error(`Invalid metric_name: ${metric_name}`);
  if (!UNIT_PATTERN.test(unit)) throw new Error(`Invalid unit: ${unit}`);

  const observed_at = parseObservedAt(row.observed_at);
  const { metric_value, value_state } = normalizeMetricValue(row.metric_value);
  const normalized = {
    workspace_id,
    audience_segment,
    source,
    account_id,
    page_id,
    content_id,
    metric_name,
    metric_value,
    value_state,
    unit,
    observed_at,
    imported_at: importedAt,
    historical: observed_at < importedAt ? 1 : 0
  };
  const canonical = JSON.stringify({
    workspace_id,
    audience_segment,
    source,
    account_id,
    page_id,
    content_id,
    metric_name,
    metric_value,
    value_state,
    unit,
    observed_at
  });
  const provenance = {
    ...(defaults.provenance && typeof defaults.provenance === 'object' ? defaults.provenance : {}),
    import_format: 'csv',
    line_number: lineNumber
  };
  return {
    ...normalized,
    observation_id: `metric_${sha256(canonical).slice(0, 32)}`,
    provenance_json: JSON.stringify(provenance),
    raw_row_hash: sha256(JSON.stringify(row))
  };
}

export function importBusinessMetricsCsv(db, csvText, defaults = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV must contain a header and at least one data row.');

  const headers = rows[0].map(normalizeHeader);
  if (headers.some((header, index) => !header || headers.indexOf(header) !== index)) {
    throw new Error('CSV headers must be non-empty and unique.');
  }
  for (const requiredHeader of ['observed_at', 'metric_name', 'metric_value', 'unit']) {
    if (!headers.includes(requiredHeader)) throw new Error(`CSV is missing required header: ${requiredHeader}`);
  }

  const importedAt = Date.now();
  const normalizedRows = rows.slice(1).map((values, index) => {
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
    return normalizeRow(row, defaults, importedAt, index + 2);
  });
  const insert = db.prepare(`
    INSERT OR IGNORE INTO business_metric_observations (
      observation_id, workspace_id, audience_segment, source, account_id, page_id, content_id,
      metric_name, metric_value, value_state, unit, observed_at, imported_at, historical,
      provenance_json, raw_row_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let written = 0;
  let duplicates = 0;
  let missingValues = 0;
  const observationIds = [];

  db.transaction(() => {
    for (const normalized of normalizedRows) {
      const result = insert.run(
        normalized.observation_id,
        normalized.workspace_id,
        normalized.audience_segment,
        normalized.source,
        normalized.account_id,
        normalized.page_id,
        normalized.content_id,
        normalized.metric_name,
        normalized.metric_value,
        normalized.value_state,
        normalized.unit,
        normalized.observed_at,
        normalized.imported_at,
        normalized.historical,
        normalized.provenance_json,
        normalized.raw_row_hash
      );
      observationIds.push(normalized.observation_id);
      if (normalized.value_state === 'missing') missingValues += 1;
      if (Number(result.changes || 0) === 1) written += 1;
      else duplicates += 1;
    }
  })();

  return {
    rows_seen: rows.length - 1,
    written,
    duplicates,
    missing_values: missingValues,
    observation_ids: observationIds
  };
}

export function listBusinessMetrics(db, workspaceId, { limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  return db.prepare(`
    SELECT observation_id, workspace_id, audience_segment, source, account_id, page_id, content_id,
           metric_name, metric_value, value_state, unit, observed_at, imported_at, historical,
           provenance_json
    FROM business_metric_observations
    WHERE workspace_id = ?
    ORDER BY observed_at DESC, imported_at DESC, metric_name ASC, observation_id DESC
    LIMIT ?
  `).all(String(workspaceId), safeLimit).map(row => ({
    ...row,
    provenance: JSON.parse(row.provenance_json || '{}'),
    provenance_json: undefined,
    historical: Boolean(row.historical)
  }));
}

export function businessMetricsSummary(db, workspaceId) {
  const id = String(workspaceId);
  const rows = db.prepare(`
    SELECT grouped.metric_name,
           grouped.unit,
           grouped.source,
           grouped.account_id,
           grouped.page_id,
           grouped.content_id,
           grouped.audience_segment,
           grouped.observations,
           grouped.missing,
           grouped.latest_observed_at,
           grouped.max_observed_value,
           latest.metric_value AS latest_value,
           latest.value_state AS latest_value_state,
           latest.observed_at AS latest_value_observed_at
    FROM (
      SELECT metric_name,
             unit,
             source,
             account_id,
             page_id,
             content_id,
             audience_segment,
             COUNT(*) AS observations,
             SUM(CASE WHEN value_state='missing' THEN 1 ELSE 0 END) AS missing,
             MAX(observed_at) AS latest_observed_at,
             MAX(CASE WHEN value_state='observed' THEN metric_value END) AS max_observed_value
      FROM business_metric_observations
      WHERE workspace_id = ?
      GROUP BY metric_name, unit, source, account_id, page_id, content_id, audience_segment
    ) grouped
    LEFT JOIN business_metric_observations latest
      ON latest.observation_id = (
        SELECT candidate.observation_id
        FROM business_metric_observations candidate
        WHERE candidate.workspace_id = ?
          AND candidate.metric_name = grouped.metric_name
          AND candidate.unit = grouped.unit
          AND candidate.source = grouped.source
          AND candidate.account_id = grouped.account_id
          AND candidate.page_id IS grouped.page_id
          AND candidate.content_id IS grouped.content_id
          AND candidate.audience_segment = grouped.audience_segment
        ORDER BY candidate.observed_at DESC, candidate.imported_at DESC, candidate.observation_id DESC
        LIMIT 1
      )
    ORDER BY grouped.metric_name ASC,
             grouped.source ASC,
             grouped.account_id ASC,
             grouped.page_id ASC,
             grouped.content_id ASC,
             grouped.audience_segment ASC
  `).all(id, id);
  return {
    workspace_id: id,
    metrics: rows
  };
}
