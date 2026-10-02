# Build Agent Analytics

Dashboard analytics application for visualizing **Build Agent** usage statistics — including conversations, messages, checkpoints, application compositions, token consumption, NAU (Now Assist Units) tracking, per-user profiling, time-series analysis, and agent performance metrics.

Built on ServiceNow using the **Now SDK Fluent DSL** (v4.12.1) with a React-based UI Page (SPA).

---

> ⚠️ **Before installing on a new instance:** check the instance's `glide.appcreator.company.code` system property and make sure it matches the app scope prefix (`x_snc_...`). A mismatch causes `npm run deploy` to fail with `Unable to install application as application was null`. Fixing it requires updating `scope`/`scopeId` in `now.config.json` **and** renaming every `x_snc_build_agranx*` reference across `src/` — the build does not do this automatically. See [Prerequisites](#prerequisites) for details.

---

## Features

| View | Description |
|------|-------------|
| **Applications** | Lists all applications touched by Build Agent, with conversation/checkpoint counts, global KPI cards, and search |
| **App Detail** | Deep dive into a single application — full metadata composition with deep-links, related conversations, usage by author, implementation duration, and partner-hour savings calculator |
| **Conversation Detail** | Full conversation thread with messages (user, assistant, thinking, tool calls), token usage, NAU breakdown, message search, Markdown/Mermaid rendering, and **export to printable HTML/PDF** |
| **Consumption** | Monthly NAU consumption per user, with month navigation, search, and drill-down to individual user profiles |
| **User Profile** | Individual user analytics — donut chart of top 5 apps, per-app breakdown table, daily activity timeline bar chart, and lifetime KPIs |
| **Performance** | Agent-level KPIs — task telemetry, build-fix cycles, and tool error rates |
| **TimeSeries** | Per-application daily token consumption and message volume over time, with dual-axis SVG line chart and server-side caching |

The top navigation exposes three tabs — **Applications**, **Consumption**, **Performance**. Three further views (App Detail, Conversation Detail, User Profile) are reached by drill-down and are deep-linkable via URL parameters. **TimeSeries** has no drill-down entry point today: it is only reachable via the deep-link `?view=timeseries`.

### Additional Capabilities

- **Conversation Export (PDF)** — generates a self-contained HTML transcript (cover page, KPI summary, token usage, NAU breakdown, full message thread with attachments, thinking steps and tool calls) opened in a new tab and print-optimized for A4
- **Run Script Viewer** — dedicated modal for `run_script` tool calls, showing the executed script and its result side by side with copy-to-clipboard (read-only; it never re-executes anything)
- **KPI Cards & Info Modals** — at-a-glance metrics, each card clickable to reveal what the KPI means, how it is calculated, and its detail breakdown
- **DataTable** — reusable sortable/expandable table component with row click navigation
- **Build Error Display** — structured visualization of build errors and fix cycles
- **Markdown & Mermaid Rendering** — rich content display for agent messages and summaries
- **Live Query Telemetry** — every API call is wrapped in a tracker that reports label, status and elapsed time in a loading modal, so slow queries are visible while a view loads
- **Skeleton Loading** — per-view skeleton placeholders (KPI rows, tables, headers) while data resolves
- **Per-user Settings** — complexity weights and partner-hour estimates persisted per user in a custom table
- **Complexity Scoring** — weighted heuristic estimation of application complexity across 24 metadata types, with user-editable weights
- **ROI / Partner-Hour Estimates** — calculates manual development hours saved by Build Agent
- **Token Estimation** — approximate token usage from message content, bucketed into input/output/thinking
- **Implementation Duration** — computes actual interaction time from turn-based message intervals, plus wall-clock, average interaction and average pause metrics
- **App Composition Scanner** — scans 24 metadata types per application with deep-link URLs to each record; missing plugins are skipped without failing the scan
- **SVG Charting** — pure SVG dual-axis line charts, donut pie charts, and bar charts (no charting library)
- **SPA Routing** — URL-parameter-based navigation with browser history support and Magellan integration

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.2, TypeScript |
| Rendering | [marked](https://github.com/markedjs/marked) 12.0.2 (Markdown), [mermaid](https://mermaid.js.org/) 10.9.3 (diagrams) |
| Charts | Pure SVG (no charting library) |
| Platform | ServiceNow (Table API, Aggregate/Stats API, UI Page) |
| SDK | `@servicenow/sdk` 4.12.1 (Fluent DSL), `@servicenow/glide` 27.0.5 |

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

Each table is queried with `sys_scope=<appId>`; tables belonging to uninstalled plugins are skipped silently.

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

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `x_snc_build_agranx_settings` | Per-user application preferences (key/value JSON) | `key`, `value`, `user` |
| `x_snc_build_agranx_timeseries_cache` | Cached daily token/message aggregates per user/app | `period_date`, `token_count`, `message_count`, `user`, `application_id` |

### Platform Records Created

| Table | Purpose |
|-------|---------|
| `sys_ui_page` | The `analytics` UI Page hosting the SPA |
| `sys_app_application` / `sys_app_module` | Application menu and dashboard module |
| `sn_aia_agent` | The Build Agent Analytics Navigator AI Agent |
| `sys_aix_widget` | The three AIUX widgets rendered in chat |

---

## Views in Detail

### Applications

Main entry point. Displays all applications that have Build Agent conversations, with:
- Global KPI cards (conversations, messages, apps, NAU, users) via Aggregate API
- Sortable table with per-app conversation/checkpoint counts
- Search by application name or description

### App Detail

Accessed by clicking an app row. Shows:
- **KPI Row** — user messages, assistant messages, implementation duration, and NowAssist Units (the NAU card's modal also details total/input/output/thinking token consumption)
- **Usage by Author** — per-author aggregate of conversations, messages, tokens and NAU
- **Metadata Composition** — scans 24 metadata types, grouped into 10 categories (Data Model, Server-Side Logic, Client-Side Logic, Security, Automation, User Interface, Integration, Configuration, Service Catalog, Testing), each item linking to its platform record
- **Complexity Score** — weighted score with configurable, per-user-persisted weights per metadata type
- **ROI Calculator** — partner-hour estimates vs. Build Agent implementation time, with savings percentage
- **Conversations Timeline** — related conversations sorted by recency

### Conversation Detail

Full transcript of a single conversation:
- KPI cards: user messages, assistant messages, total messages, NowAssist Units
- **Token Usage Summary** and **NAU Breakdown** panels
- Message search, collapsible JSON tree for tool inputs, generic tool-result modal, image lightbox, file attachments
- Tool calls annotated with category icons, duration and success/failure; `run_script` calls open the dedicated Run Script viewer
- **Export / Print** button producing a printable HTML document (save as PDF from the browser)

### Consumption

Monthly view of Build Agent usage per user:
- Month navigation, with the month list generated dynamically from the oldest message to the current month
- Per-user breakdown: active conversations (those with at least one NAU-billable interaction in the month), user messages, and NAU
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
- Results cached in the `timeseries_cache` table (365-day read window) for fast reloads
- Manual "Refresh Data" to recompute from raw messages

### Performance

Agent task telemetry dashboard:
- Task-level metrics: build-fix cycles, errors, rollbacks, lines of code changed
- Status indicators: success, failure, in-progress

---

## Conversational Analytics — ServiceNow Otto & AIUX Widgets

Beyond the SPA dashboard, this app exposes its analytics **conversationally**. Instead of clicking through views, a user can simply ask an AI Agent — and receive a rich, interactive card rendered directly in the chat.

### ServiceNow Otto

[**ServiceNow Otto**](https://www.servicenow.com/products/now-assist.html) (formerly *Now Assist*) is ServiceNow's generative-AI experience layer. It hosts AI Agents that understand natural-language requests, orchestrate tools, and stream responses into the Now Assist Panel. This app ships an AI Agent — **Build Agent Analytics Navigator** (`sn_aia_agent`) — that resolves application names to sys_ids, routes the user's intent to the right tool, and returns a visual widget as its answer.

The agent exposes four tools: a **Lookup Application** CRUD tool against `sys_app` (name → sys_id, with disambiguation when multiple apps match), plus one script tool per widget below.

### What is an AIUX Widget?

An **AIUX Widget** (`sys_aix_widget`) is a self-contained web component — built on [**Lit**](https://lit.dev/) and extending `AIUXWidgetElement` — that Otto can embed as a "visual response" inside a conversation. Each widget declares a small `input_schema` (its props), optionally loads its own data through a server-side data script, and renders itself with pure SVG and Horizon design tokens. In this app, an agent tool returns a flat payload matching the widget's `input_schema`, and Otto injects it into the widget, which then renders as a card in the chat.

The three widgets below are wired to the Analytics Navigator agent and defined in `src/fluent/widgets/`.

### App Overview Card

![App Overview Card](assets/widget-app-overview-card.png)

A compact overview of a single application. Shows the app name plus KPI tiles for conversation count, user messages, NowAssist Unit cost, and total implementation duration (computed from turn-based working intervals).

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

> ℹ️ The three widgets compute NAU with the simplified **user-messages-only** formula (`user messages × 25`). The SPA uses the fuller five-category formula described below, so widget figures may read lower than the dashboard's.

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
| UI Page Endpoint | `x_snc_build_agranx_analytics.do` |

### User Preferences

Complexity weights and partner-hour estimates are persisted per user in the `x_snc_build_agranx_settings` table as JSON key/value pairs, under the keys `complexity_weights` and `partner_estimates`. Saved values are merged with defaults, so newly added metadata types pick up their default weight automatically.

### NAU Calculation

Now Assist Unit consumption counts **five billable interaction types**, each worth **25 NAU**:

```
totalNau = (userMessages + installs + planning + appCreations + interviews) × 25
```

| Interaction | Detected as |
|-------------|-------------|
| User messages | message `sender` = `user` |
| Installs | tool call `install` or `build_install` |
| Planning | tool call `planning` |
| App creations | tool call `create_new_servicenow_app` |
| Interviews | tool call `interview` |

Counting is done server-side through the Aggregate API using `contentLIKE` substring matching, so the large `content` field is never downloaded for KPI queries. The Consumption view filters these interactions by month.

### Token Estimation

Token counts are estimated heuristically from message content, by sender:

| Sender | Divisor | Bucket |
|--------|---------|--------|
| `user` | `length / 4` (prose) | **input** |
| `assistant` | `length / 4` (prose) | **output** |
| `assistant-thinking` | `length / 4` (prose) | **thinking** |
| `assistant-tool` | `length / 3.5` if the payload looks like JSON, otherwise `length / 3` | **output** |

Totals are the sum of the three buckets. All figures are approximations displayed with a `~` prefix — they are not read back from the model.

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
- **Aggregate API for counting** — KPI counts use `/api/now/stats` with `sysparm_count` / `sysparm_group_by` for server-side counting instead of downloading records
- **No dot-walked grouping** — Stats API group-by ordering is not guaranteed for dot-walked references, so grouping is done on direct foreign keys and rolled up client-side
- **Request timeouts** — every GET is aborted at 55 s, just under the platform transaction limit, surfacing a typed timeout error instead of a hung view
- **Batched message fetches** — very active users' conversations are fetched in batches of 25 to avoid API truncation
- **Server-side caching** — TimeSeries data is computed once and written back to a custom table, reducing repeated heavy queries
- **SPA routing** — URL parameters (`?view=X&id=Y`) enable deep-linking, browser back/forward, and Magellan integration for workspace embedding
- **Modular CSS** — styles split per view for maintainability; shared tokens defined in `base.css`

---

## License

UNLICENSED — internal use only.
