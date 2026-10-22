import { gs, GlideRecord, GlideRecordSecure, GlideDateTime, GlideDigest } from '@servicenow/glide';
import { OneExtendUtil } from '@servicenow/glide/sn_one_extend';
import { CoachingError, handle, val, parse, now, validId, readableConversation, conversationMessages, prepare, modelRoutes, modelAnswer } from './coaching.ts';
import { buildSkillAnalysisInput, validateBuildSkillOutput } from './buildSkillPreparation.js';

const JOB_TABLE = 'x_snc_build_agranx_coaching_job';
const DRAFT_TABLE = 'x_snc_build_agranx_coaching_skill_draft';
const SKILL_TABLE = 'sn_build_agent_user_instruction';
const CAPABILITY_ID = '0c90ca79533121106b38ddeeff7b12d7';
const TIMEOUT_MS = 5 * 60 * 1000;

function hash(value: string): string { return new GlideDigest().getSHA256Hex(value); }

/** An analysis viewer cannot silently install instructions for another user. */
function conversationOwner(conversation: any): any {
  if (!conversation.getElement('user').canRead()) throw new CoachingError(403, 'You cannot access the conversation owner.');
  const id = val(conversation, 'user');
  if (!validId(id)) throw new CoachingError(422, 'This conversation has no valid owner. A personal skill cannot be installed.');
  if (id !== gs.getUserID() && !gs.hasRole('admin')) throw new CoachingError(403, 'Only the conversation owner or an administrator can build this personal skill.');
  const user = new GlideRecordSecure('sys_user');
  if (!user.get(id) || !user.canRead() || val(user, 'active') === 'false' || val(user, 'active') === '0') {
    throw new CoachingError(422, 'The conversation owner is unavailable or inactive.');
  }
  return {id, name: user.getElement('name').canRead() ? val(user, 'name') : 'Conversation owner',
    userName: user.getElement('user_name').canRead() ? val(user, 'user_name') : ''};
}

function sourceContext(jobId: string, requireFresh: boolean): any {
  if (!validId(jobId)) throw new CoachingError(400, 'A completed coaching analysis is required.');
  const job = new GlideRecord(JOB_TABLE);
  job.addQuery('sys_id', jobId);
  job.addQuery('requested_by', gs.getUserID());
  job.query();
  if (!job.next()) throw new CoachingError(404, 'Coaching analysis not found.');
  if (val(job, 'status') !== 'completed') throw new CoachingError(409, 'Run coaching successfully before building a skill.');
  const conversationId = val(job, 'conversation_id');
  const conversation = readableConversation(conversationId);
  const owner = conversationOwner(conversation);
  conversationMessages(conversationId, false);
  const coaching = parse(val(job, 'result_json'));
  const prepared = parse(val(job, 'prepared_json'));
  if (!coaching || !prepared || !Array.isArray(coaching.tips) || !coaching.tips.length) {
    throw new CoachingError(422, 'This analysis has no coaching findings from which to build a useful skill.');
  }
  if (requireFresh && prepare(conversationId).inputHash !== val(job, 'input_hash')) {
    throw new CoachingError(409, 'The conversation has changed. Run coaching again before building or installing a skill.');
  }
  return {job, owner, coaching, prepared, conversationId,
    sourceHash: hash([val(job, 'input_hash'), val(job, 'result_json'), owner.id].join(':'))};
}

function nativeSkill(ownerId: string): any {
  const record = new GlideRecordSecure(SKILL_TABLE);
  record.initialize();
  // Native user instructions have no application scope. Runtime selection is
  // active=true, type=skill, user=principal, in every application scope.
  record.setValue('user', ownerId);
  record.setValue('type', 'skill');
  record.setValue('active', true);
  if (!record.canCreate()) throw new CoachingError(403, 'Your account does not have permission to create Build Agent skills.');
  for (const field of ['user', 'type', 'active', 'name', 'description', 'body']) {
    if (!record.getElement(field).canWrite()) throw new CoachingError(403, 'Your account cannot set the required personal skill fields.');
  }
  return record;
}

function failDraft(draft: any, message: string): void {
  draft.setValue('request_key', hash(val(draft, 'request_key') + ':' + draft.getUniqueValue()));
  draft.setValue('status', 'failed');
  draft.setValue('error_message', message);
  draft.setValue('finished_at', now());
  draft.update();
}

function refreshDraft(draft: any): void {
  if (val(draft, 'status') !== 'running') return;
  if (new GlideDateTime().getNumericValue() - new GlideDateTime(val(draft, 'sys_created_on')).getNumericValue() > TIMEOUT_MS) {
    failDraft(draft, 'Skill preparation timed out. Build the skill again to retry.');
  }
}

function findDraft(requestKey: string): any {
  const draft = new GlideRecord(DRAFT_TABLE);
  draft.addQuery('request_key', requestKey);
  draft.addQuery('requested_by', gs.getUserID());
  draft.setLimit(1);
  draft.query();
  return draft.next() ? draft : null;
}

function nativeId(draft: any): string { return hash('ba-analytics-personal-skill:' + draft.getUniqueValue()).slice(0, 32); }

function previewHash(draft: any, result: any): string {
  return hash(JSON.stringify({draftId: draft.getUniqueValue(), jobId: val(draft, 'coaching_job'),
    ownerId: val(draft, 'conversation_owner'), sourceHash: val(draft, 'source_hash'),
    name: result.name, description: result.description, body: result.body,
    type: 'skill', active: true, allScopes: true, ownerOnly: true}));
}

function sameSkill(record: any, draft: any, result: any): boolean {
  return val(record, 'user') === val(draft, 'conversation_owner') && val(record, 'type') === 'skill' &&
    ['true', '1'].indexOf(val(record, 'active')) >= 0 && val(record, 'name') === result.name &&
    val(record, 'description') === result.description && val(record, 'body') === result.body;
}

function draftBody(draft: any, context: any): any {
  const status = val(draft, 'status');
  const body: any = {draftId: draft.getUniqueValue(), jobId: val(draft, 'coaching_job'), status};
  if (status === 'failed') body.error = val(draft, 'error_message') || 'Skill preparation failed. Please try again.';
  if (status !== 'completed') return body;
  const result = parse(val(draft, 'result_json'));
  if (!result || !result.body || !result.name || !result.description) throw new CoachingError(409, 'The skill preview is incomplete. Build it again.');
  Object.assign(body, {
    conversationId: context.conversationId, modelId: val(draft, 'model'), inputHash: val(context.job, 'input_hash'),
    previewHash: previewHash(draft, result), owner: context.owner,
    availability: {allScopes: true, ownerOnly: true},
    skill: {name: result.name, description: result.description, content: result.body},
    warnings: result.limitations || [],
  });
  const installed = new GlideRecordSecure(SKILL_TABLE);
  if (installed.get(nativeId(draft))) {
    if (!sameSkill(installed, draft, result)) throw new CoachingError(409, 'The installed skill was changed. This saved preview cannot overwrite it.');
    body.existingSkill = {id: installed.getUniqueValue(), name: val(installed, 'name')};
  }
  return body;
}

function authorizedDraft(id: string, requireFresh: boolean): any {
  if (!validId(id)) throw new CoachingError(400, 'A valid skill preview is required.');
  const draft = new GlideRecord(DRAFT_TABLE);
  draft.addQuery('sys_id', id);
  draft.addQuery('requested_by', gs.getUserID());
  draft.query();
  if (!draft.next()) throw new CoachingError(404, 'Skill preview not found.');
  const context = sourceContext(val(draft, 'coaching_job'), requireFresh);
  if (context.sourceHash !== val(draft, 'source_hash') || context.owner.id !== val(draft, 'conversation_owner')) {
    throw new CoachingError(409, 'The analysis or conversation owner changed. Build a new skill preview.');
  }
  refreshDraft(draft);
  return {draft, context};
}

/** Generates a saved preview only. No native skill is created by this route. */
export function buildSkillPreview(request: any, response: any): void {
  handle(response, () => {
    const context = sourceContext((request.body.data || {}).jobId, true);
    nativeSkill(context.owner.id);
    let input: any;
    try { input = buildSkillAnalysisInput(context.coaching, context.prepared); }
    catch (_) { throw new CoachingError(422, 'Run coaching again to obtain complete, supported findings before building a skill.'); }
    const route = modelRoutes().find(model => model.id === val(context.job, 'model'));
    if (!route) throw new CoachingError(503, 'The model used for this coaching analysis is no longer available.');
    const prompt = input.systemPrompt + '\n\n' + input.userPrompt;
    if (prompt.length > 120000) throw new CoachingError(413, 'The skill preparation input is too large.');
    const requestKey = hash([gs.getUserID(), context.job.getUniqueValue(), context.sourceHash, route.configId, route.promptConfigId, hash(prompt)].join(':'));
    const existing = findDraft(requestKey);
    if (existing) {
      refreshDraft(existing);
      if (val(existing, 'status') !== 'failed') return draftBody(existing, context);
    }
    const draft = new GlideRecord(DRAFT_TABLE);
    draft.initialize();
    for (const [field, value] of Object.entries({
      requested_by: gs.getUserID(), coaching_job: context.job.getUniqueValue(), conversation_owner: context.owner.id,
      source_hash: context.sourceHash, request_key: requestKey, status: 'running', model: route.id,
      config_id: route.configId, prompt_config_id: route.promptConfigId,
      source_json: JSON.stringify({coaching: context.coaching, prepared: {canAnalyze: context.prepared.canAnalyze, turns: context.prepared.turns, stats: context.prepared.stats, warnings: context.prepared.warnings}}),
    })) draft.setValue(field, value);
    const id = draft.insert();
    if (!id) {
      const concurrent = findDraft(requestKey);
      if (concurrent) return draftBody(concurrent, context);
      throw new CoachingError(500, 'Unable to save the skill preparation request.');
    }
    try {
      const submission: any = OneExtendUtil.execute({
        executionRequests: [{capabilityId: CAPABILITY_ID, payload: {prompt},
          meta: {configId: route.configId, promptConfigId: route.promptConfigId, buildSkillDraftId: String(id)},
          definitionFilters: route.filters, returnRequest: true}],
        entity: 'default', mode: 'async', callbackHandler: 'x_snc_build_agranx.BABuildSkillCallback',
      });
      draft.get(id);
      if (val(draft, 'status') === 'running' && (!submission || !/^(success|completed)$/i.test(String(submission.status)))) {
        failDraft(draft, 'The selected model could not prepare the skill. Try again.');
      }
    } catch (_) {
      draft.get(id);
      if (val(draft, 'status') === 'running') failDraft(draft, 'The selected model could not prepare the skill. Try again.');
    }
    response.setStatus(val(draft, 'status') === 'failed' ? 502 : val(draft, 'status') === 'completed' ? 200 : 202);
    return draftBody(draft, context);
  });
}

export function buildSkillDraft(request: any, response: any): void {
  handle(response, () => {
    const {draft, context} = authorizedDraft(request.pathParams.draftId, false);
    return draftBody(draft, context);
  });
}

/** The callback can complete a preview; it can never install a skill. */
export function buildSkillCallback(response: any, outcome: string): void {
  const payload = typeof response === 'string' ? parse(response) : response;
  const feature = payload && payload.result && payload.result[CAPABILITY_ID];
  if (!feature) return;
  const meta = Object.assign({}, feature.requestPayload && feature.requestPayload._meta || {}, feature.meta || {});
  if (!validId(meta.buildSkillDraftId)) return;
  const draft = new GlideRecord(DRAFT_TABLE);
  if (!draft.get(meta.buildSkillDraftId) || val(draft, 'status') !== 'running') return;
  if (meta.configId !== val(draft, 'config_id') || meta.promptConfigId !== val(draft, 'prompt_config_id')) {
    failDraft(draft, 'The model returned a different configuration. Build the skill again.');
    return;
  }
  if (outcome !== 'completed' || !/^(success|completed)$/i.test(String(feature.status))) {
    failDraft(draft, 'The model did not complete the skill preview. Try again.');
    return;
  }
  try {
    const envelope = typeof feature.result === 'string' ? parse(feature.result) : feature.result;
    const model = val(draft, 'model');
    const expected = model === 'gpt-5.6-sol' ? /^gpt-5.6-sol(?:-\d{4}-\d{2}-\d{2})?$/ : /^claude-opus-5$/;
    if (!envelope || !/^(success|completed)$/i.test(String(envelope.status)) ||
      ['gpt-5.6-sol', 'claude-opus-5'].indexOf(model) < 0 || !expected.test(String(envelope.model || ''))) throw new Error('unexpected_model');
    const source = parse(val(draft, 'source_json'));
    const result = validateBuildSkillOutput(modelAnswer(envelope), source.coaching, source.prepared);
    // Unique, conservative native name prevents shadowing unrelated skills by name.
    result.name = 'ba-coach-' + String(result.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) + '-' + draft.getUniqueValue().slice(0, 12);
    result.actualModel = String(envelope.model);
    draft.setValue('result_json', JSON.stringify(result));
    draft.setValue('status', 'completed');
    draft.setValue('finished_at', now());
    draft.update();
  } catch (_) {
    failDraft(draft, 'The model did not return a valid, grounded skill preview. Build the skill again to retry.');
  }
}

export function buildSkillInstall(request: any, response: any): void {
  handle(response, () => {
    const body = request.body.data || {};
    if (body.confirm !== true) throw new CoachingError(400, 'Review the preview and explicitly confirm Create and install skill.');
    const {draft, context} = authorizedDraft(body.draftId, true);
    if (val(draft, 'status') !== 'completed') throw new CoachingError(409, 'Wait for a completed skill preview before installing it.');
    const result = parse(val(draft, 'result_json'));
    if (!result || typeof body.previewHash !== 'string' || body.previewHash !== previewHash(draft, result)) {
      throw new CoachingError(409, 'The skill preview changed or is missing. Review the current preview before confirming.');
    }
    const record = nativeSkill(context.owner.id);
    const id = nativeId(draft);
    const existing = new GlideRecordSecure(SKILL_TABLE);
    const installation = (alreadyInstalled: boolean) => ({skillId: id, name: result.name, owner: context.owner,
      allScopes: true, ownerOnly: true, alreadyInstalled});
    if (existing.get(id)) {
      if (!sameSkill(existing, draft, result)) throw new CoachingError(409, 'The existing skill was modified. It will not be overwritten.');
      return installation(true);
    }
    record.setNewGuidValue(id);
    record.setValue('name', result.name);
    record.setValue('description', result.description);
    record.setValue('body', result.body);
    // Native ACLs, validation and active-skill limits remain in force.
    const inserted = record.insert();
    if (!inserted) {
      if (existing.get(id) && sameSkill(existing, draft, result)) return installation(true);
      throw new CoachingError(409, 'Build Agent could not install this skill. Check your permissions and the active personal skill limit, then retry.');
    }
    if (!existing.get(id) || !sameSkill(existing, draft, result)) {
      throw new CoachingError(500, 'The skill could not be verified after installation. Check your personal Build Agent skills before retrying.');
    }
    response.setStatus(201);
    return installation(false);
  });
}
