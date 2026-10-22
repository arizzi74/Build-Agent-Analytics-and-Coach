import '@servicenow/sdk/global';
import { Acl, CrossScopePrivilege, DateTimeColumn, Record, ReferenceColumn, RestApi, ScriptInclude, StringColumn, Table } from '@servicenow/sdk/core';
import { coachingModels, coachingPrepare, coachingAnalyze, coachingJob } from '../../server/coaching';
import { buildSkillPreview, buildSkillDraft, buildSkillInstall } from '../../server/buildSkill';
import { automationSettings, automationSaveSettings, automationState, automationRevision, automationGetRevision } from '../../server/coachAutomation';
import application from '../../../now.config.json';
import packageMetadata from '../../../package.json';

// Keep these configurations separate from the instance's default Generic Prompt models.
// OneExtend Mosaic requires both the AI config ID and its prompt config ID per request.
export const coachingGptConfig = Record({
  $id: Now.ID['5bd5c0123b441b50d0c6ab7e53e45a7f'],
  table: 'sys_generative_ai_config',
  data: {
    name: 'BA Analytics Coaching - GPT-5.6 Sol', model: 'gpt-5.6-sol',
    definition_table: 'sys_one_extend_capability_definition', definition: '2bd460e7534221106b38ddeeff7b1221',
    active: true, state: 'published', version: 1, prompt: '{{prompt}}', prompt_template_role: 'user',
    max_tokens: 4096, request_tokens: 1045654, min_word_count: -1, temperature: 1, thinking_tokens: 0,
    structured_output_enabled: false, additional_configurations: '{"reasoning_effort":"low"}',
  },
});

export const coachingOpusConfig = Record({
  $id: Now.ID['2fd544523b441b50d0c6ab7e53e45a9d'],
  table: 'sys_generative_ai_config',
  data: {
    name: 'BA Analytics Coaching - Claude Opus 5', model: 'claude-opus-5',
    definition_table: 'sys_one_extend_capability_definition', definition: 'ad6f072f9fec5210da502fca9a0a1c59',
    active: true, state: 'published', version: 1, prompt: '{{prompt}}', prompt_template_role: 'user',
    max_tokens: 4096, request_tokens: 995654, min_word_count: -1, temperature: 1, thinking_tokens: 0,
    structured_output_enabled: false, additional_configurations: '{"reasoning_effort":"low","thinking_type":"adaptive"}',
  },
});

Record({
  $id: Now.ID['9bd544523b441b50d0c6ab7e53e45a8b'], table: 'sys_generative_ai_prompt_config',
  data: {ai_config: coachingGptConfig, definition: '2bd460e7534221106b38ddeeff7b1221',
    is_default: false, filter_type: 'default', filter_properties: '', order: 0},
});

Record({
  $id: Now.ID['e3d544523b441b50d0c6ab7e53e45ade'], table: 'sys_generative_ai_prompt_config',
  data: {ai_config: coachingOpusConfig, definition: 'ad6f072f9fec5210da502fca9a0a1c59',
    is_default: false, filter_type: 'default', filter_properties: '', order: 0},
});

ScriptInclude({
  $id: Now.ID['coaching_callback'], name: 'BACoachingCallback',
  description: 'Completes BA Analytics coaching jobs from OneExtend asynchronous callbacks.',
  accessibleFrom: 'public', clientCallable: false, active: true,
  script: `var BACoachingCallback = Class.create();
BACoachingCallback.prototype = {
  initialize: function() {},
  processCompleted: function(response) { this._handle(response, 'completed'); },
  processErrored: function(response) { this._handle(response, 'failed'); },
  processCancelled: function(response) { this._handle(response, 'cancelled'); },
  _handle: function(response, outcome) {
    require('${application.scope}/${packageMetadata.name}/${packageMetadata.version}/src/server/coaching.ts').coachingCallback(response, outcome);
  },
  type: 'BACoachingCallback'
};`,
});

export const x_snc_build_agranx_coaching_job = Table({
  name: 'x_snc_build_agranx_coaching_job',
  label: 'Build Agent Conversation Coaching',
  accessibleFrom: 'package_private',
  allowWebServiceAccess: false,
  schema: {
    requested_by: ReferenceColumn({label: 'Requested by', referenceTable: 'sys_user', mandatory: true}),
    conversation_id: StringColumn({label: 'Conversation', maxLength: 32, mandatory: true}),
    model: StringColumn({label: 'Model', maxLength: 80, mandatory: true}),
    model_label: StringColumn({label: 'Model label', maxLength: 120}),
    capability_id: StringColumn({label: 'Capability', maxLength: 32}),
    config_id: StringColumn({label: 'Model configuration', maxLength: 32}),
    prompt_config_id: StringColumn({label: 'Prompt configuration', maxLength: 32}),
    transaction_id: StringColumn({label: 'One Extend transaction', maxLength: 80}),
    input_hash: StringColumn({label: 'Input fingerprint', maxLength: 64}),
    request_key: StringColumn({label: 'Request key', maxLength: 64}),
    status: StringColumn({label: 'Status', maxLength: 20, default: 'queued'}),
    prepared_json: StringColumn({label: 'Prepared conversation', maxLength: 300000}),
    result_json: StringColumn({label: 'Coaching result', maxLength: 32000}),
    error_message: StringColumn({label: 'Error', maxLength: 500}),
    finished_at: DateTimeColumn({label: 'Finished at'}),
  },
  index: [
    {name: 'coaching_owner_conversation', unique: false, element: ['requested_by', 'conversation_id', 'model', 'input_hash']},
    {name: 'coaching_request_key', unique: true, element: ['request_key']},
  ],
});

Acl({$id: Now.ID['coaching_job_read'], type: 'record', operation: 'read', table: 'x_snc_build_agranx_coaching_job',
  roles: ['admin'], adminOverrides: true});
// Writes are made only by the authorized service; clients cannot manufacture jobs.
Acl({$id: Now.ID['coaching_job_create'], type: 'record', operation: 'create', table: 'x_snc_build_agranx_coaching_job', roles: ['admin']});
Acl({$id: Now.ID['coaching_job_write'], type: 'record', operation: 'write', table: 'x_snc_build_agranx_coaching_job', roles: ['admin']});
Acl({$id: Now.ID['coaching_job_delete'], type: 'record', operation: 'delete', table: 'x_snc_build_agranx_coaching_job', roles: ['admin']});

const coachingAccess = Acl({$id: Now.ID['coaching_api_access'], type: 'rest_endpoint', operation: 'execute',
  name: 'BA Analytics Conversation Coaching', securityAttribute: 'user_is_authenticated', adminOverrides: true});

RestApi({
  $id: Now.ID['coaching_api'], name: 'BA Analytics Conversation Coaching', serviceId: 'coaching', active: true,
  consumes: 'application/json', produces: 'application/json', enforceAcl: [coachingAccess],
  routes: [
    {$id: Now.ID['coach_automation_settings_get'], name: 'Get personal coach settings', method: 'GET', path: '/automation/settings', script: automationSettings, authentication: true, authorization: true},
    {$id: Now.ID['coach_automation_settings_save'], name: 'Save personal coach settings', method: 'PATCH', path: '/automation/settings', script: automationSaveSettings, authentication: true, authorization: true},
    {$id: Now.ID['coach_automation_state'], name: 'Get private conversation coach state', method: 'GET', path: '/automation/state', script: automationState, authentication: true, authorization: true},
    {$id: Now.ID['coach_automation_revision_create'], name: 'Request a prompt revision', method: 'POST', path: '/automation/revisions', script: automationRevision, authentication: true, authorization: true},
    {$id: Now.ID['coach_automation_revision_get'], name: 'Get a prompt revision', method: 'GET', path: '/automation/revisions/{revisionId}', script: automationGetRevision, authentication: true, authorization: true},
    {$id: Now.ID['coaching_models_route'], name: 'Available coaching models', method: 'GET', path: '/models', script: coachingModels, authentication: true, authorization: true},
    {$id: Now.ID['coaching_prepare_route'], name: 'Prepare conversation', method: 'POST', path: '/prepare', script: coachingPrepare, authentication: true, authorization: true},
    {$id: Now.ID['coaching_analyze_route'], name: 'Analyze conversation', method: 'POST', path: '/analyze', script: coachingAnalyze, authentication: true, authorization: true},
    {$id: Now.ID['coaching_job_route'], name: 'Get coaching result', method: 'GET', path: '/jobs/{jobId}', script: coachingJob, authentication: true, authorization: true},
    {$id: Now.ID['build_skill_preview_route'], name: 'Preview personal Build Agent skill', method: 'POST', path: '/skills/preview', script: buildSkillPreview, authentication: true, authorization: true},
    {$id: Now.ID['build_skill_draft_route'], name: 'Get personal skill preview', method: 'GET', path: '/skills/previews/{draftId}', script: buildSkillDraft, authentication: true, authorization: true},
    {$id: Now.ID['build_skill_install_route'], name: 'Confirm and install personal Build Agent skill', method: 'POST', path: '/skills/install', script: buildSkillInstall, authentication: true, authorization: true},
  ],
});

CrossScopePrivilege({$id: Now.ID['coaching_model_catalog_read'], targetName: 'sys_generative_ai_model_config', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_config_read'], targetName: 'sys_generative_ai_config', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_prompt_config_read'], targetName: 'sys_generative_ai_prompt_config', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_capability_read'], targetName: 'sys_one_extend_capability', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_definition_read'], targetName: 'sys_one_extend_capability_definition', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_mapping_read'], targetName: 'sys_one_extend_definition_config', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_flow_read'], targetName: 'sys_hub_flow', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coaching_one_extend_execute'], targetName: 'OneExtendUtil.execute', targetScope: 'sn_one_extend', targetType: 'scriptable', operation: 'execute', status: 'allowed'});
