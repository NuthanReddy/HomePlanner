# HomePlanner Azure platform migration

Status: Local implementation approved; Azure resource creation deferred by user.

## Requested execution scope: 8 October 2026

Implement and provision only the current authenticated project-metadata slice
for development/testing. Preserve the legacy planner and user-owned checkout;
do not commit, push or modify existing live project databases.

1. Migrate the backend to Azure SQL with Entra identity authentication, compatible
   schema/migrations, transaction-safe OTP/rate limits and explicit database
   unavailable states. Support durable local SQLite development storage alongside
   Azure SQL, with documented local API/frontend startup and migrations.
   Preserve disposable SQLite regression fixtures. Local execution must not
   require a cloud database or overwrite existing local/browser projects.
   Real SMS authentication still requires configured ACS delivery; any offline
   OTP development workflow requires an explicit, development-only decision and
   must never be enabled by production configuration.
2. Prepare versioned API/frontend containers and reproducible AZD/Bicep
   infrastructure. Use one dev resource group, a Consumption Container Apps
   environment, frontend/API apps, Basic registry, free-offer SQL database,
   VNet/subnets, SQL private endpoint/DNS, Key Vault and low-volume diagnostics.
   Use managed identities with least-privilege permissions; SQL uses Entra-only
   authentication, never a SQL administrator password.
3. Validate local behavior, infrastructure, actual South India SKU availability,
   free-offer application, existing free-database region restrictions and quotas.
   If unavailable, stop for a decision; do not substitute a paid database/region.
4. Provision the validated dev slice in the previously selected personal MSDN
   subscription in South India. Keep spending limit enabled. Set SQL
   `Auto-pause the database until next month`; never enable paid continuation.
5. Verify local and deployed health and persistence without uploading legacy/user projects.
   Database administration and runtime permissions must be scoped and verified.

Expected low-usage infrastructure baseline: approximately INR 1,231/month
before tax, variable usage and SMS, under BILLING.md assumptions. This is not a
hard cost cap. Do not enable paid Container Apps environment features, dedicated
profiles, Container Apps private endpoints, or planned maintenance.

Defer live SMS sender acquisition/sends until destination and subscription
eligibility are confirmed. Sign-in cannot be presented as operational without
real delivery; no fixed-code or runtime authentication bypass. Do not provision
Service Bus, Blob, workers, AI services, Front Door or production availability
capacity in this slice. The full design/simulation migration remains separate.

Required approval: this exact scope, selected personal MSDN subscription,
South India, baseline recurring charges and scoped managed-identity/Entra
permissions. No cloud mutations before approval and Azure validation.

User decision: implement locally first. A development-only local OTP inbox is
approved for offline sign-in; use random expiring codes, loopback-only access,
explicit simulated-delivery labels and fail-closed production configuration.
Analyze uses the existing Python module contracts where supported; full
geometry-dependent engines require authored scene migration and actual engine
prerequisites. Do not substitute browser calculations as Python results.

## Confirmed requirements

- Preserve the locked Site / Design / Analyze / Compare design.
- Python backend, React HTTP client, Azure SQL free-offer dev/test target,
  mandatory SMS OTP sign-in. Current backend remains PostgreSQL pending migration.
- Use Azure for hosted services; Azure Communication Services for SMS.
- Preserve the incumbent planner during an incremental migration.
- No automatic generation during analysis; alternatives require explicit action.

## Proposed service mapping

Approved for local implementation on 8 October 2026:

| Component | Azure service target |
|---|---|
| Python API and simulation workers | Container Apps |
| React hosting | Container Apps frontend, same-origin API routing |
| Relational project/account state | Azure SQL Database free General Purpose serverless offer; migration pending |
| Background dispatch | Service Bus |
| Export/study artifacts | Blob Storage |
| SMS OTP delivery | Communication Services |
| Secrets | Key Vault |
| Monitoring | Application Insights and Log Analytics |
| Service credentials | Managed identities |

Use AZD/Bicep for later infrastructure preparation; no infrastructure has been
generated. Validate quotas, eligibility and service costs only after subscription,
region and sizing are confirmed. These are service targets, not claims of
provisioned or integrated resources.

## Implementation stages

1. Implemented authenticated API and project-metadata persistence foundation.
2. Implemented HTTP-backed React account/project workspace and first native Site stage.
3. Native Site/Costs commands, Undo/Redo and bounded rectangular feasibility are
   implemented locally. Room geometry, remaining analysis adapters, full fees
   and utilization comparisons remain staged; see docs/python-react-platform.md.
4. Durable background jobs and explicit alternative-plan optimization.
5. Azure infrastructure, deployment validation and deployment approval.

Local follow-up: implemented dedicated SQLite startup/migrations and persistent
session secret, production-blocked loopback OTP inbox, and real pvlib/PsychroLib
Analyze utility endpoints/UI. Native Light/CFD/Thermal engines and authored-scene
adapters remain pending; no cloud resource has been created.

## Outstanding deployment context

MSDN is the selected dev/test offer and South India is the estimate region.
Use the Azure SQL free offer with **Auto-pause the database until next month**,
subject to actual subscription/region availability. SQL private endpoint and DNS
are separately billed. Budget, SMS sender eligibility and resource sizing remain
unconfirmed. No deployment, resource creation or paid SMS sends are authorized
by this implementation plan.

## Local verification and limitations

The foundation has isolated SQLite API regressions and HTTP-client/build checks.
Azure SQL driver/migration, concurrency and connection lifecycle, actual ACS
delivery and distributed worker correctness
are not yet verified. No fixed-code authentication exists in the runtime; only
the dedicated disposable browser test server injects a recording SMS sender.

This plan is not Ready for Validation or Deployed. Infrastructure generation,
Azure validation and deployment require the deferred context and separate approval.
