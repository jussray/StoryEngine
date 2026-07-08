// lib/autonomousRuntime.js

import { randomUUID } from 'node:crypto';
import { analyzeChapter } from './lindymodeProcessor.js';
import { evaluateWorkspace, persistDecision, runReleaseAudit } from './decisionEngine.js';
import { planRecovery, runRecovery } from './recoveryEngine.js';
import { predictWorkspaceRisk } from './learningEngine.js';
import { buildStoryGenome } from './storyGenome.js';
import { evaluateAudienceFit, resolveAudienceLens } from './audienceLens.js';
import { log } from '../models/eventModel.js';

function step(name, status, data = {}) {
  return { name, status, at: Date.now(), data };
}

function writeStepEvent(db, workspaceId, correlationId, name, status, data = {}) {
  log(db, {
    workspace_id: workspaceId,
    mode: 'autonomous_runtime',
    event_type: `runtime.${name}.${status}`,
    payload: { correlation_id: correlationId, ...data },
    rollback: name === 'recovery' && status === 'rolled_back' ? 1 : 0
  });
}

function createRun(db, { correlationId, workspaceId, chapterId, triggerType }) {
  const runId = randomUUID();
  db.prepare(`
    INSERT INTO autonomous_runtime_runs (
      run_id, correlation_id, workspace_id, chapter_id,
      trigger_type, status, steps_json, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'running', '[]', '{}', ?)
  `).run(runId, correlationId, workspaceId, chapterId ?? null, triggerType, Date.now());
  return runId;
}

function saveRun(db, runId, status, steps, result) {
  db.prepare(`
    UPDATE autonomous_runtime_runs
    SET status = ?, steps_json = ?, result_json = ?, completed_at = ?
    WHERE run_id = ?
  `).run(status, JSON.stringify(steps), JSON.stringify(result), Date.now(), runId);
}

export function getRuntimeRun(db, runId) {
  const row = db.prepare('SELECT * FROM autonomous_runtime_runs WHERE run_id = ?').get(runId);
  if (!row) return null;
  return {
    ...row,
    steps: JSON.parse(row.steps_json || '[]'),
    result: JSON.parse(row.result_json || '{}')
  };
}

export function listRuntimeRuns(db, workspaceId, limit = 100) {
  return db.prepare(`
    SELECT * FROM autonomous_runtime_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit).map(row => ({
    ...row,
    steps: JSON.parse(row.steps_json || '[]'),
    result: JSON.parse(row.result_json || '{}')
  }));
}

function workspaceAudience(db, workspaceId) {
  const profile = db.prepare(`
    SELECT audience FROM creative_profiles WHERE workspace_id=?
  `).get(workspaceId);
  return profile?.audience || null;
}

function workspaceText(db, workspaceId, chapter = null) {
  if (chapter) return chapter.content || chapter.text || '';
  return db.prepare(`
    SELECT COALESCE(GROUP_CONCAT(COALESCE(content, text, ''), '\n\n'), '') AS text
    FROM chapters WHERE workspace_id=?
  `).get(workspaceId)?.text || '';
}

export function runAutonomousRuntime(db, {
  workspaceId,
  chapter = null,
  triggerType = 'workspace_changed',
  correlationId = null,
  allowRecovery = true
}) {
  const correlation = correlationId || `runtime_${randomUUID()}`;
  const runId = createRun(db, {
    correlationId: correlation,
    workspaceId,
    chapterId: chapter?.id ?? null,
    triggerType
  });
  const steps = [];

  try {
    writeStepEvent(db, workspaceId, correlation, 'started', 'completed', {
      run_id: runId,
      trigger_type: triggerType,
      chapter_id: chapter?.id ?? null
    });

    let analysis = { incidents: [], skipped: true };
    if (chapter) {
      analysis = analyzeChapter(db, chapter, {
        correlation_id: correlation,
        parent_event_id: `${triggerType}:${chapter.id}`
      });
      steps.push(step('lindymode_analysis', 'completed', {
        incident_count: analysis.incidents?.length || 0,
        drift_score: analysis.drift_score || 0,
        state_missing: Boolean(analysis.state_missing)
      }));
      writeStepEvent(db, workspaceId, correlation, 'lindymode_analysis', 'completed', steps.at(-1).data);
    }

    const audience = workspaceAudience(db, workspaceId);
    const audienceLens = resolveAudienceLens(audience);
    const audienceFit = evaluateAudienceFit(workspaceText(db, workspaceId, chapter), audience);
    if (audienceLens.active) {
      steps.push(step('audience_lens', audienceFit.passed ? 'completed' : 'blocked', {
        audience,
        label: audienceLens.label,
        score: audienceFit.score,
        metrics: audienceFit.metrics,
        findings: audienceFit.findings
      }));
      writeStepEvent(db, workspaceId, correlation, 'audience_lens', audienceFit.passed ? 'completed' : 'blocked', steps.at(-1).data);
    }

    let decision = persistDecision(db, evaluateWorkspace(db, workspaceId));
    steps.push(step('ooda_decision', 'completed', {
      decision_id: decision.decision_id,
      action: decision.action,
      readiness: decision.readiness,
      confidence_score: decision.confidence_score
    }));
    writeStepEvent(db, workspaceId, correlation, 'ooda_decision', 'completed', steps.at(-1).data);

    const recoveryRuns = [];
    const incidents = Array.isArray(analysis.incidents) ? analysis.incidents : [];
    const shouldAttemptRecovery = allowRecovery && ['INTERVENE', 'RECOVER', 'BLOCK'].includes(decision.action);

    if (shouldAttemptRecovery) {
      for (const incident of incidents) {
        const plan = planRecovery(db, incident.incident_id);
        if (!plan) continue;

        steps.push(step('recovery_plan', plan.reversible ? 'approved' : 'author_required', {
          incident_id: incident.incident_id,
          strategy: plan.strategy,
          reversible: plan.reversible,
          requires_author: plan.requires_author
        }));
        writeStepEvent(
          db,
          workspaceId,
          correlation,
          'recovery_plan',
          plan.reversible ? 'approved' : 'author_required',
          steps.at(-1).data
        );

        if (!plan.reversible || plan.requires_author) continue;

        const recovery = runRecovery(db, incident.incident_id, plan.strategy);
        recoveryRuns.push(recovery);
        steps.push(step('recovery', recovery.status, {
          incident_id: incident.incident_id,
          run_id: recovery.run_id,
          strategy: recovery.strategy,
          validation: recovery.validation
        }));
        writeStepEvent(db, workspaceId, correlation, 'recovery', recovery.status, steps.at(-1).data);
      }

      decision = persistDecision(db, evaluateWorkspace(db, workspaceId));
      steps.push(step('post_recovery_decision', 'completed', {
        decision_id: decision.decision_id,
        action: decision.action,
        readiness: decision.readiness,
        confidence_score: decision.confidence_score
      }));
      writeStepEvent(db, workspaceId, correlation, 'post_recovery_decision', 'completed', steps.at(-1).data);
    }

    const genome = buildStoryGenome(db, workspaceId);
    steps.push(step('story_genome', genome ? 'refreshed' : 'skipped', {
      version: genome?.version || null,
      chapter_count: genome?.narrative?.chapter_count || 0,
      total_words: genome?.narrative?.total_words || 0
    }));
    writeStepEvent(db, workspaceId, correlation, 'story_genome', genome ? 'refreshed' : 'skipped', steps.at(-1).data);

    const prediction = predictWorkspaceRisk(db, workspaceId);
    steps.push(step('predictive_ooda', 'completed', {
      predicted_risk: prediction.predicted_risk,
      likely_next_action: prediction.likely_next_action,
      confidence_trend: prediction.confidence_trend,
      drift_trend: prediction.drift_trend
    }));
    writeStepEvent(db, workspaceId, correlation, 'predictive_ooda', 'completed', steps.at(-1).data);

    const releaseAudit = runReleaseAudit(db, workspaceId);
    if (audienceLens.active && !audienceFit.passed) {
      releaseAudit.result = 'BLOCKED';
      releaseAudit.blockers = [
        ...(releaseAudit.blockers || []),
        ...audienceFit.findings.map(finding => ({
          code: finding.code,
          message: finding.message,
          source: audienceLens.label
        }))
      ];
    }
    steps.push(step('release_gate', releaseAudit.result.toLowerCase(), {
      audit_id: releaseAudit.audit_id,
      result: releaseAudit.result,
      blockers: releaseAudit.blockers
    }));
    writeStepEvent(db, workspaceId, correlation, 'release_gate', releaseAudit.result.toLowerCase(), steps.at(-1).data);

    const result = {
      run_id: runId,
      correlation_id: correlation,
      workspace_id: workspaceId,
      chapter_id: chapter?.id ?? null,
      trigger_type: triggerType,
      analysis,
      audience_lens: audienceLens.active ? audienceFit : null,
      decision,
      recoveries: recoveryRuns,
      genome: genome ? {
        version: genome.version,
        chapter_count: genome.narrative?.chapter_count || 0,
        total_words: genome.narrative?.total_words || 0
      } : null,
      prediction,
      release: {
        audit_id: releaseAudit.audit_id,
        result: releaseAudit.result,
        blockers: releaseAudit.blockers
      }
    };

    saveRun(db, runId, 'completed', steps, result);
    writeStepEvent(db, workspaceId, correlation, 'completed', 'completed', {
      run_id: runId,
      release_result: releaseAudit.result,
      predicted_risk: prediction.predicted_risk,
      audience_lens: audienceLens.active ? audienceLens.label : null
    });
    return getRuntimeRun(db, runId);
  } catch (error) {
    const result = {
      run_id: runId,
      correlation_id: correlation,
      workspace_id: workspaceId,
      error: error.message
    };
    steps.push(step('runtime', 'failed', { error: error.message }));
    saveRun(db, runId, 'failed', steps, result);
    writeStepEvent(db, workspaceId, correlation, 'failed', 'failed', { run_id: runId, error: error.message });
    return getRuntimeRun(db, runId);
  }
}
