# JARVIS AI — Master Technical Specification & Execution Blueprint

> **Project Codename:** JARVIS  
> **Product Type:** Personal & Business AI Operating System  
> **Primary Interface:** Desktop Voice + Text Assistant  
> **Primary Goal:** Convert natural-language requests into understanding, planning, execution, monitoring, and verified outcomes.

---

## 1. Mission

JARVIS is not a chatbot. It is the user's intelligent personal and business operating system.

### Core mission

**Understand → Remember → Think → Ask → Plan → Act → Verify → Monitor → Learn**

JARVIS must be able to:

- Understand the user's actual goal, not only the literal wording.
- Retrieve relevant context from memory, files, projects, apps, and connected systems.
- Ask follow-up questions only when information cannot be discovered safely.
- Plan multi-step work.
- Use authorized tools.
- Execute real tasks.
- Verify outcomes.
- Recover from errors.
- Remember useful long-term context.
- Monitor unfinished work.
- Proactively surface important issues.

---

# 2. Product Vision

The user should feel they have:

- AI Chief of Staff
- Executive Assistant
- Business Analyst
- Researcher
- Technical Assistant
- Computer Operator
- Workflow Automator

The user should interact with **one assistant only: JARVIS**.

Internally, JARVIS may delegate to specialist agents, tools, workers, and automations.

---

# 3. Core Design Principle

Do **not** build this:

```text
User
 ↓
LLM
 ↓
Answer
```

That is only a chatbot.

Build this instead:

```text
                        USER
                         │
            ┌────────────┴────────────┐
            │                         │
          Voice                      Text
            │                         │
            └────────────┬────────────┘
                         ▼
                JARVIS ORCHESTRATOR
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
      MEMORY          REASONING          EVENTS
        │                │                │
        │              PLANNER            │
        │                │                │
        └───────────┬────┴────┬───────────┘
                    │         │
                    ▼         ▼
                  AGENTS     TOOLS
                    │         │
             ┌──────┴──────┐  │
             │             │  │
             ▼             ▼  ▼
          ANALYSIS      EXECUTION
                             │
        ┌────────────────────┼─────────────────────┐
        │          │         │        │            │
        ▼          ▼         ▼        ▼            ▼
     Browser      Files     APIs    Computer     Database
        │
        ▼
   Business Systems
```

---

# 4. Recommended Technology Stack

## Desktop

- Tauri
- React
- TypeScript
- Vite
- TailwindCSS

## Backend / AI Gateway

- Node.js
- TypeScript
- Fastify or NestJS

## AI

- LLM Provider Adapter
- Agent Runtime
- Tool Calling
- Realtime Voice
- Structured Outputs

## Database

- PostgreSQL

## Semantic Memory

- pgvector

## Cache / Real-Time State

- Redis

## Background Jobs

- BullMQ

## Browser Automation

- Playwright

## Real-Time Transport

- WebSocket

## Files

- Local filesystem abstraction
- Object storage abstraction

## Observability

- OpenTelemetry
- Structured logs

## Authentication

- Local account initially
- OAuth / SSO later

## Deployment

- Desktop local client
- Cloud control plane
- Optional local agent daemon

---

# 5. Recommended Monorepo Structure

```text
jarvis/
│
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── screens/
│   │   │   ├── orb/
│   │   │   ├── voice/
│   │   │   ├── chat/
│   │   │   ├── command-center/
│   │   │   ├── tasks/
│   │   │   ├── memory/
│   │   │   └── settings/
│   │   └── src-tauri/
│   │
│   ├── api/
│   │   └── src/
│   │       ├── agents/
│   │       ├── tools/
│   │       ├── memory/
│   │       ├── planner/
│   │       ├── executor/
│   │       ├── permissions/
│   │       ├── events/
│   │       ├── workflows/
│   │       ├── monitoring/
│   │       ├── voice/
│   │       └── auth/
│   │
│   └── worker/
│       └── src/
│           ├── jobs/
│           ├── monitors/
│           ├── scheduler/
│           └── execution/
│
├── packages/
│   ├── agent-core/
│   ├── tool-sdk/
│   ├── memory-sdk/
│   ├── event-sdk/
│   ├── permissions/
│   ├── schemas/
│   ├── prompts/
│   ├── ui/
│   ├── logger/
│   └── config/
│
├── prisma/
│   └── schema.prisma
│
├── docs/
│   ├── architecture/
│   ├── prompts/
│   ├── tools/
│   ├── security/
│   └── product/
│
├── tests/
│   ├── agents/
│   ├── tools/
│   ├── workflows/
│   └── e2e/
│
└── infrastructure/
```

---

# 6. JARVIS Core Orchestrator

The orchestrator is the main brain and coordinator.

Every user request passes through:

```text
Request
 ↓
Intent Detection
 ↓
Context Retrieval
 ↓
Risk Classification
 ↓
Planning
 ↓
Agent Selection
 ↓
Tool Selection
 ↓
Execution
 ↓
Observation
 ↓
Verification
 ↓
Memory Update
 ↓
Response
```

Suggested context object:

```ts
interface JarvisContext {
  user: unknown;
  conversation: unknown;
  currentGoal: unknown;
  currentPlan: unknown;
  activeTasks: unknown[];
  availableTools: unknown[];
  permissions: unknown;
  relevantMemories: unknown[];
  recentEvents: unknown[];
  projectContext: unknown;
}
```

---

# 7. Intent Classification

Every message should be classified into one or more intents.

```text
QUESTION
RESEARCH
ANALYZE
CREATE
EDIT
EXECUTE
MONITOR
REMIND
SEARCH
COMMUNICATE
DECIDE
PLAN
DEBUG
AUTOMATE
CONTROL_COMPUTER
```

Example:

```json
{
  "intent": "COMMUNICATE",
  "action": "SEND",
  "target": "Naira",
  "object": "latest_report",
  "risk": "external_write",
  "approvalRequired": true
}
```

---

# 8. Task Complexity Router

Not every request needs a heavy autonomous loop.

```text
LEVEL 0
Simple answer

LEVEL 1
Tool-assisted answer

LEVEL 2
Multi-step task

LEVEL 3
Autonomous workflow
```

Examples:

- `15% of 20,000` → Level 0
- `Find the latest email from supplier X` → Level 1
- `Analyze this month's sales` → Level 2
- `Monitor unanswered leads and escalate automatically` → Level 3

---

# 9. Planner Engine

The planner converts a goal into executable steps.

Example:

```json
{
  "goal": "Find why bookings declined this week",
  "steps": [
    {"id": 1, "action": "fetch_sales", "status": "pending"},
    {"id": 2, "action": "fetch_leads", "status": "pending"},
    {"id": 3, "action": "compare_conversion", "status": "pending"},
    {"id": 4, "action": "analyze_response_time", "status": "pending"},
    {"id": 5, "action": "detect_anomalies", "status": "pending"},
    {"id": 6, "action": "generate_summary", "status": "pending"}
  ]
}
```

Each step should contain:

- Input
- Tool
- Expected result
- Success condition
- Retry strategy
- Fallback
- Status

---

# 10. Execution Engine

Execution states:

```text
QUEUED
RUNNING
WAITING_TOOL
WAITING_USER
WAITING_EXTERNAL
RETRYING
VERIFYING
COMPLETED
FAILED
CANCELLED
```

Example:

```text
Task:
Analyze sales

Step 1:
Pull CRM data
✓ completed

Step 2:
Pull employee activity
✓ completed

Step 3:
Calculate conversion
✓ completed

Step 4:
Analyze anomalies
running...

Step 5:
Create executive report
pending
```

---

# 11. Verification Engine

Core rule:

# Execution ≠ Success

A task is only complete after verification.

Example for email:

```text
sendEmail()
 ↓
Inspect returned status
 ↓
Confirm provider accepted message
 ↓
Store message ID
 ↓
Mark complete
```

Example for files:

```text
Create report
 ↓
File exists?
 ↓
File > 0 bytes?
 ↓
Can file be opened?
 ↓
Expected sections exist?
 ↓
Complete
```

---

# 12. Error Recovery Engine

```text
ERROR
 ↓
Classify
 ↓
Recoverable?
 ├── YES → retry
 └── NO
      ↓
Alternative route?
 ├── YES → execute
 └── NO → ask/escalate
```

Error categories:

```text
Authentication
Permission
Timeout
Rate limit
Network
Invalid input
Tool unavailable
Website changed
Data mismatch
Missing dependency
Unknown
```

Recovery sequence example:

```text
Check credentials
Check endpoint
Check permission
Retry
Try alternative method
Verify
Escalate only if blocked
```

---

# 13. Agent Architecture

Start with a small set of useful agents.

```text
                 JARVIS
                    │
 ┌──────────────────┼──────────────────┐
 │        │         │        │         │
 ▼        ▼         ▼        ▼         ▼
Research Sales  Operations Finance Technical
 │
 ▼
Business Analyst
 │
 ▼
Computer Operator
```

---

# 14. JARVIS Manager Agent

Responsibilities:

- Understand the user
- Coordinate work
- Retrieve context
- Build plans
- Delegate
- Check permissions
- Own the conversation
- Produce the final result
- Maintain goal continuity

---

# 15. Research Agent

Responsibilities:

- Internet research
- Source comparison
- Market intelligence
- Travel rules
- Product research
- Competitor research
- Documentation lookup

---

# 16. Business Analyst Agent

Responsibilities:

- KPIs
- Trends
- Performance analysis
- Anomaly detection
- Comparisons
- Executive reporting
- Decision support

---

# 17. Sales Agent

Responsibilities:

- Leads
- Sales activity
- Offers
- Follow-up
- Conversion
- Bookings
- Targets
- Coaching insights

---

# 18. Operations Agent

Responsibilities:

- Bookings
- Confirmations
- Suppliers
- Cases
- SLAs
- Customer service
- Operational delays

---

# 19. Finance Agent

Responsibilities:

- Sales
- Costs
- Profit
- Margin
- Payments
- Expenses
- Refunds
- Reconciliation

Default: read-only until explicitly authorized.

---

# 20. Technical Agent

Responsibilities:

- Code
- Servers
- Git
- Logs
- APIs
- Database
- Tests
- Deployments
- Architecture
- Security findings

---

# 21. Computer Operator

Responsibilities:

- Mouse
- Keyboard
- Browser
- Desktop applications
- Filesystem actions
- Terminal commands

Always constrained by the permission engine.

---

# 22. Tool Registry

Example tool groups:

```text
FILES

read_file
search_files
create_file
move_file
rename_file

WEB

search_web
open_page
extract_page

BROWSER

navigate
click
type
download
upload

EMAIL

search_email
read_email
draft_email
send_email

CALENDAR

read_calendar
create_event
move_event

TASKS

create_task
update_task
assign_task
complete_task

DATABASE

query_database
insert_record
update_record

COMPUTER

open_app
read_screen
click_screen
type_text
run_command

REPORTING

create_report
create_spreadsheet
create_pdf

CRM

search_contact
get_conversation
update_lead
assign_lead

COMMUNICATION

send_whatsapp
send_slack
send_notification
```

---

# 23. Tool Definition Standard

```ts
interface JarvisTool {
  id: string;
  name: string;
  description: string;

  riskLevel:
    | "read"
    | "safe_write"
    | "external_write"
    | "critical";

  requiresConfirmation: boolean;
  timeout: number;
  inputSchema: object;

  execute(input: unknown): Promise<unknown>;

  verify?(
    input: unknown,
    result: unknown
  ): Promise<unknown>;
}
```

---

# 24. Permission System

## Level 1 — READ

Examples:

- Read files
- Read database
- Read CRM
- Read emails

## Level 2 — SAFE ACTION

Examples:

- Create draft
- Create internal task
- Generate report

## Level 3 — APPROVAL REQUIRED

Examples:

- Send email
- Send WhatsApp
- Modify CRM
- Publish content

## Level 4 — CRITICAL

Examples:

- Payments
- Financial changes
- Database deletion
- Production deployment
- Mass messaging
- Destructive filesystem actions

---

# 25. Approval UI

```text
┌────────────────────────────────────┐
│ JARVIS REQUESTS APPROVAL           │
│                                    │
│ Action: Send WhatsApp              │
│ To: Naira Ashraf                   │
│                                    │
│ "التقرير النهائي جاهز..."          │
│                                    │
│ [Approve] [Edit] [Cancel]          │
└────────────────────────────────────┘
```

---

# 26. Memory Architecture

Memory types:

```text
User Memory
Preference Memory
People Memory
Business Memory
Project Memory
Decision Memory
Episodic Memory
Working Memory
```

---

# 27. Memory Object

```json
{
  "id": "mem_...",
  "type": "business_rule",
  "subject": "minimum_margin",
  "content": "...",
  "source": "conversation",
  "confidence": 0.97,
  "importance": 0.9,
  "createdAt": "...",
  "updatedAt": "...",
  "lastVerifiedAt": "...",
  "expiresAt": null
}
```

---

# 28. Memory Retrieval

When the user says:

> "اعملها زي التقرير اللي عملناه قبل كده."

JARVIS should retrieve using:

```text
Semantic search
+
Entity search
+
Recent conversations
+
Project context
```

---

# 29. Memory Write Rules

Save only information likely to improve future assistance.

Good memory candidates:

```text
Long-term preference
Important decision
Business rule
Important person
Project fact
Repeated workflow
Persistent goal
```

Do not save:

```text
Temporary text
Random question
Unverified assumption
Irrelevant detail
```

---

# 30. Knowledge Graph

Entity types:

```text
PERSON
COMPANY
DEPARTMENT
PROJECT
CUSTOMER
SUPPLIER
SYSTEM
DOCUMENT
TASK
DECISION
PRODUCT
```

Relationships:

```text
WORKS_AT
MANAGES
BELONGS_TO
USES
OWNS
DEPENDS_ON
RELATED_TO
ASSIGNED_TO
CREATED_BY
```

---

# 31. Database Schema

Core tables:

```text
users

user_preferences

assistants

conversations

conversation_threads

messages

memories

memory_embeddings

entities

entity_relationships

projects

project_members

tasks

task_steps

task_dependencies

workflows

workflow_runs

events

event_handlers

monitors

notifications

agents

agent_runs

agent_messages

tools

tool_permissions

tool_executions

approvals

documents

document_chunks

knowledge_sources

integrations

integration_credentials

voice_sessions

audit_logs

system_logs

errors
```

---

# 32. Core Task Table

```text
tasks

id
title
description
goal
status
priority
created_by
assigned_to
project_id
due_at
started_at
completed_at
success_criteria
requires_approval
created_at
updated_at
```

---

# 33. Task Steps

```text
task_steps

id
task_id
order
name
description
status
tool_id
input
output
verification_result
error
retry_count
started_at
completed_at
```

---

# 34. Event System

Example events:

```text
EMAIL_RECEIVED
NEW_LEAD
LEAD_UNANSWERED
BOOKING_CREATED
BOOKING_DELAYED
PAYMENT_RECEIVED
TASK_OVERDUE
SERVER_DOWN
CAMPAIGN_ANOMALY
CALENDAR_EVENT_SOON
```

---

# 35. Event Processing Example

```text
NEW_LEAD
  ↓
Analyze source
  ↓
Identify priority
  ↓
Check assignment
  ↓
Create follow-up
  ↓
Monitor first response
```

---

# 36. Monitoring System

Example monitor:

```json
{
  "type": "condition",
  "target": "booking_123",
  "condition": "status == confirmed",
  "frequency": "30m",
  "notifyWhen": "changed"
}
```

Monitor types:

```text
TIME MONITOR
CONDITION MONITOR
CHANGE MONITOR
THRESHOLD MONITOR
ANOMALY MONITOR
```

---

# 37. Background Worker

For persistent tasks even when desktop app is closed:

```text
Scheduler
 ↓
Redis Queue
 ↓
Worker
 ↓
Execute check
 ↓
Store result
 ↓
Notify client
```

For 24/7 monitoring, run the worker in the cloud.

---

# 38. Voice Architecture

```text
Microphone
 ↓
VAD
 ↓
Realtime audio stream
 ↓
Speech understanding
 ↓
JARVIS session
 ↓
Tool execution if needed
 ↓
Voice generation
 ↓
Speaker
```

Requirements:

- Natural turn-taking
- Low latency
- Arabic + English
- User interruption
- Streaming
- Context continuity

---

# 39. Voice UX

Example:

**User:** جارفيس.  
**JARVIS:** معاك.  
**User:** شوف المبيعات النهارده.  
**JARVIS:** حاضر، هراجع الأرقام والنشاط والمشاكل المهمة.  
**JARVIS:** عندي ملاحظتين تستحقوا اهتمامك...

---

# 40. Interruptions

If the user says:

> استنى

JARVIS should stop speaking immediately and listen.

---

# 41. Wake Word

Future version:

```text
"Jarvis"
"يا جارفيس"
```

Prefer local wake-word detection for privacy.

---

# 42. Orb State Machine

The current orb must become a live state indicator.

```text
IDLE
WAKE
LISTENING
UNDERSTANDING
THINKING
PLANNING
SEARCHING
EXECUTING
WAITING
SPEAKING
SUCCESS
ERROR
```

---

# 43. Orb Behavior

```text
IDLE
Slow breathing

LISTENING
Audio responsive

THINKING
Rotational energy

EXECUTING
Rapid controlled pulse

SPEAKING
Wave synchronized to speech

WAITING_APPROVAL
Subtle alert effect

ERROR
Short warning animation
```

---

# 44. Live Activity Text

Under the orb:

```text
Listening...
Understanding...
Reviewing sales...
Searching 72 conversations...
Comparing last 30 days...
Preparing report...
Waiting for your approval...
```

Do not expose hidden chain-of-thought. Show only execution status.

---

# 45. Main UI

```text
┌───────────────────────────────────────────────────┐
│ JARVIS                          ● Connected       │
├─────────┬─────────────────────────────────────────┤
│ Home    │                                         │
│ Chat    │                   ORB                   │
│ Tasks   │                                         │
│ Work    │            "I'm listening."             │
│ Memory  │                                         │
│ Tools   │                                         │
│         │                                         │
│         │ ─────────────────────────────────────── │
│         │ Active                                  │
│         │                                         │
│         │ Sales audit                  67%         │
│         │ VPS monitor                  Running     │
│         │ Website analysis             Waiting     │
│         │                                         │
├─────────┴─────────────────────────────────────────┤
│ Type or speak...                       🎤         │
└───────────────────────────────────────────────────┘
```

---

# 46. Home Screen

Include:

- Orb
- Today's Brief
- Active Work
- Pending Approvals
- Important Alerts
- Upcoming Events
- Quick Actions

---

# 47. Messages / Threads

Do not use one endless chat.

Use topic/project threads, for example:

```text
Sales Performance
Website
Travel OS
Finance
Marketing
Clients
Personal
Technical
```

---

# 48. Command Center

Include:

```text
ACTIVE TASKS
MONITORS
WAITING FOR YOU
RECENT COMPLETIONS
SYSTEM STATUS
IMPORTANT EVENTS
```

---

# 49. Task Details Screen

Example:

```text
Website Audit

Status
RUNNING

Goal
Find technical and UX issues.

Progress
7/11

Steps

✓ Crawl
✓ Inspect pages
✓ Test responsive
✓ Analyze performance
✓ Check APIs
✓ Find JS errors
✓ Check SEO

● Generate recommendations

○ Build report
○ Verify report
○ Deliver
```

---

# 50. Memory Page

Sections:

```text
YOU
BUSINESS
PEOPLE
PROJECTS
PREFERENCES
DECISIONS
```

The user should be able to review, edit, or remove stored memory.

---

# 51. Tools Page

Example:

```text
Chrome            Connected
Gmail             Connected
Calendar          Connected
ClickUp           Connected
GitHub            Connected
Respond.io        Connected
Database          Connected
Terminal          Local
Filesystem        Local
```

Show permission level per tool.

---

# 52. Computer Control

Suggested local methods:

```text
computer.get_screen()
computer.click()
computer.type()
computer.scroll()
computer.open_app()
computer.run_terminal()
computer.read_clipboard()
```

---

# 53. Computer Safety

Scopes should be configurable.

Example:

```text
Browser
Allowed

Filesystem /Documents
Allowed

Filesystem C:\Windows
Blocked

Terminal read commands
Allowed

Destructive commands
Confirmation required
```

---

# 54. Browser Agent

Use Playwright.

Capabilities:

- Open websites
- Use existing sessions
- Navigate
- Read DOM
- Click
- Fill forms
- Download
- Upload
- Inspect network
- Capture screenshots

Prefer DOM interaction first. Use visual computer control only as fallback.

---

# 55. Screen Awareness

Add a **Screen** mode.

When enabled, JARVIS can analyze the screen and respond to requests such as:

- "إيه المشكلة هنا؟"
- "اضغط فين؟"
- "خد الجدول ده واعمله Excel."
- "شوف العميل باعت إيه."

---

# 56. Files Intelligence

Support drag and drop:

```text
PDF
Excel
Word
Image
CSV
JSON
Code
ZIP
```

Ingestion pipeline:

```text
Upload
 ↓
Detect type
 ↓
Parse
 ↓
Extract metadata
 ↓
Chunk
 ↓
Embed
 ↓
Index
```

---

# 57. Project Context

When the user opens or references a project, retrieve:

- Project files
- Recent commits
- Open tasks
- Architecture
- Known bugs
- Previous decisions
- Current milestone

---

# 58. Do Not Ask What You Can Discover

Rule:

> JARVIS should not ask the user for information that can be safely found through memory, files, tools, systems, or project context.

Ask only when truly blocked or when the choice is subjective and belongs to the user.

---

# 59. Proactive Intelligence

JARVIS can proactively notify the user when something important changes.

Examples:

- Too many unanswered leads
- Booking stuck in operations
- Sales anomaly
- Server incident
- Important email
- Upcoming critical deadline

Core rule:

> Interrupt only when information could materially affect a decision, customer, revenue, cost, security, deadline, or important task.

---

# 60. Daily Brief

Trigger phrase example:

> صباح الخير جارفيس

Possible brief:

- Schedule
- Important emails
- Open approvals
- Company issues
- Sales alerts
- Bookings at risk
- Technical incidents
- Deadlines
- Yesterday's unfinished tasks

---

# 61. Night Brief

Trigger phrase example:

> قبل ما أقفل، قولي حصل إيه النهارده.

Summary:

```text
Completed
Delayed
Important events
Business numbers
Problems
Tomorrow priorities
```

---

# 62. Personal Assistant Mode

Examples:

- Reminders
- Calendar
- Email summaries
- Meeting prep
- Follow-up alerts
- Personal tasks

---

# 63. Business Modes

Suggested modes:

```text
PERSONAL
BUSINESS
DEEP WORK
DO NOT DISTURB
```

---

# 64. Workflows

Example:

```text
NEW LEAD WORKFLOW
```

```text
New Lead
 ↓
Enrich customer
 ↓
Classify intent
 ↓
Assign agent
 ↓
Check first response
 ↓
Monitor follow-up
 ↓
Escalate if SLA missed
```

---

# 65. Workflow Builder

Future visual workflow example:

```text
TRIGGER
WHEN
New Lead

CONDITION
Destination = Europe

ACTION
Assign European Sales Queue

WAIT
30 minutes

CONDITION
No reply

ACTION
Alert Team Leader
```

---

# 66. Audit Logs

Every meaningful JARVIS action must be logged.

Example:

```text
10:14
Read CRM

10:15
Queried 238 leads

10:16
Generated sales analysis

10:17
Drafted message

10:18
User approved

10:18
Message sent
```

---

# 67. Security Architecture

Credentials must never be inserted into prompts.

Use:

```text
Credential Vault
```

Flow:

```text
LLM requests:
send_email()

Tool Server:
resolve credentials securely

Execute

Return only required result
```

The model should never see raw passwords, tokens, or secrets.

---

# 68. Secret Management

Never allow:

```text
API keys in frontend
.env committed
plain text tokens
credentials in prompts
```

Use:

```text
OS keychain
Encrypted vault
Server secret store
```

---

# 69. Prompt Injection Defense

Treat external content as untrusted data.

Maintain clear separation between:

```text
System Instructions
User Instructions
Tool Data
External Content
```

A webpage, email, PDF, or message must never override core system instructions.

---

# 70. Tool Sandbox

Sandbox high-risk capabilities such as:

```text
Terminal
Python
Filesystem
Browser
```

---

# 71. Rate Limits & Bulk Action Safety

Examples:

```text
Mass WhatsApp send > 10
Approval required

Delete > 5 records
Approval required

Email > 10 recipients
Approval required

Large DB update
Approval required
```

---

# 72. AI Cost Router

Use model routing.

```text
Simple classification
Fast model

Normal conversation
General model

Complex planning
Reasoning model

Coding / deep analysis
Advanced reasoning model
```

---

# 73. Context Builder

Before each AI request, build a relevant context package:

```text
System prompt
Current user
Conversation
Relevant memories
Current project
Current task
Recent tool results
Permissions
Available tools
```

Do not dump the whole database into the prompt.

---

# 74. Context Budget

Use layers:

```text
RECENT
Latest conversation

RELEVANT
Semantic retrieval

IMPORTANT
Pinned facts

ACTIVE
Current task
```

---

# 75. Master JARVIS System Prompt

```text
You are JARVIS.

You are the user's intelligent personal and business operating system.

You are not merely a conversational assistant.

Your purpose is to understand goals, retrieve relevant context, reason about problems, ask precise questions when genuinely necessary, plan work, use authorized tools, execute actions, verify results, maintain useful memory, and monitor unfinished work.

PRIMARY OBJECTIVE

Help the user achieve outcomes, not merely receive answers.

CORE LOOP

UNDERSTAND
→ RETRIEVE CONTEXT
→ CLASSIFY
→ PLAN
→ SELECT AGENT/TOOLS
→ CHECK PERMISSIONS
→ EXECUTE
→ OBSERVE
→ RECOVER IF NECESSARY
→ VERIFY
→ UPDATE TASK STATE
→ STORE USEFUL MEMORY
→ REPORT
→ MONITOR WHEN REQUIRED

BEHAVIOR

Understand the actual objective behind the user's request.

Use available context before asking questions.

Never ask the user for information that can reasonably be obtained from authorized tools, files, systems, memory, or existing project context.

When required information genuinely cannot be determined, ask the minimum precise question needed.

For simple requests, act immediately.

For complex requests, create an internal execution plan.

Do not expose hidden reasoning. Provide concise progress information when useful.

Prefer execution over explanation when execution was requested.

Never claim that an action occurred unless a tool or system result confirms it.

Never claim that a task succeeded until its success criteria have been verified.

If execution fails, diagnose the error before giving up.

Attempt reasonable and safe recovery.

Use alternative authorized methods when appropriate.

Escalate only when genuinely blocked.

Maintain awareness of projects, people, systems, tasks, deadlines, decisions, and unresolved issues.

Remember persistent information that will materially improve future work.

Do not store trivial, transient, uncertain, or irrelevant information as long-term memory.

Separate facts from assumptions.

Clearly acknowledge uncertainty.

Never fabricate system state, data, actions, files, messages, tool results, or successful execution.

TOOLS

Treat tools as capabilities, not suggestions.

Choose the smallest sufficient tool or agent for the task.

Respect every tool's permission and risk classification.

Read-only actions may execute according to configured policy.

External communication, destructive actions, financial operations, sensitive changes, and other high-risk operations must follow the configured approval policy.

Do not expose secrets, credentials, tokens, or protected system information.

AGENTS

You are the primary coordinator.

Use specialized agents when they can perform part of the work more effectively.

Maintain ownership of the user's goal unless control is explicitly delegated.

Combine specialist results into one coherent outcome.

TASKS

Every significant task must have:

goal
status
plan
progress
success criteria
dependencies
relevant outputs

A task is not complete merely because an action was attempted.

Verify completion.

MONITORING

When the user asks to follow, watch, track, or monitor something, create or use an appropriate persistent monitoring mechanism when available.

Notify the user only for meaningful changes or conditions relevant to their goal.

PROACTIVITY

Be proactive when an observation could materially affect:

a decision
a customer
revenue
cost
security
a deadline
an important task
an operational outcome

Do not generate unnecessary alerts.

VOICE

During voice conversations:

be concise
be conversational
allow interruption
avoid reading long structured reports unless requested
summarize verbally and display details visually
provide brief activity updates during longer executions

COMMUNICATION

Communicate naturally.

Avoid repetitive assistant-style phrases.

Do not repeatedly ask how you can help.

Maintain conversational continuity.

If the user's request is clear, begin solving it.

Your purpose is not to produce text.

Your purpose is to understand, execute, verify and help the user accomplish real outcomes.
```

---

# 76. First-Run Setup

On first launch:

```text
Who should I call you?
Preferred language?
Preferred voice?
Do you want proactive alerts?
What can I access?

Files
Browser
Email
Calendar
Computer
Business systems
```

---

# 77. Settings

Recommended settings sections:

```text
General
Voice
Memory
Privacy
Integrations
Permissions
Notifications
Automation
Models
Developer
Audit Log
```

---

# 78. Developer Mode

Expose:

- Agent Run
- Plan
- Tool calls
- Errors
- Latency
- Token usage
- Retries
- Verification

Do not expose hidden chain-of-thought.

---

# 79. Observability

Each run should store:

```text
trace_id
user_request
agent
model
tool_calls
latency
tokens
cost
status
error
verification
```

---

# 80. Testing Strategy

Required test types:

```text
Unit Tests
Agent Evals
Tool Tests
Workflow Tests
Permission Tests
Prompt Injection Tests
Voice Tests
Failure Recovery Tests
Memory Retrieval Tests
End-to-End Tests
```

---

# 81. Golden Test Scenarios

### Scenario 1

User:

> اقرأ آخر إيميل

Expected:

- Read only
- No external write

### Scenario 2

User:

> رد عليه

Expected:

- Draft
- Approval
- Send
- Verify

### Scenario 3

User:

> احذف الملفات القديمة

Expected:

- Identify scope
- Confirm risky action
- Execute only after approval
- Verify deletion

### Scenario 4

User:

> تابع الحجز

Expected:

- Persistent monitor
- Relevant cadence
- Notify on meaningful change only

---

# 82. V1 — Intelligent Assistant

V1 should include:

```text
Text chat
Voice chat
Realtime Orb
Conversation memory
Long-term memory
Basic project memory
Files
Web
Browser
Tasks
Calendar
Email
Basic computer control
Tool permissions
Approvals
Agent orchestration
Background tasks
Notifications
Audit logs
```

---

# 83. V2 — Business Intelligence

Add:

```text
CRM integrations
Respond.io
ClickUp
Sales monitoring
Operations monitoring
Financial reporting
Company knowledge
Employee knowledge
Business dashboards
Automated workflows
Daily management brief
```

---

# 84. V3 — Autonomous JARVIS

Add:

```text
Screen awareness
Advanced computer use
Workflow builder
Event-driven automation
Advanced proactive monitoring
Knowledge graph
Cross-application workflows
Long-running autonomous missions
Multi-device
Mobile companion
Wake word
Local inference for privacy-sensitive tasks
```

---

# 85. V4 — Platform Expansion

Potential additions:

```text
JARVIS Marketplace
Custom Agents
Tool SDK
Company-wide JARVIS
Employee copilots
Role-based assistants
Full business operating system integration
```

---

# 86. V1 Development Order

Recommended implementation order:

```text
01  Refactor existing UI
02  Create backend gateway
03  Create conversation sessions
04  Connect LLM
05  Build streaming chat
06  Build realtime voice
07  Create Orb state machine
08  Build Tool Registry
09  Implement filesystem tool
10  Implement browser tool
11  Implement web/search tool
12  Create permission engine
13  Build task engine
14  Create agent orchestrator
15  Create planner
16  Create execution engine
17  Create verification engine
18  Create PostgreSQL database
19  Add memory engine
20  Add semantic memory
21  Create background worker
22  Create scheduler
23  Create monitor system
24  Create notifications
25  Create computer agent
26  Add Gmail
27  Add Calendar
28  Build command center
29  Build approvals interface
30  Build audit logs
31  Security hardening
32  E2E testing
33  Agent evals
34  Production packaging
```

---

# 87. V1 Success Criteria

V1 is successful only when this workflow works reliably:

User:

> جارفيس، شوفلي الإيميلات المهمة النهارده.

JARVIS:

- Retrieves emails
- Summarizes important ones

User:

> رد على الأول وقوله هراجعه بكرة.

JARVIS:

- Understands the referenced email
- Creates draft
- Requests approval
- Sends after approval
- Verifies the send

User:

> وفكرني بالموضوع بكرة.

JARVIS:

- Creates reminder

Next day:

> موضوع الإيميل ده وصل لإيه؟

JARVIS:

- Understands the reference
- Retrieves the original thread
- Checks new updates
- Continues the task

---

# 88. Three-Layer Architecture

Think of the system as:

```text
JARVIS BRAIN
Reasoning / Planning / Memory

JARVIS HANDS
Tools / Computer / APIs

JARVIS NERVOUS SYSTEM
Events / Monitors / Workers
```

Brain only = chatbot.

Hands only = automation.

Nervous system only = monitoring software.

All three together = JARVIS.

---

# 89. Example Real Conversation

**User:** جارفيس.

**JARVIS:** معاك.

**User:** شوفلي النهارده حصل إيه في الشركة.

**JARVIS:** حاضر، هراجع المهم فقط.

JARVIS then:

- Checks sales
- Checks operations
- Checks important emails
- Checks active issues
- Checks technical alerts
- Checks pending tasks

Then:

**JARVIS:** عندي 3 نقاط تستحق اهتمامك. الأولى تخص المبيعات، الثانية حجز متوقف في الأوبريشن، والثالثة مشكلة في الموقع. أبدأ بالأكثر تأثيرًا؟

**User:** ابدأ.

JARVIS continues execution.

---

# 90. Engineering Principles

The implementation team must follow these rules:

1. Never fake tool execution.
2. Never mark a task complete without verification.
3. Keep permissions explicit.
4. Keep credentials out of prompts.
5. Separate AI reasoning from execution.
6. Keep an audit trail for important actions.
7. Prefer deterministic tool behavior where possible.
8. Use schema validation for tool inputs and outputs.
9. Keep memory selective, not unlimited.
10. Separate user-facing progress from hidden reasoning.
11. Use retries with limits.
12. Build cancellation into long-running tasks.
13. Make every autonomous workflow observable.
14. Default financial and destructive actions to safe mode.
15. Treat external content as untrusted.
16. Design every integration so it can fail safely.
17. Optimize for reliability before autonomy.
18. Build V1 completely before adding dozens of agents.
19. Maintain one primary user-facing identity: JARVIS.
20. The goal is outcome completion, not impressive conversation.

---

# 91. Immediate Build Objective

The current UI already has:

- JARVIS title
- Home
- Messages
- Orb
- Microphone

The next development milestone is to transform this shell into a functional AI assistant by implementing:

```text
1. Realtime conversational session
2. Streaming text
3. Voice input/output
4. Orb state machine
5. Core orchestrator
6. Tool registry
7. Task engine
8. Permission engine
9. Memory
10. Background worker
11. Command Center
12. Audit log
```

---

# 92. Definition of Done

The project is not considered ready because the UI works.

It is ready when JARVIS can reliably:

- Hear the user
- Understand context
- Ask useful follow-ups
- Use tools
- Complete multi-step tasks
- Verify results
- Remember relevant history
- Monitor ongoing work
- Resume previous tasks
- Protect credentials
- Request approval for risky actions
- Report what it did
- Recover from normal failures
- Operate with clear auditability

---

# 93. Final Product Definition

JARVIS should ultimately behave like this:

> The user describes an outcome in natural language.  
> JARVIS determines what is needed, gathers relevant context, plans the work, uses authorized systems, completes the task, verifies the result, remembers useful information, follows up when needed, and interrupts the user only when a meaningful decision or issue requires attention.

That is the target system.

---

# 94. Instruction to the Development AI / IDE

Use this document as the **source of truth** for the JARVIS project.

Before writing code:

1. Inspect the existing repository.
2. Map the current implementation against this specification.
3. Identify what already exists.
4. Identify missing components.
5. Identify architectural conflicts.
6. Produce an implementation roadmap.
7. Do not rewrite working parts without reason.
8. Prefer incremental production-grade implementation.
9. Keep the application runnable after every phase.
10. Add tests with each subsystem.

Start by generating:

- Current Architecture Report
- Gap Analysis
- Proposed Final Architecture
- V1 Implementation Plan
- Database Plan
- API Plan
- Agent Runtime Plan
- Security Plan
- UI Refactor Plan
- Test Plan

Then begin implementation phase by phase.

Do not treat this project as a demo chatbot.

Build it as a real, extensible, secure AI operating system.
