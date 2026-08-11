import { Record } from '@servicenow/sdk/core'

const component = `import { html, css, svg } from 'lit';
import { AIUXWidgetElement } from '@servicenow/aiux-components-core';
import { i18n } from '@servicenow/aiux-services';

class NauConsumptionChart extends AIUXWidgetElement {
  static properties = {
    month: { type: String, attribute: 'month' },
    _monthLabel: { type: String, state: true },
    _totalNau: { type: Number, state: true },
    _totalUsers: { type: Number, state: true },
    _totalConversations: { type: Number, state: true },
    _users: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _lastLoadedMonth: { type: String, state: true },
  };

  constructor() {
    super();
    this.month = '';
    this._monthLabel = '';
    this._totalNau = 0;
    this._totalUsers = 0;
    this._totalConversations = 0;
    this._users = [];
    this._loading = true;
    this._error = '';
    this._lastLoadedMonth = '';
    this.MSG = {
      title: i18n.getMessage('NAU Consumption'),
      totalNau: i18n.getMessage('Total NAU'),
      users: i18n.getMessage('Users'),
      conversations: i18n.getMessage('Conversations'),
      loading: i18n.getMessage('Loading...'),
      noData: i18n.getMessage('No consumption data for this period'),
      error: i18n.getMessage('Unable to load consumption data'),
      formula: i18n.getMessage('1 user message = 25 NAU'),
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._triggerLoad();
  }

  updated() {
    this._triggerLoad();
  }

  _triggerLoad() {
    var effectiveMonth = this.month || this._getCurrentMonth();
    if (effectiveMonth !== this._lastLoadedMonth) {
      this._lastLoadedMonth = effectiveMonth;
      this._fetch(effectiveMonth);
    }
  }

  _getCurrentMonth() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  async _fetch(month) {
    this._loading = true;
    this._error = '';
    try {
      var res = await this.server.get({ action: 'getConsumption', month: month });
      var d = (res && res.data) ? res.data : res;
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
    if (d.error) { this._error = d.error; this._loading = false; return; }
    this._monthLabel = d.monthLabel || '';
    this._totalNau = Number(d.totalNau) || 0;
    this._totalUsers = Number(d.totalUsers) || 0;
    this._totalConversations = Number(d.totalConversations) || 0;
    this._users = Array.isArray(d.users) ? d.users : [];
    this._loading = false;
    this._error = '';
  }

  _fmt(n) {
    try { return Number(n).toLocaleString('en-US'); } catch(e) { return String(n); }
  }

  _renderChart() {
    var users = this._users;
    if (!users || users.length === 0) {
      return html\`<div class="chart-empty">\${this.MSG.noData}</div>\`;
    }

    var maxNau = Math.max(...users.map(function(u) { return u.nauUnits; }));
    if (maxNau === 0) maxNau = 1;

    var barHeight = 28;
    var barGap = 8;
    var labelWidth = 120;
    var valueWidth = 60;
    var chartLeft = labelWidth + 8;
    var chartRight = 16;
    var barAreaWidth = 280;
    var totalWidth = chartLeft + barAreaWidth + valueWidth + chartRight;
    var totalHeight = users.length * (barHeight + barGap) + barGap;

    var bars = users.map(function(u, i) {
      var y = barGap + i * (barHeight + barGap);
      var width = Math.max((u.nauUnits / maxNau) * barAreaWidth, 2);
      var pct = Math.round((u.nauUnits / this._totalNau) * 100);
      return svg\`
        <g class="bar-group">
          <text x="\${labelWidth}" y="\${y + barHeight / 2 + 4}" class="bar-label" text-anchor="end">\${u.userName.length > 16 ? u.userName.substring(0, 15) + '…' : u.userName}</text>
          <rect x="\${chartLeft}" y="\${y}" width="\${width}" height="\${barHeight}" rx="4" class="bar-rect" />
          <text x="\${chartLeft + width + 6}" y="\${y + barHeight / 2 + 4}" class="bar-value">\${this._fmt(u.nauUnits)} (\${pct}%)</text>
        </g>
      \`;
    }.bind(this));

    return html\`
      <svg class="chart-svg" viewBox="0 0 \${totalWidth} \${totalHeight}" preserveAspectRatio="xMinYMin meet">
        \${bars}
      </svg>
    \`;
  }

  render() {
    if (this._loading) {
      return html\`<div class="card card--empty">\${this.MSG.loading}</div>\`;
    }
    if (this._error) {
      return html\`<div class="card card--error">\${this._error}</div>\`;
    }
    return html\`
      <div class="card">
        <div class="header">
          <h2 class="header__title">\${this.MSG.title}</h2>
          <span class="header__month">\${this._monthLabel}</span>
        </div>
        <div class="kpis">
          <div class="kpi kpi--accent">
            <span class="kpi__value">\${this._fmt(this._totalNau)}</span>
            <span class="kpi__label">\${this.MSG.totalNau}</span>
          </div>
          <div class="kpi">
            <span class="kpi__value">\${this._fmt(this._totalUsers)}</span>
            <span class="kpi__label">\${this.MSG.users}</span>
          </div>
          <div class="kpi">
            <span class="kpi__value">\${this._fmt(this._totalConversations)}</span>
            <span class="kpi__label">\${this.MSG.conversations}</span>
          </div>
        </div>
        <div class="chart-container">
          \${this._renderChart()}
        </div>
        <div class="formula">\${this.MSG.formula}</div>
      </div>
    \`;
  }

  static styles = css\`
    :host { display: block; }
    .card {
      display: flex; flex-direction: column; gap: calc(var(--now-spacing, 4px) * 3);
      padding: calc(var(--now-spacing, 4px) * 4);
      background-color: rgb(var(--now-container--primary--background-color, 255, 255, 255));
      border: 1px solid rgb(var(--now-container--divider--color, 226, 226, 226));
      border-radius: var(--now-container--border-radius, 6px);
      color: rgb(var(--now-color--neutral-22, 22, 27, 34));
      font-family: var(--now-font-family, inherit);
    }
    .card--empty, .card--error {
      align-items: center; justify-content: center; min-height: 120px;
      color: rgb(var(--now-color--neutral-11, 108, 115, 122));
    }
    .card--error { color: rgb(var(--now-color--critical, 214, 51, 61)); }
    .header { display: flex; align-items: baseline; gap: calc(var(--now-spacing, 4px) * 2); flex-wrap: wrap; }
    .header__title { margin: 0; font-size: var(--now-font-size--lg, 18px); font-weight: var(--now-font-weight--bold, 700); }
    .header__month {
      font-size: var(--now-font-size--md, 14px); color: rgb(var(--now-color--neutral-11, 108, 115, 122));
      background: rgb(var(--now-color--neutral-2, 244, 245, 246));
      padding: 2px 10px; border-radius: 12px;
    }
    .kpis { display: flex; flex-wrap: wrap; gap: calc(var(--now-spacing, 4px) * 2); }
    .kpi {
      display: flex; flex-direction: column; gap: 2px; flex: 1 1 90px;
      padding: calc(var(--now-spacing, 4px) * 2);
      background-color: rgb(var(--now-color--neutral-2, 244, 245, 246));
      border-radius: var(--now-container--border-radius, 6px);
    }
    .kpi--accent { background-color: rgb(var(--now-color--brand-primary-1, 224, 242, 246)); }
    .kpi__value { font-size: var(--now-font-size--lg, 18px); font-weight: var(--now-font-weight--bold, 700); }
    .kpi__label { font-size: var(--now-font-size--xs, 11px); text-transform: uppercase; letter-spacing: 0.04em; color: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .chart-container { overflow-x: auto; }
    .chart-svg { width: 100%; height: auto; min-height: 60px; }
    .chart-empty { padding: calc(var(--now-spacing, 4px) * 4); text-align: center; color: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .bar-label { font-size: 11px; fill: rgb(var(--now-color--neutral-18, 50, 55, 62)); }
    .bar-rect { fill: rgb(var(--now-color--brand-primary, 0, 128, 163)); opacity: 0.85; }
    .bar-value { font-size: 11px; fill: rgb(var(--now-color--neutral-14, 77, 82, 89)); }
    .formula { font-size: var(--now-font-size--xs, 11px); color: rgb(var(--now-color--neutral-11, 108, 115, 122)); text-align: right; font-style: italic; }
  \`;
}
`

const script = `(function (data, options, input) {
  if (!input || !input.action) return;
  switch (input.action) {
    case 'getConsumption': {
      var monthStr = (input.month || '').toString().trim();

      // Default to current month if not provided
      if (!monthStr || !/^\\d{4}-\\d{2}$/.test(monthStr)) {
        var now = new GlideDateTime();
        monthStr = now.getYearUTC() + '-' + (now.getMonthUTC() < 10 ? '0' : '') + now.getMonthUTC();
      }

      var parts = monthStr.split('-');
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10);
      var startDate = monthStr + '-01';

      // Compute end date (first day of next month)
      var nextMonth = month === 12 ? 1 : month + 1;
      var nextYear = month === 12 ? year + 1 : year;
      var endDate = nextYear + '-' + (nextMonth < 10 ? '0' : '') + nextMonth + '-01';

      // Format month label (e.g. "August 2026")
      var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var monthLabel = monthNames[month - 1] + ' ' + year;

      // Fetch conversations in this date range
      var convo = new GlideRecord('sn_build_agent_conversation');
      convo.addQuery('sys_created_on', '>=', startDate);
      convo.addQuery('sys_created_on', '<', endDate);
      convo.query();

      var convoToUser = {};
      var convoIds = [];
      var userMap = {};

      while (convo.next()) {
        var cId = convo.getUniqueValue();
        var userId = convo.getValue('user') || '';
        convoIds.push(cId);
        convoToUser[cId] = userId;

        if (userId && !userMap[userId]) {
          userMap[userId] = { userId: userId, userName: '', conversations: 0, userMessages: 0, nauUnits: 0 };
        }
        if (userId) {
          userMap[userId].conversations++;
        }
      }

      // Count user messages per user
      if (convoIds.length > 0) {
        var msg = new GlideRecord('sn_build_agent_message');
        msg.addQuery('conversation', 'IN', convoIds.join(','));
        msg.query();
        while (msg.next()) {
          var raw = msg.getValue('content');
          var convoId = msg.getValue('conversation');
          if (!raw) continue;
          try {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.sender === 'user') {
              var uid = convoToUser[convoId];
              if (uid && userMap[uid]) {
                userMap[uid].userMessages++;
              }
            }
          } catch (e) { /* skip */ }
        }
      }

      // Resolve user display names and compute NAU
      var totalNau = 0;
      var totalConversations = 0;
      var userList = [];
      for (var uId in userMap) {
        var u = userMap[uId];
        u.nauUnits = u.userMessages * 25;
        totalNau += u.nauUnits;
        totalConversations += u.conversations;

        // Resolve display name
        var userGr = new GlideRecord('sys_user');
        if (userGr.get(uId)) {
          u.userName = userGr.getValue('name') || uId;
        } else {
          u.userName = uId;
        }
        userList.push(u);
      }

      // Sort by NAU descending, limit to top 10
      userList.sort(function(a, b) { return b.nauUnits - a.nauUnits; });
      userList = userList.slice(0, 10);

      data.monthLabel = monthLabel;
      data.totalNau = totalNau;
      data.totalUsers = Object.keys(userMap).length;
      data.totalConversations = totalConversations;
      data.users = userList;
      break;
    }
    default:
      data.error = 'Invalid action';
  }
})(data, options, input);`

const componentCompileMetadata = JSON.stringify({
  imports: {
    lit: ['html', 'css', 'svg'],
    '@servicenow/aiux-components-core': ['AIUXWidgetElement'],
    '@servicenow/aiux-services': ['i18n'],
  },
  elementClassName: 'NauConsumptionChart',
  importBoundaries: [0, 157],
  hasServerScript: true,
})

Record({
  $id: Now.ID['nau_consumption_chart_widget'],
  table: 'sys_aix_widget',
  data: {
    name: 'NAU Consumption Chart',
    id: 'nau-consumption-chart',
    type: 'aix_widget',
    purpose: 'component',
    category: 'custom',
    simple_widget: '0',
    has_loader: '0',
    chat_compatible: '0',
    interactive_view_compatible: '0',
    component: component,
    script: script,
    input_schema: JSON.stringify({
      month: {
        type: 'String',
        description:
          'Month in YYYY-MM format (e.g. "2026-08"). If omitted, defaults to the current month.',
      },
    }),
    component_compile_metadata: componentCompileMetadata,
    description:
      'Displays a monthly NowAssist Unit consumption dashboard with a horizontal bar chart of the top 10 users ranked by NAU. Includes KPI summary tiles (total NAU, active users, conversations) and the cost formula. Data is aggregated server-side from Build Agent conversations and messages. Designed to answer FinOps/governance questions like "How much are we consuming this month?" via an AI Agent.',
    best_for:
      'Visualizing monthly NowAssist Unit consumption with a horizontal bar chart showing top users by NAU. Ideal for FinOps governance when a user asks about Build Agent costs or consumption for a specific month.',
  },
})
