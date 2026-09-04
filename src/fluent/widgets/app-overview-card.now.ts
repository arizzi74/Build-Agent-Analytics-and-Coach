import { Record } from '@servicenow/sdk/core'

const component = `import { html, css } from 'lit';
import { AIUXWidgetElement } from '@servicenow/aiux-components-core';
import { i18n } from '@servicenow/aiux-services';

class AppOverviewCard extends AIUXWidgetElement {
  static properties = {
    appId: { type: String, attribute: 'app-id' },
    _appName: { type: String, state: true },
    _conversations: { type: Number, state: true },
    _userMessages: { type: Number, state: true },
    _nauUnits: { type: Number, state: true },
    _implDuration: { type: String, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _lastLoadedId: { type: String, state: true },
  };

  constructor() {
    super();
    this.appId = '';
    this._appName = '';
    this._conversations = 0;
    this._userMessages = 0;
    this._nauUnits = 0;
    this._implDuration = '';
    this._loading = true;
    this._error = '';
    this._lastLoadedId = '';
    this.MSG = {
      conversations: i18n.getMessage('Conversations'),
      userMessages: i18n.getMessage('User Messages'),
      nau: i18n.getMessage('NowAssist Units'),
      implDuration: i18n.getMessage('Impl. Duration'),
      loading: i18n.getMessage('Loading...'),
      noApp: i18n.getMessage('No application selected'),
      error: i18n.getMessage('Unable to load application data'),
    };
  }

  updated() {
    if (this.appId && this.appId !== this._lastLoadedId) {
      this._lastLoadedId = this.appId;
      this._fetch();
    }
  }

  async _fetch() {
    this._loading = true;
    this._error = '';
    try {
      const res = await this.server.get({ action: 'getOverview', appId: this.appId });
      const d = (res && res.data) ? res.data : res;
      this._applyData(d);
    } catch (e) {
      this._loading = false;
      this._error = this.MSG.error;
    }
  }

  onDataChange(newData) {
    if (newData) this._applyData(newData);
  }

  _applyData(d) {
    if (!d) return;
    if (d.error) {
      this._error = d.error;
      this._loading = false;
      return;
    }
    if (d.appName === undefined && d.conversationCount === undefined) return;
    this._appName = d.appName || '';
    this._conversations = Number(d.conversationCount) || 0;
    this._userMessages = Number(d.userMessages) || 0;
    this._nauUnits = Number(d.nauUnits) || 0;
    this._implDuration = d.implDuration || '—';
    this._loading = false;
    this._error = '';
  }

  _fmt(n) {
    try {
      return Number(n).toLocaleString('en-US');
    } catch (e) {
      return String(n);
    }
  }

  render() {
    if (!this.appId) {
      return html\`<div class="card card--empty">\${this.MSG.noApp}</div>\`;
    }
    if (this._loading) {
      return html\`<div class="card card--empty">\${this.MSG.loading}</div>\`;
    }
    if (this._error) {
      return html\`<div class="card card--error">\${this._error}</div>\`;
    }
    return html\`
      <div class="card">
        <h2 class="card__title">\${this._appName}</h2>
        <div class="kpis">
          <div class="kpi">
            <span class="kpi__value">\${this._fmt(this._conversations)}</span>
            <span class="kpi__label">\${this.MSG.conversations}</span>
          </div>
          <div class="kpi">
            <span class="kpi__value">\${this._fmt(this._userMessages)}</span>
            <span class="kpi__label">\${this.MSG.userMessages}</span>
          </div>
          <div class="kpi kpi--accent">
            <span class="kpi__value">\${this._fmt(this._nauUnits)}</span>
            <span class="kpi__label">\${this.MSG.nau}</span>
          </div>
          <div class="kpi kpi--duration">
            <span class="kpi__value">\${this._implDuration}</span>
            <span class="kpi__label">\${this.MSG.implDuration}</span>
          </div>
        </div>
      </div>
    \`;
  }

  static styles = css\`
    :host {
      display: block;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: calc(var(--now-spacing, 4px) * 3);
      padding: calc(var(--now-spacing, 4px) * 4);
      background-color: rgb(var(--now-container--primary--background-color, 255, 255, 255));
      border: 1px solid rgb(var(--now-container--divider--color, 226, 226, 226));
      border-radius: var(--now-container--border-radius, 6px);
      color: rgb(var(--now-color--neutral-22, 22, 27, 34));
      font-family: var(--now-font-family, inherit);
    }
    .card--empty,
    .card--error {
      align-items: center;
      justify-content: center;
      min-height: 96px;
      color: rgb(var(--now-color--neutral-11, 108, 115, 122));
    }
    .card--error {
      color: rgb(var(--now-color--critical, 214, 51, 61));
    }
    .card__title {
      margin: 0;
      font-size: var(--now-font-size--lg, 18px);
      font-weight: var(--now-font-weight--bold, 700);
      color: rgb(var(--now-color--neutral-22, 22, 27, 34));
    }
    .kpis {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--now-spacing, 4px) * 3);
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: calc(var(--now-spacing, 4px) * 1);
      flex: 1 1 120px;
      padding: calc(var(--now-spacing, 4px) * 3);
      background-color: rgb(var(--now-color--neutral-2, 244, 245, 246));
      border-radius: var(--now-container--border-radius, 6px);
    }
    .kpi--accent {
      background-color: rgb(var(--now-color--brand-primary-1, 224, 242, 246));
    }
    .kpi--duration {
      background-color: rgb(var(--now-color--warning-1, 255, 244, 222));
    }
    .kpi__value {
      font-size: var(--now-font-size--xl, 24px);
      font-weight: var(--now-font-weight--bold, 700);
      color: rgb(var(--now-color--neutral-22, 22, 27, 34));
    }
    .kpi__label {
      font-size: var(--now-font-size--sm, 12px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: rgb(var(--now-color--neutral-11, 108, 115, 122));
    }
  \`;
}
`

const script = `(function (data, options, input) {
  if (!input || !input.action) return;
  switch (input.action) {
    case 'getOverview': {
      var appId = (input.appId || '').toString().trim();
      if (!GlideStringUtil.isEligibleSysID(appId)) {
        data.error = 'Invalid application sys_id';
        return;
      }

      // Resolve app name from sys_app
      var appName = '';
      var appGr = new GlideRecord('sys_app');
      if (appGr.get(appId)) {
        appName = appGr.getValue('name') || '';
      }

      // Fetch all conversations for this application
      var convoIds = [];
      var convo = new GlideRecord('sn_build_agent_conversation');
      convo.addQuery('application_id', appId);
      convo.query();
      while (convo.next()) {
        convoIds.push(convo.getUniqueValue());
        if (!appName) {
          var an = convo.getValue('application_name');
          if (an) appName = an;
        }
      }

      // Fetch all messages for these conversations, ordered by sys_created_on
      var userMessages = 0;
      var totalImplMs = 0;

      if (convoIds.length > 0) {
        var msg = new GlideRecord('sn_build_agent_message');
        msg.addQuery('conversation', 'IN', convoIds.join(','));
        msg.orderBy('sys_created_on');
        msg.query();

        // Group messages by conversation for turn-based duration calculation
        var convoMessages = {};
        while (msg.next()) {
          var raw = msg.getValue('content');
          var createdOn = msg.getValue('sys_created_on');
          var convoId = msg.getValue('conversation');
          if (!raw || !createdOn) continue;

          var sender = '';
          try {
            var parsed = JSON.parse(raw);
            sender = (parsed && parsed.sender) ? parsed.sender : '';
          } catch (e) { continue; }

          if (sender === 'user') userMessages++;

          // Collect for duration calculation
          if (!convoMessages[convoId]) convoMessages[convoId] = [];
          convoMessages[convoId].push({ sender: sender, ts: new GlideDateTime(createdOn).getNumericValue() });
        }

        // Calculate implementation duration per conversation using turn-based algorithm
        // A "turn" starts with a user message and ends at the last assistant message
        // before the next user message. Duration = last_assistant_ts - user_ts.
        for (var cId in convoMessages) {
          var msgs = convoMessages[cId];
          // Already ordered by sys_created_on from the query
          var currentTurnStart = -1;
          var lastAssistantInTurn = -1;

          for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            if (m.sender === 'user') {
              // Close previous turn if it had an assistant response
              if (currentTurnStart >= 0 && lastAssistantInTurn >= 0) {
                totalImplMs += (lastAssistantInTurn - currentTurnStart);
              }
              // Start new turn
              currentTurnStart = m.ts;
              lastAssistantInTurn = -1;
            } else {
              // Any non-user message counts as assistant response
              if (currentTurnStart >= 0) {
                lastAssistantInTurn = m.ts;
              }
            }
          }
          // Close the last turn
          if (currentTurnStart >= 0 && lastAssistantInTurn >= 0) {
            totalImplMs += (lastAssistantInTurn - currentTurnStart);
          }
        }
      }

      // Format duration as "Xh Ym" or "Xm" or "< 1m"
      var implDuration = '';
      if (totalImplMs <= 0) {
        implDuration = '—';
      } else {
        var totalMinutes = Math.round(totalImplMs / 60000);
        if (totalMinutes < 1) {
          implDuration = '< 1m';
        } else {
          var hours = Math.floor(totalMinutes / 60);
          var minutes = totalMinutes % 60;
          if (hours === 0) {
            implDuration = minutes + 'm';
          } else if (minutes === 0) {
            implDuration = hours + 'h';
          } else {
            implDuration = hours + 'h ' + minutes + 'm';
          }
        }
      }

      data.appId = appId;
      data.appName = appName || ('App (' + appId.substring(0, 8) + '...)');
      data.conversationCount = convoIds.length;
      data.userMessages = userMessages;
      data.nauUnits = userMessages * 25;
      data.implDuration = implDuration;
      break;
    }
    default:
      data.error = 'Invalid action';
  }
})(data, options, input);`

const componentCompileMetadata = JSON.stringify({
    imports: {
        lit: ['html', 'css'],
        '@servicenow/aiux-components-core': ['AIUXWidgetElement'],
        '@servicenow/aiux-services': ['i18n'],
    },
    elementClassName: 'AppOverviewCard',
    importBoundaries: [0, 152],
    hasServerScript: true,
})

Record({
    $id: Now.ID['app_overview_card_widget'],
    table: 'sys_aix_widget',
    data: {
        name: 'App Overview Card',
        id: 'app-overview-card',
        type: 'aix_widget',
        purpose: 'component',
        category: 'custom',
        simple_widget: 'false',
        has_loader: 'false',
        chat_compatible: 'false',
        interactive_view_compatible: 'false',
        component: component,
        script: script,
        input_schema: JSON.stringify({
            appId: {
                type: 'String',
                description:
                    'The sys_id of the application record (sys_app). Matches the application_id field on Build Agent conversations.',
            },
        }),
        component_compile_metadata: componentCompileMetadata,
        description:
            'Displays a compact overview card for a single application managed by Build Agent. Shows the app name, number of conversations, user message count, NowAssist Unit cost (25 NAU per user message), and total implementation duration computed from turn-based working intervals. Designed to be served by an AI Agent when a user asks about a specific application.',
        best_for:
            'Summarizing a single Build Agent application at a glance — name, conversation count, user message count, NowAssist Unit cost, and implementation duration. Ideal for conversational navigation where an AI agent has resolved an application and wants to show its key usage metrics as a card.',
        servicenow: 'false',
    },
})
