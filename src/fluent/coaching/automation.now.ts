import '@servicenow/sdk/global';
import { Acl, BooleanColumn, BusinessRule, CrossScopePrivilege, DateTimeColumn, IntegerColumn, Record, ReferenceColumn, ScriptAction, ScriptInclude, StringColumn, Table } from '@servicenow/sdk/core';
import { automationToolCompleted, automationEvent } from '../../server/coachAutomation';
import application from '../../../now.config.json';
import packageMetadata from '../../../package.json';

export const x_snc_build_agranx_coach_preferences = Table({name: 'x_snc_build_agranx_coach_preferences', label: 'Personal Coach Preferences', accessibleFrom: 'package_private', allowWebServiceAccess: false, schema: {
  owner_key: StringColumn({label: 'Unique owner', maxLength: 32, mandatory: true, unique: true}),
  user: ReferenceColumn({label: 'User', referenceTable: 'sys_user', mandatory: true}),
  automatic_enabled: BooleanColumn({label: 'Automatic coaching', default: false}),
  active_enabled: BooleanColumn({label: 'Active coach overlay', default: false}),
  model: StringColumn({label: 'Selected model', maxLength: 80, default: 'gpt-5.6-sol'}),
  epoch: StringColumn({label: 'Settings revision', maxLength: 32}),
  enabled_at: DateTimeColumn({label: 'Automatic coaching enabled at'}),
}});

export const x_snc_build_agranx_coach_memory = Table({name: 'x_snc_build_agranx_coach_memory', label: 'Private Conversation Coach Memory', accessibleFrom: 'package_private', allowWebServiceAccess: false, schema: {
  memory_key: StringColumn({label: 'Unique owner and conversation', maxLength: 64, mandatory: true, unique: true}),
  user: ReferenceColumn({label: 'User', referenceTable: 'sys_user', mandatory: true}),
  conversation_id: StringColumn({label: 'Conversation', maxLength: 32, mandatory: true}),
  memory_json: StringColumn({label: 'Bounded progressive memory', maxLength: 16000}),
  latest_tip_json: StringColumn({label: 'Latest coaching tip', maxLength: 3000}),
  lease_id: StringColumn({label: 'Current analysis', maxLength: 32}),
  lease_until: DateTimeColumn({label: 'Analysis lease expires'}),
  last_job: StringColumn({label: 'Last completed analysis', maxLength: 32}),
}});

export const x_snc_build_agranx_coach_work = Table({name: 'x_snc_build_agranx_coach_work', label: 'Automatic Coach Work', accessibleFrom: 'package_private', allowWebServiceAccess: false, schema: {
  request_key: StringColumn({label: 'Unique request', maxLength: 64, mandatory: true, unique: true}),
  kind: StringColumn({label: 'Kind', maxLength: 20}),
  user: ReferenceColumn({label: 'User', referenceTable: 'sys_user', mandatory: true}),
  conversation_id: StringColumn({label: 'Conversation', maxLength: 32}),
  message_id: StringColumn({label: 'Completed tool message', maxLength: 32}),
  sequence: IntegerColumn({label: 'Message sequence'}),
  epoch: StringColumn({label: 'Settings revision', maxLength: 32}),
  run_token: StringColumn({label: 'Atomic execution token', maxLength: 32}),
  model: StringColumn({label: 'Selected model', maxLength: 80}),
  config_id: StringColumn({label: 'Model configuration', maxLength: 32}),
  prompt_config_id: StringColumn({label: 'Prompt configuration', maxLength: 32}),
  status: StringColumn({label: 'Status', maxLength: 20, default: 'queued'}),
  prepared_json: StringColumn({label: 'Transient sanitized context', maxLength: 300000}),
  result_json: StringColumn({label: 'Validated result', maxLength: 24000}),
  error_message: StringColumn({label: 'Error', maxLength: 500}),
  started_at: DateTimeColumn({label: 'Started at'}),
  finished_at: DateTimeColumn({label: 'Finished at'}),
}, index: [{name: 'coach_work_queue', unique: false, element: ['user', 'conversation_id', 'kind', 'status', 'sequence']}]});

// No direct client table writes or reads: authenticated REST binds every access
// to the signed-in user and checks ownership of the native conversation.
Acl({$id: Now.ID['coach_preferences_read'], type: 'record', operation: 'read', table: 'x_snc_build_agranx_coach_preferences', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_preferences_create'], type: 'record', operation: 'create', table: 'x_snc_build_agranx_coach_preferences', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_preferences_write'], type: 'record', operation: 'write', table: 'x_snc_build_agranx_coach_preferences', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_preferences_delete'], type: 'record', operation: 'delete', table: 'x_snc_build_agranx_coach_preferences', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_memory_read'], type: 'record', operation: 'read', table: 'x_snc_build_agranx_coach_memory', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_memory_create'], type: 'record', operation: 'create', table: 'x_snc_build_agranx_coach_memory', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_memory_write'], type: 'record', operation: 'write', table: 'x_snc_build_agranx_coach_memory', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_memory_delete'], type: 'record', operation: 'delete', table: 'x_snc_build_agranx_coach_memory', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_work_read'], type: 'record', operation: 'read', table: 'x_snc_build_agranx_coach_work', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_work_create'], type: 'record', operation: 'create', table: 'x_snc_build_agranx_coach_work', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_work_write'], type: 'record', operation: 'write', table: 'x_snc_build_agranx_coach_work', roles: ['admin'], adminOverrides: true});
Acl({$id: Now.ID['coach_work_delete'], type: 'record', operation: 'delete', table: 'x_snc_build_agranx_coach_work', roles: ['admin'], adminOverrides: true});

Record({$id: Now.ID['coach_automation_event'], table: 'sysevent_register', data: {event_name: 'x_snc_build_agranx.coach.work', table: 'x_snc_build_agranx_coach_work', description: 'Process one opted-in completed tool event or expire a coaching request.', fired_by: 'BA Analytics automatic coach'}});
ScriptAction({$id: Now.ID['coach_automation_worker'], name: 'BA automatic coach worker', eventName: 'x_snc_build_agranx.coach.work', active: true, script: automationEvent});
BusinessRule({$id: Now.ID['coach_automation_tool_hook'], name: 'BA coach completed tool', table: 'sn_build_agent_message', when: 'after', action: ['insert', 'update'], order: 1100, active: true, script: automationToolCompleted,
  description: 'Queue a private coaching checkpoint only when a native tool completes and its conversation owner opted in.'});

ScriptInclude({$id: Now.ID['coach_automation_callback'], name: 'BAAutomationCallback', accessibleFrom: 'public', clientCallable: false, active: true, description: 'Validates model, owner, settings revision and conversation lease before saving automatic coaching.', script: `var BAAutomationCallback = Class.create();
BAAutomationCallback.prototype = {
  initialize: function() {},
  processCompleted: function(response) { this._handle(response, 'completed'); },
  processErrored: function(response) { this._handle(response, 'failed'); },
  processCancelled: function(response) { this._handle(response, 'cancelled'); },
  _handle: function(response, outcome) {
    require('${application.scope}/${packageMetadata.name}/${packageMetadata.version}/src/server/coachAutomation.ts').automationCallback(response, outcome);
  },
  type: 'BAAutomationCallback'
};`});

Record({$id: Now.ID['coach_automation_ui_script'], table: 'sys_ui_script', data: {name: 'x_snc_build_agranx.active_coach', active: true, global: false, ui_type: '10', description: 'Persistent opt-in Otto coach overlay for the native Studio Build Agent editor.', script: Now.include('../../overlay/activeCoach.js')}});

CrossScopePrivilege({$id: Now.ID['coach_automation_user_read'], targetName: 'sys_user', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coach_automation_role_read'], targetName: 'sys_user_has_role', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
CrossScopePrivilege({$id: Now.ID['coach_automation_role_name_read'], targetName: 'sys_user_role', targetScope: 'global', targetType: 'sys_db_object', operation: 'read', status: 'allowed'});
