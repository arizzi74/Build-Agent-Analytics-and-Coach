import '@servicenow/sdk/global';
import { Acl, CrossScopePrivilege, DateTimeColumn, ReferenceColumn, ScriptInclude, StringColumn, Table } from '@servicenow/sdk/core';
import application from '../../../now.config.json';
import packageMetadata from '../../../package.json';

// Drafts are private application data. Native Build Agent skills are created
// only by the authenticated install endpoint after exact-preview confirmation.
export const x_snc_build_agranx_coaching_skill_draft = Table({
  name: 'x_snc_build_agranx_coaching_skill_draft', label: 'Build Agent Coaching Skill Preview',
  accessibleFrom: 'package_private', allowWebServiceAccess: false,
  schema: {
    requested_by: ReferenceColumn({label: 'Requested by', referenceTable: 'sys_user', mandatory: true}),
    coaching_job: ReferenceColumn({label: 'Coaching analysis', referenceTable: 'x_snc_build_agranx_coaching_job', mandatory: true}),
    conversation_owner: ReferenceColumn({label: 'Conversation owner', referenceTable: 'sys_user', mandatory: true}),
    source_hash: StringColumn({label: 'Analysis and owner fingerprint', maxLength: 64, mandatory: true}),
    request_key: StringColumn({label: 'Request key', maxLength: 64, mandatory: true, unique: true}),
    status: StringColumn({label: 'Status', maxLength: 20, default: 'running'}),
    model: StringColumn({label: 'Model', maxLength: 80}),
    config_id: StringColumn({label: 'Model configuration', maxLength: 32}),
    prompt_config_id: StringColumn({label: 'Prompt configuration', maxLength: 32}),
    source_json: StringColumn({label: 'Reviewed evidence', maxLength: 300000}),
    result_json: StringColumn({label: 'Skill preview', maxLength: 16000}),
    error_message: StringColumn({label: 'Error', maxLength: 500}),
    finished_at: DateTimeColumn({label: 'Finished at'}),
  },
});

Acl({$id: Now.ID['build_skill_draft_read'], type: 'record', operation: 'read', table: 'x_snc_build_agranx_coaching_skill_draft', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['build_skill_draft_create'], type: 'record', operation: 'create', table: 'x_snc_build_agranx_coaching_skill_draft', roles: ['admin']});
Acl({$id: Now.ID['build_skill_draft_write'], type: 'record', operation: 'write', table: 'x_snc_build_agranx_coaching_skill_draft', roles: ['admin']});
Acl({$id: Now.ID['build_skill_draft_delete'], type: 'record', operation: 'delete', table: 'x_snc_build_agranx_coaching_skill_draft', roles: ['admin']});

ScriptInclude({
  $id: Now.ID['build_skill_callback'], name: 'BABuildSkillCallback',
  description: 'Completes a private skill preview; never installs a Build Agent skill.',
  accessibleFrom: 'public', clientCallable: false, active: true,
  script: `var BABuildSkillCallback = Class.create();
BABuildSkillCallback.prototype = {
  initialize: function() {},
  processCompleted: function(response) { this._handle(response, 'completed'); },
  processErrored: function(response) { this._handle(response, 'failed'); },
  processCancelled: function(response) { this._handle(response, 'cancelled'); },
  _handle: function(response, outcome) {
    require('${application.scope}/${packageMetadata.name}/${packageMetadata.version}/src/server/buildSkill.ts').buildSkillCallback(response, outcome);
  },
  type: 'BABuildSkillCallback'
};`,
});

CrossScopePrivilege({$id: Now.ID['build_skill_native_read'], targetName: 'sn_build_agent_user_instruction', targetScope: '6805ff49c0eb46ee969d42f0dd56b3bf', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['build_skill_native_create'], targetName: 'sn_build_agent_user_instruction', targetScope: '6805ff49c0eb46ee969d42f0dd56b3bf', targetType: 'sys_db_object', operation: 'create', status: 'allowed'});
