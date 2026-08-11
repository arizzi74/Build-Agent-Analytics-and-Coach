# Build Agent Analytics

Dashboard analytics application for visualizing **Build Agent** usage statistics — including conversations, messages, checkpoints, application compositions, token consumption, NAU (Now Assist Units) tracking, per-user profiling, time-series analysis, and agent performance metrics.

Built on ServiceNow using the **Now SDK Fluent DSL** (v4.7.2) with a React-based UI Page (SPA).

---

> ⚠️ **Before installing on a new instance:** check the instance's `glide.appcreator.company.code` system property and make sure it matches the app scope prefix (`x_snc_...`). A mismatch causes `npm run deploy` to fail with `Unable to install application as application was null`. Fixing it requires updating `scope`/`scopeId` in `now.config.json` **and** renaming every `x_snc_build_agranx*` reference across `src/` — the build does not do this automatically. See [Prerequisites](#prerequisites) for details.

---

## Features

| View | Description |
|------|-------------|
| **Applications** | Lists all applications touched by Build Agent, with conversation/checkpoint counts, metadata composition scanning (24 component types), complexity scoring, and ROI estimates |
| **App Detail** | Deep dive into a single application — full metadata composition with deep-links, related conversations, implementation duration, and partner-hour savings calculator |
| **Conversation Detail** | Full conversation thread with messages (user, assistant, thinking, tool calls), checkpoints, change summaries, and Markdown/Mermaid rendering |
| **Consumption** | Monthly NAU consumption per user (25 NAU per user message), with month navigation, search, and drill-down to individual user profiles |
| **User Profile** | Individual user analytics — donut chart of top 5 apps, per-app breakdown table, daily activity timeline bar chart, and lifetime KPIs |
| **Performance** | Agent-level KPIs — task telemetry, build-fix cycles, error rates, working duration breakdowns |
| **TimeSeries** | Per-application daily token consumption and message volume over time, with dual-axis SVG line chart and client-side caching |

### Additional Capabilities

- **KPI Cards** — at-a-glance metrics with refresh actions and loading states
- **DataTable** — reusable sortable/expandable table component with row click navigation
- **Build Error Display** — structured visualization of build errors and fix cycles
- **Markdown & Mermaid Rendering** — rich content display for agent messages and summaries
- **Per-user Settings** — persistent user preferences stored in a custom table
- **Complexity Scoring** — weighted heuristic estimation of application complexity across 24 metadata types
- **ROI / Partner-Hour Estimates** — calculates manual development hours saved by Build Agent
- **Token Estimation** — approximate token usage from conversation content, bucketed into input/output/thinking
- **Implementation Duration** — computes actual interaction time from user message intervals
- **App Composition Scanner** — scans 24 metadata types per application with deep-link URLs to each record
- **SVG Charting** — pure SVG dual-axis line charts, donut pie charts, and bar charts (no charting library)
- **SPA Routing** — URL-parameter-based navigation with browser history support and Magellan integration

---

## Project Structure

```
├── now.config.json                 # ServiceNow app configuration
├── package.json                    # Dependencies and scripts
├── assets/                         # Screenshots of the AIUX widgets (for this README)
├── docs/                           # Design notes (conversational navigation, example agent)
└── src/
    ├── client/                     # React SPA (UI Page)
    │   ├── app.tsx                 # Root component with SPA router
    │   ├── index.html              # HTML entry point
    │   ├── main.tsx                # React DOM mount
    │   ├── tsconfig.json           # Client-side TypeScript config
    │   ├── components/             # UI components
    │   │   ├── AgentPerformance.tsx   # Performance view with task telemetry
    │   │   ├── AppDetail.tsx          # App detail with composition scan & ROI
    │   │   ├── Applications.tsx       # App list with KPIs and search
    │   │   ├── BuildErrorDisplay.tsx  # Build error visualization
    │   │   ├── ConversationDetail.tsx # Message thread with Markdown rendering
    │   │   ├── DataTable.tsx          # Reusable sortable/expandable table
    │   │   ├── KpiCard.tsx            # KPI card with refresh and tooltip
    │   │   ├── KpiInfoModal.tsx       # Modal explaining KPI definitions
    │   │   ├── LoadingModal.tsx       # Blocking loading modal
    │   │   ├── MarkdownRenderer.tsx   # Markdown + Mermaid renderer
    │   │   ├── NauBreakdown.tsx       # NAU consumption breakdown display
    │   │   ├── Navigation.tsx         # Top nav with tab routing
    │   │   ├── Skeleton.tsx           # Skeleton loading placeholders
    │   │   ├── TimeSeriesView.tsx     # SVG dual-axis time-series chart
    │   │   ├── UserConsumption.tsx    # Monthly NAU consumption table
    │   │   └── UserProfile.tsx        # User profile with pie/timeline charts
    │   ├── services/
    │   │   ├── api.ts              # ServiceNow Table & Aggregate API client
    │   │   └── queryTracker.ts     # Query performance/telemetry tracking
    │   ├── styles/                 # Modular CSS files
    │   │   ├── base.css            # Root variables, resets, layout
    │   │   ├── shared.css          # Shared component styles
    │   │   ├── applications.css    # Applications view styles
    │   │   ├── app-detail.css      # App detail view styles
    │   │   ├── conversation.css    # Conversation detail styles
    │   │   ├── performance.css     # Performance view styles
    │   │   ├── timeseries.css      # TimeSeries chart styles
    │   │   ├── consumption.css     # Consumption view styles
    │   │   ├── user-profile.css    # User profile styles
    │   │   ├── json-tree.css       # JSON/tool output styles
    │   │   ├── loading.css         # Loading modal / skeleton styles
    │   │   └── responsive.css      # Responsive breakpoints
    │   └── utils/
    │       ├── complexity.ts       # Complexity scoring, ROI, partner-hour estimates
    │       ├── fields.ts           # Field extraction, message parsing, sender types
    │       ├── tokenEstimation.ts  # Token usage estimation (input/output/thinking)
    │       └── workingDuration.ts  # Implementation duration from message intervals
    ├── fluent/                     # ServiceNow Fluent metadata
    │   ├── agents/
    │   │   └── analytics-navigator.now.ts   # AI Agent (Otto) — conversational analytics
    │   ├── navigation/
    │   │   └── menu.now.ts         # Application menu + dashboard module
    │   ├── tables/
    │   │   ├── settings.now.ts     # User settings table
    │   │   └── timeseries_cache.now.ts  # TimeSeries cache table
    │   ├── ui-pages/
    │   │   └── analytics.now.ts    # UI Page definition
    │   └── widgets/                # AIUX widgets (sys_aix_widget) rendered by Otto
    │       ├── app-overview-card.now.ts     # App Overview Card widget
    │       ├── nau-consumption-chart.now.ts # NAU Consumption Chart widget
    │       └── activity-heatmap-card.now.ts # Activity Heatmap Card widget
    └── server/
        └── tsconfig.json           # Server-side TypeScript config
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.2, TypeScript |
| Rendering | [marked](https://github.com/markedjs/marked) (Markdown), [mermaid](https://mermaid.js.org/) (diagrams) |
| Charts | Pure SVG (no charting library) |
| Platform | ServiceNow (Table API, Aggregate/Stats API, UI Page) |
| SDK | `@servicenow/sdk` 4.7.2 (Fluent DSL) |

---

## ServiceNow Tables Used

### Platform Tables (read-only)

| Table | Purpose |
|-------|---------|
| `sn_build_agent_conversation` | Build Agent conversations |
| `sn_build_agent_message` | Individual messages within conversations |
| `sn_build_agent_checkpoint` | Install checkpoints per conversation |
| `sn_build_agent_task_telemetry` | Task-level performance telemetry |
| `sn_build_agent_event_telemetry` | Event-level telemetry (steps within a task) |
| `sys_app` | Application name/description resolution |
| `sys_user` | User profile name resolution |

### Application Composition (scanned per app scope)

| Table | Metadata Type |
|-------|---------------|
| `sys_db_object` | Tables |
| `sys_script` | Business Rules |
| `sys_script_include` | Script Includes |
| `sysauto_script` | Scheduled Jobs |
| `sys_script_fix` | Fix Scripts |
| `sys_script_client` | Client Scripts |
| `sys_ui_action` | UI Actions |
| `sys_ui_policy` | UI Policies |
| `sys_security_acl` | ACLs |
| `sys_user_role` | Roles |
| `sys_hub_flow` | Flows |
| `sysevent_email_action` | Notifications |
| `sysevent_register` | Events |
| `sys_data_policy` | Data Policies |
| `sys_ui_page` | UI Pages |
| `sys_ux_app_config` | Workspaces |
| `sp_portal` | Service Portals |
| `sp_widget` | Widgets |
| `sys_app_application` | App Menus |
| `sys_app_module` | Modules |
| `sys_ws_operation` | REST Operations |
| `sys_properties` | Properties |
| `sc_cat_item` | Catalog Items |
| `sys_atf_test` | ATF Tests |

### Custom Tables (owned by this app)

| Table | Purpose |
|-------|---------|
| `x_snc_build_agranx_settings` | Per-user application preferences (key/value JSON) |
| `x_snc_build_agranx_timeseries_cache` | Cached daily token/message aggregates per user/app |

---

## Views in Detail

### Applications

Main entry point. Displays all applications that have Build Agent conversations, with:
- Global KPI cards (conversations, messages, apps, checkpoints) via Aggregate API
- Sortable table with per-app conversation/checkpoint counts
- Search by application name or description

### App Detail

Accessed by clicking an app row. Shows:
- **Metadata Composition** — scans 24 metadata types, grouped into categories (Data Model, Server Logic, Client Logic, Security, Automation, UI, Integration, Configuration, Catalog, Testing), each item linking to its platform record
- **Complexity Score** — weighted score with configurable weights per metadata type
- **ROI Calculator** — partner-hour estimates vs. Build Agent implementation time, with savings percentage
- **Implementation Duration** — computed from user message intervals across all conversations
- **Conversations List** — related conversations sorted by recency

### Consumption

Monthly view of Build Agent usage per user:
- Month navigation (forward/backward arrows)
- Per-user breakdown: conversations, user messages, NAU (25 units per user message)
- Search by user name
- Click-through to User Profile

### User Profile

Deep analytics for a single user:
- KPI cards: messages, conversations, NAU, unique apps
- **Donut Pie Chart** — top 5 applications by usage percentage
- **Activity Timeline** — daily message bar chart over the user's entire history
- **Per-App Breakdown Table** — sorted by most recent activity, with percentage bars

### TimeSeries

Per-application token consumption over time:
- Application selector dropdown
- KPI cards: total tokens, total messages, avg tokens/day, peak day
- **Dual-axis SVG line chart**: tokens (left axis, solid line) + messages (right axis, dashed line)
- Client-side caching in `timeseries_cache` table for fast reloads
- Manual "Refresh Data" to recompute from raw messages

### Performance

Agent task telemetry dashboard:
- Task-level metrics: build-fix cycles, errors, rollbacks, lines of code changed
- Event-level drill-down: steps within each task with individual timing
- Status indicators: success, failure, in-progress

---

## Conversational Analytics — ServiceNow Otto & AIUX Widgets

Beyond the SPA dashboard, this app exposes its analytics **conversationally**. Instead of clicking through views, a user can simply ask an AI Agent — and receive a rich, interactive card rendered directly in the chat.

### ServiceNow Otto

[**ServiceNow Otto**](https://www.servicenow.com/products/now-assist.html) (formerly *Now Assist*) is ServiceNow's generative-AI experience layer. It hosts AI Agents that understand natural-language requests, orchestrate tools, and stream responses into the Now Assist Panel. This app ships an AI Agent — **Build Agent Analytics Navigator** (`sn_aia_agent`) — that resolves application names to sys_ids, routes the user's intent to the right tool, and returns a visual widget as its answer.

### What is an AIUX Widget?

An **AIUX Widget** (`sys_aix_widget`) is a self-contained web component — built on [**Lit**](https://lit.dev/) and extending `AIUXWidgetElement` — that Otto can embed as a "visual response" inside a conversation. Each widget declares a small `input_schema` (its props), optionally loads its own data through a server-side data script, and renders itself with pure SVG and Horizon design tokens. In this app, an agent tool returns a flat payload matching the widget's `input_schema`, and Otto injects it into the widget, which then renders as a card in the chat.

The three widgets below are wired to the Analytics Navigator agent and defined in `src/fluent/widgets/`.

### App Overview Card

![App Overview Card](assets/widget-app-overview-card.png)

A compact overview of a single application. Shows the app name plus KPI tiles for conversation count, user messages, NowAssist Unit cost (25 NAU per user message), and total implementation duration (computed from turn-based working intervals).

- **Input:** `appId` — the `sys_id` of the application (`sys_app`)
- **Answers:** *"Tell me about app X"*, *"How is app Y doing?"*
- **Source:** `src/fluent/widgets/app-overview-card.now.ts`

### NAU Consumption Chart

![NAU Consumption Chart](assets/widget-nau-consumption-chart.png)

A monthly NowAssist Unit consumption dashboard with a horizontal bar chart of the top users ranked by NAU, KPI tiles (total NAU, active users, conversations), and the cost formula. Defaults to the current month when none is specified.

- **Input:** `month` — in `YYYY-MM` format (optional)
- **Answers:** *"How much are we consuming this month?"*, *"Who are the top consumers?"*
- **Source:** `src/fluent/widgets/nau-consumption-chart.now.ts`

### Activity Heatmap Card

![Activity Heatmap Card](assets/widget-activity-heatmap-card.png)

A GitHub contribution-style heatmap of daily message activity for a single application over the last ~3 months. Rows are days of the week, columns are weeks, and each cell is shaded by the number of messages exchanged that day. Includes KPI tiles (total messages, active days, busiest day) and an intensity legend, and scales responsively to the widget's width.

- **Input:** `appId` — the `sys_id` of the application (`sys_app`)
- **Answers:** *"When was app X most active?"*, *"Show me the activity heatmap for app Y"*
- **Source:** `src/fluent/widgets/activity-heatmap-card.now.ts`

---

## Getting Started

### Prerequisites

- ServiceNow instance with **Build Agent** enabled
- Now CLI / Now SDK installed locally
- **Verify the instance's company code before first install on a new instance.** The app scope (`x_snc_...`) must start with the prefix registered in the instance's `glide.appcreator.company.code` system property, or `npm run deploy` will fail with `Unable to install application as application was null`. Check it at:
  ```
  https://<instance>.service-now.com/sys_properties_list.do?sysparm_query=name=glide.appcreator.company.code
  ```
  If the property's value doesn't match the `x_<code>_...` prefix in `now.config.json`, update `scope` (and regenerate `scopeId`) in `now.config.json` to match, and rename all `x_snc_build_agranx*` references across `src/` accordingly before building.

### Build & Deploy

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Deploy to your ServiceNow instance
npm run deploy
```

### Access the Dashboard

Once deployed, navigate to the **Build Agent Analytics** module in the application navigator, or open:

```
https://<instance>.service-now.com/x_snc_build_agranx_analytics.do
```

---

## Configuration

| Setting | Value |
|---------|-------|
| Application Scope | `x_snc_build_agranx` |
| Scope ID | `748e8d343b2987149a1600b693e45a0c` |
| UI Page Endpoint | `x_snc_build_agranx_analytics.do` |

### User Preferences

User preferences (column visibility, sort order, complexity weights, partner-hour estimates) are automatically persisted per user in the `x_snc_build_agranx_settings` table as JSON key/value pairs.

### NAU Calculation

Now Assist Unit consumption is calculated as:
- **1 user message = 25 NAU**
- Only messages with `sender === "user"` are counted
- Filtered by month for the Consumption view

### Token Estimation

Token counts are estimated heuristically from message content:
- Prose (user/assistant text): `length / 4`
- Code (tool output): `length / 3`
- JSON (structured data): `length / 3.5`
- Bucketed into: **input** (user), **output** (assistant + tool), **thinking** (reasoning)

---

## Development

```bash
# Type-check server-side code
npx tsc --project src/server/tsconfig.json --noEmit

# Type-check client-side code
npx tsc --project src/client/tsconfig.json --noEmit
```

Fluent metadata files (`.now.ts`) live under `src/fluent/` and are compiled into platform artifacts during the build step.

### Key Architecture Decisions

- **No charting library** — all charts are pure SVG rendered in React for zero additional bundle size
- **Aggregate API** — KPI counts use `/api/now/stats` for O(1) server-side counting instead of downloading all records
- **Client-side caching** — TimeSeries data is computed once and cached in a custom table, reducing repeated heavy queries
- **SPA routing** — URL parameters (`?view=X&id=Y`) enable deep-linking, browser back/forward, and Magellan integration for workspace embedding
- **Modular CSS** — styles split per view for maintainability; shared tokens defined in `base.css`

---

## License

UNLICENSED — internal use only.
