import { Record } from '@servicenow/sdk/core'

const component = `import { html, css, svg } from 'lit';
import { AIUXWidgetElement } from '@servicenow/aiux-components-core';
import { i18n } from '@servicenow/aiux-services';

class ActivityHeatmapCard extends AIUXWidgetElement {
  static properties = {
    appId: { type: String, attribute: 'app-id' },
    _appName: { type: String, state: true },
    _days: { type: Array, state: true },
    _startDate: { type: String, state: true },
    _endDate: { type: String, state: true },
    _totalMessages: { type: Number, state: true },
    _activeDays: { type: Number, state: true },
    _maxCount: { type: Number, state: true },
    _busiestDate: { type: String, state: true },
    _busiestCount: { type: Number, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _lastLoadedId: { type: String, state: true },
    _containerWidth: { type: Number, state: true },
  };

  constructor() {
    super();
    this.appId = '';
    this._appName = '';
    this._days = [];
    this._startDate = '';
    this._endDate = '';
    this._totalMessages = 0;
    this._activeDays = 0;
    this._maxCount = 0;
    this._busiestDate = '';
    this._busiestCount = 0;
    this._loading = true;
    this._error = '';
    this._lastLoadedId = '';
    this._containerWidth = 0;
    this._monthNamesShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    this.MSG = {
      title: i18n.getMessage('Message Activity'),
      totalMessages: i18n.getMessage('Total Messages'),
      activeDays: i18n.getMessage('Active Days'),
      busiest: i18n.getMessage('Busiest Day'),
      mon: i18n.getMessage('Mon'),
      wed: i18n.getMessage('Wed'),
      fri: i18n.getMessage('Fri'),
      less: i18n.getMessage('Less'),
      more: i18n.getMessage('More'),
      loading: i18n.getMessage('Loading...'),
      noApp: i18n.getMessage('No application selected'),
      noData: i18n.getMessage('No message activity in this period'),
      error: i18n.getMessage('Unable to load activity data'),
      messages: i18n.getMessage('messages'),
    };
  }

  updated() {
    if (this.appId && this.appId !== this._lastLoadedId) {
      this._lastLoadedId = this.appId;
      this._fetch();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._measure();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this);
    } else if (typeof window !== 'undefined') {
      this._onWinResize = () => this._measure();
      window.addEventListener('resize', this._onWinResize);
    }
  }

  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._onWinResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    super.disconnectedCallback();
  }

  _measure() {
    var w = 0;
    try { w = Math.round(this.getBoundingClientRect().width); } catch (e) { w = 0; }
    if (w && Math.abs(w - this._containerWidth) >= 1) {
      this._containerWidth = w;
    }
  }

  async _fetch() {
    this._loading = true;
    this._error = '';
    try {
      const res = await this.server.get({ action: 'getHeatmap', appId: this.appId });
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
    if (d.error) { this._error = d.error; this._loading = false; return; }
    if (d.days === undefined && d.appName === undefined) return;
    this._appName = d.appName || '';
    this._days = Array.isArray(d.days) ? d.days : [];
    this._startDate = d.startDate || '';
    this._endDate = d.endDate || '';
    this._totalMessages = Number(d.totalMessages) || 0;
    this._activeDays = Number(d.activeDays) || 0;
    this._maxCount = Number(d.maxCount) || 0;
    this._busiestDate = d.busiestDate || '';
    this._busiestCount = Number(d.busiestCount) || 0;
    this._loading = false;
    this._error = '';
  }

  _fmt(n) {
    try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
  }

  _fmtDate(dateStr) {
    if (!dateStr || dateStr.length < 10) return '—';
    var m = parseInt(dateStr.substring(5, 7), 10);
    var day = parseInt(dateStr.substring(8, 10), 10);
    if (isNaN(m) || isNaN(day)) return dateStr;
    return this._monthNamesShort[m - 1] + ' ' + day;
  }

  _level(count, maxC) {
    if (!count || count <= 0) return 0;
    var ratio = count / (maxC || 1);
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  }

  _renderHeatmap() {
    var days = this._days;
    if (!days || days.length === 0) {
      return html\`<div class="chart-empty">\${this.MSG.noData}</div>\`;
    }
    var cols = Math.ceil(days.length / 7);
    var leftGutter = 30, topGutter = 18;

    // Derive cell size from the measured container width so the SVG viewBox
    // matches real pixels (viewBox width ~= rendered width => no zoom blowup).
    // Falls back to a sensible default before the first measurement.
    var avail = (this._containerWidth || 0) - leftGutter;
    var gapRatio = 0.23; // gap is ~23% of the cell size
    var step, cell, gap;
    if (avail > 0 && cols > 0) {
      step = avail / cols;
      // Clamp cell size to keep it readable but not oversized
      cell = Math.max(6, Math.min(22, step / (1 + gapRatio)));
      gap = Math.max(2, cell * gapRatio);
      step = cell + gap;
    } else {
      cell = 8; gap = 2; step = cell + gap;
    }

    var width = leftGutter + cols * step;
    var height = topGutter + 7 * step;
    var maxC = this._maxCount || 1;
    var self = this;
    var fontDow = Math.max(8, Math.min(12, cell * 0.9));
    var fontMonth = Math.max(9, Math.min(13, cell));

    var rects = days.map(function (d, i) {
      var col = Math.floor(i / 7);
      var row = i % 7;
      var x = leftGutter + col * step;
      var y = topGutter + row * step;
      var lvl = self._level(d.count, maxC);
      var title = self._fmt(d.count) + ' ' + self.MSG.messages + ' \\u2022 ' + d.date;
      var r = Math.max(1, cell * 0.18);
      return svg\`<rect x="\${x}" y="\${y}" width="\${cell}" height="\${cell}" rx="\${r}" class="cell cell--l\${lvl}"><title>\${title}</title></rect>\`;
    });

    var dowLabels = [
      { r: 1, t: this.MSG.mon },
      { r: 3, t: this.MSG.wed },
      { r: 5, t: this.MSG.fri },
    ];
    var dowText = dowLabels.map(function (l) {
      var y = topGutter + l.r * step + cell - 3;
      return svg\`<text x="0" y="\${y}" class="dow-label" style="font-size:\${fontDow}px">\${l.t}</text>\`;
    });

    var monthText = [];
    var prevMonth = -1;
    for (var c = 0; c < cols; c++) {
      var idx = c * 7;
      if (idx >= days.length) break;
      var dateStr = days[idx].date;
      var m = parseInt(dateStr.substring(5, 7), 10);
      if (m !== prevMonth) {
        prevMonth = m;
        var mx = leftGutter + c * step;
        monthText.push(svg\`<text x="\${mx}" y="11" class="month-label" style="font-size:\${fontMonth}px">\${self._monthNamesShort[m - 1]}</text>\`);
      }
    }

    return html\`
      <svg class="heatmap-svg" viewBox="0 0 \${width} \${height}" preserveAspectRatio="xMinYMin meet" width="\${width}" height="\${height}" role="img">
        \${monthText}\${dowText}\${rects}
      </svg>
    \`;
  }

  _renderLegend() {
    return html\`
      <div class="legend">
        <span class="legend__text">\${this.MSG.less}</span>
        <span class="sw sw--l0"></span>
        <span class="sw sw--l1"></span>
        <span class="sw sw--l2"></span>
        <span class="sw sw--l3"></span>
        <span class="sw sw--l4"></span>
        <span class="legend__text">\${this.MSG.more}</span>
      </div>
    \`;
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
        <div class="header">
          <h2 class="header__title">\${this.MSG.title}</h2>
          <span class="header__app">\${this._appName}</span>
        </div>
        <div class="kpis">
          <div class="kpi kpi--accent">
            <span class="kpi__value">\${this._fmt(this._totalMessages)}</span>
            <span class="kpi__label">\${this.MSG.totalMessages}</span>
          </div>
          <div class="kpi">
            <span class="kpi__value">\${this._fmt(this._activeDays)}</span>
            <span class="kpi__label">\${this.MSG.activeDays}</span>
          </div>
          <div class="kpi">
            <span class="kpi__value">\${this._busiestCount > 0 ? this._fmtDate(this._busiestDate) : '—'}</span>
            <span class="kpi__label">\${this.MSG.busiest}\${this._busiestCount > 0 ? ' (' + this._fmt(this._busiestCount) + ')' : ''}</span>
          </div>
        </div>
        <div class="chart-container">
          \${this._renderHeatmap()}
        </div>
        \${this._renderLegend()}
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
    .header__app {
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
    .chart-container { overflow-x: auto; padding-block: calc(var(--now-spacing, 4px) * 1); }
    .heatmap-svg { width: 100%; height: auto; max-width: 100%; display: block; min-height: 120px; }
    .chart-empty { padding: calc(var(--now-spacing, 4px) * 4); text-align: center; color: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .month-label { font-size: 10px; fill: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .dow-label { font-size: 9px; fill: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .cell { stroke: rgba(var(--now-color--neutral-22, 22, 27, 34), 0.06); stroke-width: 1; }
    .cell--l0 { fill: rgb(var(--now-color--neutral-3, 233, 234, 236)); }
    .cell--l1 { fill: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.3); }
    .cell--l2 { fill: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.5); }
    .cell--l3 { fill: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.75); }
    .cell--l4 { fill: rgb(var(--now-color--brand-primary, 0, 128, 163)); }
    .legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
    .legend__text { font-size: var(--now-font-size--xs, 11px); color: rgb(var(--now-color--neutral-11, 108, 115, 122)); }
    .sw { width: 12px; height: 12px; border-radius: 2px; display: inline-block; border: 1px solid rgba(var(--now-color--neutral-22, 22, 27, 34), 0.06); }
    .sw--l0 { background-color: rgb(var(--now-color--neutral-3, 233, 234, 236)); }
    .sw--l1 { background-color: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.3); }
    .sw--l2 { background-color: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.5); }
    .sw--l3 { background-color: rgba(var(--now-color--brand-primary, 0, 128, 163), 0.75); }
    .sw--l4 { background-color: rgb(var(--now-color--brand-primary, 0, 128, 163)); }
  \`;
}
`

const script = `(function (data, options, input) {
  if (!input || !input.action) return;
  switch (input.action) {
    case 'getHeatmap': {
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

      // Build the day grid: ~3 months, aligned to start-of-week (Sunday), UTC-consistent.
      var WEEKS = 14; // ~3.2 months of columns
      var today = new GlideDateTime();
      var isoDow = today.getDayOfWeekUTC(); // 1=Mon .. 7=Sun
      var sundayIdx = isoDow % 7;           // Sun->0, Mon->1, .. Sat->6
      var totalDays = (WEEKS - 1) * 7 + sundayIdx + 1;

      var cursor = new GlideDateTime(today);
      cursor.addDaysUTC(-(totalDays - 1));

      var days = [];
      var dayIndex = {};
      for (var i = 0; i < totalDays; i++) {
        var key = cursor.getValue().substring(0, 10); // YYYY-MM-DD (UTC)
        days.push({ date: key, count: 0 });
        dayIndex[key] = i;
        cursor.addDaysUTC(1);
      }

      var startDate = days[0].date;
      var endDate = days[days.length - 1].date;

      // Collect conversations for this application
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

      // Count messages exchanged per day within the window
      var totalMessages = 0;
      if (convoIds.length > 0) {
        var msg = new GlideRecord('sn_build_agent_message');
        msg.addQuery('conversation', 'IN', convoIds.join(','));
        msg.addQuery('sys_created_on', '>=', startDate + ' 00:00:00');
        msg.addQuery('sys_created_on', '<=', endDate + ' 23:59:59');
        msg.query();
        while (msg.next()) {
          var created = msg.getValue('sys_created_on');
          if (!created) continue;
          var dkey = created.substring(0, 10); // stored UTC
          if (dayIndex.hasOwnProperty(dkey)) {
            days[dayIndex[dkey]].count++;
            totalMessages++;
          }
        }
      }

      // Compute summary stats
      var activeDays = 0;
      var maxCount = 0;
      var busiestDate = '';
      for (var j = 0; j < days.length; j++) {
        var cnt = days[j].count;
        if (cnt > 0) activeDays++;
        if (cnt > maxCount) { maxCount = cnt; busiestDate = days[j].date; }
      }

      data.appId = appId;
      data.appName = appName || ('App (' + appId.substring(0, 8) + '...)');
      data.startDate = startDate;
      data.endDate = endDate;
      data.weeks = WEEKS;
      data.days = days;
      data.totalMessages = totalMessages;
      data.activeDays = activeDays;
      data.maxCount = maxCount;
      data.busiestDate = busiestDate;
      data.busiestCount = maxCount;
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
  elementClassName: 'ActivityHeatmapCard',
  importBoundaries: [0, 157],
  hasServerScript: true,
})

Record({
  $id: Now.ID['activity_heatmap_card_widget'],
  table: 'sys_aix_widget',
  data: {
    name: 'Activity Heatmap Card',
    id: 'activity-heatmap-card',
    type: 'aix_widget',
    purpose: 'component',
    category: 'custom',
    simple_widget: '0',
    has_loader: '0',
    chat_compatible: '1',
    interactive_view_compatible: '0',
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
      'Displays a GitHub contribution-style heatmap of daily message activity for a single application over the last ~3 months. Rows are days of the week, columns are weeks, and each cell is shaded by the number of messages exchanged that day. Includes KPI tiles (total messages, active days, busiest day) and an intensity legend. Data is aggregated server-side from Build Agent conversations and messages. Designed to answer "when was activity highest?" questions for an app via an AI Agent.',
    best_for:
      'Visualizing daily message activity for a Build Agent application as a GitHub-style contribution grid over the last three months. Ideal for spotting activity peaks, streaks, and quiet periods when a user asks about an application usage pattern over time.',
  },
})
