# QPilot Testing Platform Blueprint

## Goal

Build QPilot from a browser-first QA agent into a full testing platform that can answer one release question in one place:

1. Did the critical user flows pass?
2. Did benchmark scenarios regress?
3. Did the service still hold under traffic?
4. Can this build ship safely?

The key idea is not "add one more load testing page". The key idea is to make load testing a first-class execution plane inside the same platform.

## What Already Exists

QPilot already has a strong base in the functional lane:

- Browser automation with Playwright
- Structured AI planning, refinement, verification, and halt logic
- Step persistence, replay, rerun, compare, benchmark scenarios
- Report generation, evidence capture, and human-readable diagnosis
- Manual takeover and challenge recovery

This means the platform does not start from zero. It already has:

- A functional execution plane
- A scenario registry prototype
- An evidence plane for screenshots, videos, and reports
- A benchmark cockpit foundation

## What Is Missing For A Full Platform

To become a complete testing platform, these gaps must be filled:

- Load profile modeling
- Distributed load injector orchestration
- Time-series metrics and SLO evaluation
- Unified release gate policies across test types
- Environment and service topology modeling
- Approval, waiver, and audit workflow

## Product IA

Recommended top-level product modules:

1. Control Tower
   One place to see release readiness across all testing signals.
2. Functional Lab
   Real browser journeys, replay, diagnosis, and template repair.
3. Benchmark Workbench
   Stable scenario baselines, regression tracking, and historical compare.
4. Load Studio
   Capacity, latency, and degradation behavior under traffic.
5. Evidence Hub
   Centralize screenshots, videos, reports, traces, and metrics.
6. Gate Center
   Convert all evidence into ship / hold / waive decisions.

## UI Design

The UI should be role-oriented, not only artifact-oriented.

### 1. Control Tower

Primary user:

- Release manager
- QA lead
- Incident commander

Primary widgets:

- Release readiness score
- Functional health strip
- Benchmark regression strip
- Load and SLO strip
- Environment risk panel
- Top blockers list

Primary actions:

- Open failed scenario
- Compare against last green
- Open latest load run
- Approve waiver
- Hold release

### 2. Functional Lab

Primary user:

- QA engineer
- Frontend or E2E owner

Primary widgets:

- Live run detail
- Rerun and compare
- Benchmark scenario cockpit
- Inline diff preview
- Repair recommendation

### 3. Load Studio

Primary user:

- Backend engineer
- SRE
- Performance engineer

Primary widgets:

- Load profile builder
- Injector pool selector
- Scenario and environment picker
- SLO threshold editor
- Time-series charts
- Degradation timeline
- Error hotspot table

Primary actions:

- Start dry run
- Start spike test
- Start soak test
- Compare against last baseline
- Pin run as capacity baseline

### 4. Gate Center

Primary user:

- Release manager
- QA lead

Primary widgets:

- Gate policy list
- Current build verdict
- Failed checks grouped by severity
- Waiver history
- Approval timeline

## Load Tool Design

### Recommendation

Use a pluggable load engine model:

- `k6` as the primary API and service load engine
- Playwright browser load only as a low-concurrency realism probe
- Optional synthetic workflow runner for mixed API plus browser checkpoints

### Why

Because the platform should separate:

- realism
- scale
- orchestration
- reporting

Playwright is excellent for realism, but poor as the main high-volume injector.

k6 is better for:

- concurrency
- script portability
- distributed workers
- metrics collection
- cost

### Load Test Types

Support these profiles first:

1. Ramp-up
2. Steady-state
3. Spike
4. Soak
5. Breakpoint search

Each profile should include:

- scenario id
- target environment
- concurrency plan
- duration plan
- request mix
- arrival model
- SLO thresholds
- stop conditions
- evidence policy

## Architecture

### High-Level Layers

1. Experience Layer
   Web console and desktop cockpit for operators.
2. Control Plane
   Scheduler, policy engine, scenario registry, environment registry.
3. Execution Plane
   Browser agent runtime, API runners, load injectors, worker pools.
4. Evidence And Metrics Plane
   Artifacts, reports, traces, logs, TSDB, regression compare.
5. Integration Plane
   CI, webhook, issue tracker, chatops, approval system.

### Proposed Runtime Expansion

Current runtime mainly thinks in terms of single browser runs.

It should evolve toward these services:

- `run-orchestrator`
  Existing browser orchestration logic
- `benchmark-orchestrator`
  Existing replay, compare, and scenario registry logic
- `load-orchestrator`
  New job planner for load profiles and injector scheduling
- `gate-orchestrator`
  New service for verdict generation and policy enforcement
- `metrics-ingestor`
  New service to collect load outputs and normalize SLO metrics

### Suggested Data Model Additions

Add these entities:

- `load_profiles`
- `load_runs`
- `load_run_workers`
- `load_run_metrics`
- `environment_targets`
- `service_map_nodes`
- `release_gates`
- `release_gate_results`
- `waivers`

## Suggested Page Map

Recommended routes:

- `/platform`
- `/platform/releases/:releaseId`
- `/platform/load`
- `/platform/load/:loadRunId`
- `/platform/environments`
- `/platform/gates`

Current routes can stay:

- `/projects`
- `/runs`
- `/runs/:runId`
- `/reports/:runId`
- `/benchmarks/:caseId`

## Functional Design

### A. Scenario Registry

Scenario registry should become shared infrastructure for:

- functional replay templates
- benchmark baselines
- load profiles
- release gates

Every scenario should be able to own:

- title
- goal
- entry url
- owners
- service tags
- risk tier
- functional template
- load profile set
- current benchmark baseline

### B. Release Verdict

A release verdict should aggregate:

- core flow pass rate
- benchmark regression count
- load SLO pass rate
- challenge / block rate
- severity-weighted failure score

Suggested verdicts:

- green
- yellow
- red
- waived

### C. Evidence Correlation

The platform should correlate:

- browser step evidence
- API failures
- load metrics spikes
- deployment version
- environment target

This is how the platform becomes more than a report generator.

## Rollout Plan

### Phase 1

Build Load Studio MVP:

- load profile CRUD
- k6 adapter
- load run history
- basic metrics charts
- load report page

### Phase 2

Build unified gate model:

- combine functional, benchmark, and load signals
- expose release verdict page
- add SLO and threshold policies

### Phase 3

Build environment and service map:

- dependency mapping
- ownership mapping
- environment segmentation
- blast-radius view

### Phase 4

Build enterprise layer:

- audit log
- RBAC
- approvals
- waivers
- webhook and CI bridge
- private deployment story

## Immediate Recommendation

If implementation starts now, the highest-value next slice is:

1. Add a `Load Studio` page and route
2. Define load profile schema in `packages/shared`
3. Add `load_runs` API surface in runtime
4. Start with a `k6` adapter instead of a custom injector
5. Join load summary into the existing benchmark and compare UX

This gives QPilot a realistic path from strong browser QA product to full testing platform without losing its current differentiation.
