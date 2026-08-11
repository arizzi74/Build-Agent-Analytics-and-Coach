import { AiAgent } from '@servicenow/sdk/core'

export const analyticsNavigatorAgent = AiAgent({
  $id: Now.ID['analytics_navigator_agent'],
  name: 'Build Agent Analytics Navigator',
  description:
    'Navigates Build Agent Analytics data conversationally. Resolves application names to sys_ids, shows application overviews (conversations, user messages, NAU cost, implementation duration), and displays monthly NowAssist Unit consumption charts. Use when a user asks about Build Agent usage, app details, or NAU costs.',
  agentRole:
    'You are an analytics navigator for Build Agent. You help users explore application usage metrics, NowAssist Unit costs, and implementation insights by looking up applications and displaying visual widgets in the conversation.',
  recordType: 'custom',
  securityAcl: {
    $id: Now.ID['analytics_navigator_agent_acl'],
    type: 'Any authenticated user',
  },
  active: true,
  agentDescriptor: 'created_by_build_agent',

  // Dynamic User mode — runs as the logged-in user
  runAsUser: '',
  dataAccess: {
    roleMap: ['admin'],
  },

  processingMessage: 'Analyzing Build Agent data...',
  postProcessingMessage: 'Here are your analytics.',

  versionDetails: [
    {
      name: 'V1',
      number: 1,
      state: 'published',
      instructions: `You help users navigate Build Agent Analytics data. You have four tools:

Step 1: Understand Intent.
- If the user asks about a specific application (e.g. "Tell me about app X", "How is app Y doing?", "Show me Build Agent Analytics"):
  → Go to Step 2 (Lookup Application), then Step 3 (Show App Overview).
- If the user asks about WHEN an application was active, activity over time, peaks, streaks, or a calendar/heatmap of activity (e.g. "When was app X most active?", "Show me the activity heatmap for app Y", "How has usage been distributed over the last months?"):
  → Go to Step 2 (Lookup Application), then Step 3b (Show Activity Heatmap).
- If the user asks about consumption, costs, or NAU (e.g. "How much are we consuming?", "NAU this month", "Who are the top consumers?"):
  → Go to Step 4 (Get NAU Consumption).

Step 2: Lookup Application.
- Extract 1-2 keywords from the user's application name. Do NOT pass full sentences to the lookup tool.
- Use the "Lookup Application" tool to search sys_app by name.
- If multiple results are returned, present them as a numbered list and ask the user which one they meant.
- If no results are found, inform the user: "No application found with that name. Please try a different name." and stop.
- Once a single application is identified, note its sys_id and proceed to Step 3.

Step 3: Show App Overview.
- Use the "Get App Overview" tool with the sys_id from Step 2.
- The tool renders the App Overview Card widget showing: app name, conversation count, user messages, NowAssist Units, and implementation duration.
- After the widget renders, add a brief summary like: "Here's the overview for [App Name]. It has [N] conversations, [N] user messages, costing [N] NAU, with [duration] of implementation time."
- Do NOT restate the raw JSON — the widget is the visual response.

Step 3b: Show Activity Heatmap.
- Use the "Get App Activity Heatmap" tool with the sys_id from Step 2.
- The tool renders the Activity Heatmap Card widget: a GitHub contribution-style grid of daily message activity over the last ~3 months, with KPI tiles (total messages, active days, busiest day).
- After the widget renders, add a brief summary like: "Here's the activity heatmap for [App Name]. Its busiest day was [date] with [N] messages."
- Do NOT restate the raw JSON — the widget is the visual response.

Step 4: Get NAU Consumption.
- If the user specifies a month (e.g. "agosto", "July", "last month", "this month"), resolve it to YYYY-MM format.
- If no month is specified, use the current month.
- Use the "Get NAU Consumption" tool with the resolved month.
- The tool renders the NAU Consumption Chart widget showing a bar chart of top users by NAU.
- After the widget renders, add a brief contextual note like: "Here's the NAU consumption for [Month Year]. The chart shows the top users ranked by NowAssist Unit usage."

RULES:
- Always use the tools — never fabricate data or numbers.
- After any widget renders, confirm in plain language what was shown.
- If the user's request is ambiguous, ask for clarification.
- Present lookup results in plain English — use display names, not sys_ids.
- When showing NAU data, always mention the formula: 1 user message = 25 NAU.`,
    },
  ],

  tools: [
    // ─── Tool 1: CRUD Lookup on sys_app ────────────────────────────────
    // Verified columns (sys_dictionary): sys_id, name, short_description, scope
    {
      active: true,
      name: 'Lookup Application',
      description:
        'Searches for ServiceNow applications by name using substring match. Returns sys_id, name, short_description, and scope. Use this to resolve an application name to its sys_id before calling Get App Overview.',
      executionMode: 'autopilot',
      maxAutoExecutions: 5,
      type: 'crud',
      recordType: 'custom',
      preMessage: 'Searching for the application...',
      postMessage: 'Application lookup complete.',
      outputTransformationStrategy: 'none',
      displayOutput: false,
      inputs: {
        operationName: 'lookup',
        table: 'sys_app',
        inputFields: [
          {
            name: 'app_name',
            description: 'Application name or keyword to search (use 1-2 keywords, not full sentences)',
            mandatory: true,
          },
        ],
        queryCondition: 'nameLIKE{{app_name}}',
        returnFields: [
          { name: 'sys_id' },
          { name: 'name' },
          { name: 'short_description' },
          { name: 'scope' },
        ],
        limit: 10,
      },
    },

    // ─── Tool 2: Script — App Overview Widget ──────────────────────────
    {
      type: 'script',
      recordType: 'custom',
      name: 'Get App Overview',
      description:
        'Displays the App Overview Card widget for a specific application. Shows: app name, conversation count, user messages, NowAssist Unit cost, and implementation duration. Requires the application sys_id (from Lookup Application tool).',
      executionMode: 'autopilot',
      maxAutoExecutions: 5,
      displayOutput: true,
      outputTransformationStrategy: 'none',
      preMessage: 'Loading application overview...',
      postMessage: 'Here is the application overview.',
      widgets: ['03f10bfb8429403088ee247195c252cd'],
      inputs: [
        {
          name: 'appId',
          value: '',
          description: 'The sys_id of the application (from sys_app table)',
          mandatory: true,
        },
      ],
      script: `(function (inputs) {
    var appId = (inputs.appId || '').toString().trim();
    if (!GlideStringUtil.isEligibleSysID(appId)) {
        return { error: 'Invalid application sys_id' };
    }
    return { appId: appId };
})(inputs);`,
    },

    // ─── Tool 3: Script — Activity Heatmap Widget ─────────────────────
    {
      type: 'script',
      recordType: 'custom',
      name: 'Get App Activity Heatmap',
      description:
        'Displays the Activity Heatmap Card widget for a specific application — a GitHub contribution-style grid of daily message activity over the last ~3 months, showing when activity peaked. Requires the application sys_id (from Lookup Application tool).',
      executionMode: 'autopilot',
      maxAutoExecutions: 5,
      displayOutput: true,
      outputTransformationStrategy: 'none',
      preMessage: 'Building the activity heatmap...',
      postMessage: 'Here is the activity heatmap.',
      widgets: ['f2b02b26bb7847a5b2d5ccea1532d529'],
      inputs: [
        {
          name: 'appId',
          value: '',
          description: 'The sys_id of the application (from sys_app table)',
          mandatory: true,
        },
      ],
      script: `(function (inputs) {
    var appId = (inputs.appId || '').toString().trim();
    if (!GlideStringUtil.isEligibleSysID(appId)) {
        return { error: 'Invalid application sys_id' };
    }
    return { appId: appId };
})(inputs);`,
    },

    // ─── Tool 4: Script — NAU Consumption Widget ───────────────────────
    {
      type: 'script',
      recordType: 'custom',
      name: 'Get NAU Consumption',
      description:
        'Displays the NAU Consumption Chart widget showing monthly NowAssist Unit usage with a bar chart of top users. If no month is provided, defaults to the current month.',
      executionMode: 'autopilot',
      maxAutoExecutions: 5,
      displayOutput: true,
      outputTransformationStrategy: 'none',
      preMessage: 'Fetching consumption data...',
      postMessage: 'Here is the NAU consumption chart.',
      widgets: ['19786c6043514107a484960a909f9752'],
      inputs: [
        {
          name: 'month',
          value: '',
          description: 'Month in YYYY-MM format (e.g. "2026-08"). Leave empty for current month.',
          mandatory: false,
        },
      ],
      script: `(function (inputs) {
    var month = (inputs.month || '').toString().trim();
    if (!month || !/^\\d{4}-\\d{2}$/.test(month)) {
        var now = new GlideDateTime();
        month = now.getYearUTC() + '-' + (now.getMonthUTC() < 10 ? '0' : '') + now.getMonthUTC();
    }
    return { month: month };
})(inputs);`,
    },
  ],

  triggerConfig: [],
})
