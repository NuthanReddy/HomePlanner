# HomePlanner: Azure billing and free allowances

**Checked: 8 October 2026.** This is a minimal-configuration cost guide, not an
Azure invoice or regional quote. The selected subscription's offer and reported
credit balance are recorded below; other promotions remain unconfirmed.
No resources have been provisioned by this migration.

### Selected development subscription

| Detail | Confirmed / reported value |
|---|---|
| Subscription offer | Visual Studio Enterprise / MSDN |
| Offer ID | `MS-AZR-0063P`, supplied from the Azure portal |
| Subscription state | Enabled, verified through Azure CLI |
| Spending limit | On, verified through the subscription policies API |
| Published monthly benefit | USD $150 credit while the qualifying Visual Studio Enterprise subscription remains active |
| Remaining credit | INR 12,499.94, shown in the user's portal screenshot on 8 October 2026; a point-in-time balance, not the monthly grant or a cost estimate |
| Credit reset | The 22nd of each month, reported by the user; next reset after this check is 22 October 2026 |
| Rollover | Unused monthly credit does not carry forward |
| Permitted workload | Development and testing only; not production/customer-facing hosting |

The credit-balance API did not return a balance or reset date; those details
come from the portal screenshot and the user's report, respectively. Personal
account, directory and subscription identifiers are intentionally omitted.

Budget HomePlanner development against this monthly credit cycle, retaining
the spending limit. Credit exhaustion can suspend services until the next
cycle; removing the limit can enable pay-as-you-go charges. Credit does not
cover every product: the published offer excludes Application Insights and
other listed services. Verify each service's eligibility before provisioning,
especially SMS and sender acquisition.

This MSDN offer does **not confirm eligibility for the standard Azure Free
Account's 12-month promotions** listed below. Treat their allowances as
conditional, not part of this subscription's confirmed budget. Subscription
credit resets on the 22nd; service grants may use a separate calendar-month
or billing-account period.

## 1. Bottom line

The complete Azure-hosted application is **not automatically free**.
Container Apps can fit a recurring compute allowance at low usage; PostgreSQL,
image registry, SMS and networking can still incur charges.

Separate three concepts:

- **Recurring free allowance:** replenishes on its stated billing scope each month.
- **Introductory offer:** available only to eligible new accounts for a limited
  period, commonly 12 months. Existing subscriptions must not assume eligibility.
- **Trial credit:** a temporary payment credit, not a service's free tier.
  Standard Azure free-account marketing offers $200 for 30 days; eligibility and
  excluded products apply. Do not assume it pays for SMS/phone-number products.

Free quotas are not spending caps. Moving to pay-as-you-go can result in charges
above allowances or after offers expire. Budget alerts do not automatically stop
resources or prevent a bill.

## 2. Minimal configuration assumptions

This document assumes one low-traffic development environment:

| Component | Cost-model assumption |
|---|---|
| Frontend / API | Two Container Apps on Consumption; each initially 0.25 vCPU / 0.5 GiB; minimum replicas 0 |
| Database | Selected: one Azure SQL free-offer General Purpose serverless database, max 32 GB, pause at free limit; implementation migration pending. PostgreSQL B1ms remains a comparison only |
| Images | One Basic registry for paid-account baseline; eligible free-account registry offer uses Standard, not Basic |
| SMS | Only real sign-in/resend requests; approved sender and destination countries still undecided |
| Logs | Small sampled telemetry volume, short default retention; no ingestion commitment tier |
| Queue / worker / artifacts | Defer until the actual domain job pipeline exists |
| Optional infrastructure | No Foundry model, AI Search, Front Door, APIM, Redis or AKS in the initial development estimate |

Scale-to-zero and database auto-resume introduce cold starts. A free development database and a
non-HA, minimal deployment are **not proof of production capacity or availability**.
Networking remains a separate cost line; these assumptions do not authorize
weakening the production private-access architecture.

South India (`southindia`) is the selected region for this estimate, not an
approved deployment. SMS recipient countries remain unconfirmed. The selected
development offer and portal credit currency are recorded above.
The regional table below uses INR retail rates before tax. Dollar examples
elsewhere remain USD illustrations, not an India SMS quote.

## 3. What is paid, and what is free?

**South India price check: 8 October 2026, INR, before tax.** Rates are from
Azure's public Retail Prices API, not a negotiated or subscription-specific
invoice. Monthly examples use 730 server-hours and 30 registry-days. No
12-month promotional allowances are deducted. Recurring grants are shared, not
per application; assumed usage must stay within their available balance.

| Resource | Recurring allowance / no-charge component | Introductory offer, if eligible | When charges occur | South India retail rate (INR, before tax) | Bare-minimum monthly estimate / scope |
|---|---|---|---|---|---|
| Azure SQL Database free offer (selected dev/test target) | Per database: 100,000 vCore-seconds, max 32 GB data and 32 GB backup monthly; up to 10 free databases/subscription | Not the standard 12-month free-account promotion; published eligibility includes MSDN, subject to offer availability | Selected pause-at-limit setting makes the database unavailable until next calendar month; enabling paid continuation incurs serverless overage | Database **INR 0 within offer**. Public South India General Purpose Gen5 serverless overage meter: INR 60.6007/vCore-hour; memory-based minimum compute billing and storage also matter | **INR 0 database charges** with the applied offer and pause at limit; **private endpoint + DNS extra**. Current PostgreSQL backend migration pending |
| Container Apps Consumption, including Jobs | 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million external HTTP requests per subscription/calendar month | No new-account restriction needed for this recurring grant | Over the shared allowance; active/idle meters differ; dedicated profiles, certain environment features and networking can add charges | Active CPU: INR 0.0023/vCPU-second; memory: INR 0.0003/GiB-second; CPU idle: INR 0.0003/vCPU-second; INR 38.3958/million chargeable requests | **INR 0 compute/requests** if both 0.25-vCPU/0.5-GiB apps together stay within the shared grants and scale to zero; no paid environment features assumed. Jobs deferred |
| PostgreSQL Flexible Server | No general perpetual free hosted server | 750 B1ms hours/month, 32 GB storage and 32 GB backup storage for 12 months | Ineligible/expired offer, different SKU, extra compute/storage/backup, HA/replicas | B1MS: INR 2.3517/hour; ordinary data storage: INR 16.6734/GB-month; chargeable LRS backup: INR 13.8225/GB-month | **INR 2,250.29** = INR 1,716.74 compute + INR 533.55 for 32 GB storage. No HA; backups within included allocation; extra disk performance/backup excluded |
| Container Registry | No general perpetual free registry | One Standard registry with 100 GB included storage for 12 months | Registry's daily tier fee, extra storage and applicable transfer; a Basic deployment is not automatically covered by the Standard offer | Basic: INR 15.9918/day; excess storage: INR 9.5989/GB-month; paid ACR Tasks: INR 0.0096/vCPU-second | **INR 479.75** for 30 days, within Basic's 10 GB included storage; no paid ACR Tasks. INR 495.75 for 31 days |
| Service Bus | No general perpetual free broker service; Basic is operation-billed rather than a Standard hourly base unit | Standard base unit: 750 hours and 13 million operations/month for 12 months | Standard hourly base fee beyond eligibility; additional operations/connections; Premium capacity has a separate model | Basic: INR 4.7995/million operations. Standard base: INR 1.2902/hour; API also lists an INR 959.894/month base meter; these are not additive | **INR 0 while deferred**. Later: Basic 100,000 operations about INR 0.48; Standard base about INR 942-960/month before excess operations/connections. Basic/Standard do not satisfy a Private Link requirement |
| Blob Storage | No general perpetual free storage allocation for this deployment | 5 GB Hot LRS block storage, 20,000 reads and 10,000 writes/month for 12 months | Stored data, transactions, retrieval/tier changes, redundancy and transfer beyond the applicable offer | Hot LRS first storage tier: INR 2.2845/GB-month; reads INR 0.384/10,000; writes/list operations INR 4.7995/10,000 | **INR 0 while deferred**. Later example: **INR 16.99** for 5 GB + 20,000 reads + 10,000 writes; networking/other operations extra |
| Communication Services SMS | No free SMS allowance assumed | No OTP quota assumed; credit eligibility restrictions apply | Sender leasing/registration when applicable, message segments, carrier surcharges, communications taxes/fees | **Not determined by South India hosting region**; price depends on sender, destination, registration and segments | **Unquoted, not INR 0 for working sign-in**. Live SMS is disabled; mandatory real OTP needs an eligible sender and separately confirmed budget/credit treatment |
| Key Vault Standard | No recurring free transaction allowance verified; budget as paid | Do not budget an unverified promotional allowance | Secret/key operations; premium/HSM/certificate features have separate meters | Ordinary operations: INR 2.8797/10,000; advanced key/certificate/rotation meters separate | **INR 2.88** example for 10,000 ordinary operations; no fixed secret-vault hosting charge assumed; private endpoint extra |
| Application Insights / Log Analytics | First 5 GB/month of eligible Analytics Logs ingestion per billing account | Do not double-count per app or workspace | Additional ingestion, longer retention, certain queries/log plans, tests, alerts and other billed features; not all Monitor usage is free | Analytics ingestion beyond grant: INR 331.1634/GB; chargeable retention: INR 14.3984/GB-month | **INR 0 eligible ingestion** within available 5 GB grant and included retention; no paid tests/alerts. Application Insights is excluded from the published MSDN credit offer |
| Resource group | Resource-group container itself has no separate hosting fee | Not applicable | Resources inside it still bill | No separate resource-group charge | **INR 0** |
| Managed identities / role assignments | Identity facility itself has no separate usage fee for this design | Not applicable | The services accessed using the identity still bill | No separate identity/role-assignment usage charge | **INR 0** |
| Basic VNet / subnets | VNet/subnet objects themselves do not have a basic hourly hosting fee | Not applicable | Peering, NAT Gateway, gateways, private endpoints, public IPs, firewall and other enabled networking services | No basic VNet/subnet hourly charge; paid add-ons excluded | **INR 0** for VNet/subnets alone; selected Azure SQL private endpoint is billed separately |
| Private DNS | No general free production allocation assumed | None assumed | Hosted zones and DNS query meters | Global meter applicable here: INR 47.9947/zone-month for first 25 zones; INR 38.3958/million queries | **About INR 48** for one database private DNS zone, plus queries; 10,000 queries add INR 0.38 |
| Private endpoints / Private Link | No general free allowance assumed | None assumed | Endpoint-hours and processed data; endpoints can cost money while application compute is scaled to zero | Global standard endpoint: INR 0.9599/hour + INR 0.9599/GB processed in each direction at first tier; Container Apps environment fees are separate | **INR 0 only with no separately provisioned endpoints**. Each added standard endpoint: **INR 700.73/month + data**, before service-tier/environment surcharges |
| Internet bandwidth | First 100 GB/month of applicable internet egress; inbound transfer generally free | Not a 12-month-only offer | Excess egress and separate cross-region/other network meters; do not apply this allowance to every type of transfer | Default Microsoft global network route: INR 11.5187/GB at first paid egress tier; alternate Internet route INR 10.5588/GB | **INR 0** within available applicable 100 GB grant; cross-region/other transfer excluded |

Public meter availability does not guarantee regional capacity, subscription
quota or that a service supports the intended SKU/network configuration.
Service Bus Premium is required if its Private Link access is retained; the
cheaper Basic/Standard examples are not a substitute for that architecture.
The selected Azure SQL target retains private access through a paid private
endpoint and one private DNS zone; it does not make the database publicly open.

**Selected Azure SQL target infrastructure subtotal: approximately INR 1,231/month**
before tax and live SMS: database INR 0 under the applied free offer, registry
INR 479.75, Key Vault INR 2.88, private endpoint INR 700.73 and DNS zone INR 47.99.
Endpoint data and DNS queries are additional. App compute and eligible log
ingestion must remain inside their shared grants. This is not deployed or
verified end-to-end; current backend migration and offer application are pending.

**Previous PostgreSQL comparison subtotal: approximately INR 2,781/month**
before tax and live SMS, comprising database INR 2,250.29, registry INR 479.75,
Key Vault INR 2.88 and one DNS zone INR 47.99, with app compute and eligible log
ingestion inside their shared grants. DNS queries are additional. This is a
low-usage infrastructure estimate, **not the cost of a complete working
SMS-authenticated deployment or the full design/simulation platform**.
Service Bus, Blob, worker compute and optional AI services remain deferred.

Eligible billed usage draws down the MSDN credit; it does not become a free
service. Cash charges may be zero while eligible costs stay within available
credit, but excluded services, SMS restrictions and taxes need separate checks.
The point-in-time INR 12,499.94 balance is not a promise of that balance every
month or a guarantee that all the above lines can use the credit.

### Azure SQL free-offer conditions

- Apply the offer to a **new General Purpose serverless database** and confirm
  the portal's "Free offer applied" banner. Existing databases cannot be
  restored or converted directly into this free offer.
- Allowances are per database: **100,000 vCore-seconds/month**, **32 GB data**
  and **32 GB backup**; up to **10 free databases per subscription**. Published
  terms have no introductory expiry. Actual subscription/region availability
  remains to be checked; MSDN dev/test restrictions still apply.
- Select **Auto-pause the database until next month**. At free-limit exhaustion,
  sign-in, project reads/saves and other database-backed work become unavailable
  until renewal. The application must surface this explicitly, not report saves
  as successful. Paid continuation must not be enabled without renewed approval.
- Free compute renews on the **first of each calendar month**, not the MSDN
  credit reset on the 22nd. Unused compute does not roll over.
- 100,000 vCore-seconds equals about **27.8 hours at one billable vCore**;
  this is not 24/7 hosting or guaranteed active-use time. Serverless compute
  billing also considers memory and configured minimums. Open connections,
  monitoring queries and connection pools can prevent idle auto-pause.
- In pause-at-limit mode, maximum compute is **4 vCores**, backups use LRS,
  PITR retention is **seven days**, and long-term retention is unavailable.
  No SLA is provided for the free amount; this is primarily dev/proof-of-concept.
- Enabling paid continuation cannot be reverted to the pause-at-limit option.
  Converting to a paid service tier cannot be reverted to the free offer.
- With Advanced configuration, the first free database region applies to all
  free databases in that subscription and cannot be changed; confirm South
  India and any existing free databases before creating one.
- Private endpoints, DNS, SMS and the other application services are **not
  included** in the SQL free offer. Backend support requires a deliberate
  PostgreSQL-to-Azure-SQL driver/schema/transaction migration; no live database
  has been changed or provisioned.

**Container Apps environment add-on warning:** the retail API currently lists
Dedicated Plan Management at INR 9.5989/hour and newer Environment Management /
Private Endpoint meters at INR 14.4944/hour. At 730 hours, each applicable meter
would add INR 7,007.20 or INR 10,580.91, respectively. These are **not included**
in the subtotal and must not be blindly summed: verify which meters the chosen
features actually activate in the calculator/subscription before approval.
The minimal scenario uses Consumption only, no Container Apps private endpoint,
planned-maintenance option or dedicated profile. Private data-service endpoints
are different resources and have their own charges.

All amounts must be rechecked in the actual subscription offer and regional
pricing calculator before provisioning. Eligible free-service amounts have a
specific tier and meter; they are not credits that can be transferred to a
different SKU. Dev and production environments share subscription/billing-account
allowances where the scope above specifies that.

In particular, **Key Vault does not have a verified 250,000-operations/month
recurring free grant**. Do not confuse service throttling limits with billing
allowances. The internet-egress allowance above is 100 GB, not 5 GB.

## 4. What Container Apps' free compute actually means

At an allocation of **0.25 vCPU and 0.5 GiB**, one replica consumes:

```text
CPU per running hour    = 0.25 * 3,600 = 900 vCPU-seconds
Memory per running hour = 0.5  * 3,600 = 1,800 GiB-seconds

CPU allowance equivalent    = 180,000 / 900   = 200 running replica-hours
Memory allowance equivalent = 360,000 / 1,800 = 200 running replica-hours
```

That is **200 combined replica-hours**, not 200 hours per app.
If frontend and API both run at those allocations simultaneously, it corresponds
to approximately 100 hours for the pair before exhausting their combined
compute-equivalent grant, assuming nothing else consumes it.

Two such replicas continuously allocated for a 730-hour budgeting month use
1,314,000 vCPU-seconds and 2,628,000 GiB-seconds, exceeding both grants. Actual
charges depend on eligible idle versus active rates; this calculation is a
resource-duration illustration, not an idle billing quote.

One continuously active **1 vCPU / 2 GiB** worker uses the grant-equivalent in
50 hours; **4 vCPU / 8 GiB** uses it in 12.5 hours. Candidate simulations,
retries and parallel workers share that budget. Generate-three-options may
search/evaluate many more than three candidates, so costs are not simply three
times a preview thumbnail.

Consumption Jobs are billed at active rates while executing. Only requests from
outside the Container Apps environment are billable HTTP requests; internal
frontend-to-API proxy calls in the same environment and health probes are not
another independent external-request charge.

Private endpoints and certain other Container Apps environment features can
trigger a Dedicated Plan Management charge even with Consumption workloads.
Do not treat "Consumption" as a guarantee of zero fixed infrastructure cost.

## 5. Potential monthly cost calculation

Use actual regional unit rates in the
[Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/).
The South India infrastructure scenario above has a concrete subtotal; a
complete deployment total still requires confirmed SMS destinations/sender,
offer coverage and selected networking features.

| Cost line | Calculation / major risk |
|---|---|
| PostgreSQL | Billable server-hours * B1ms hourly rate + provisioned storage + chargeable backups; usually the main always-on development cost after introductory eligibility |
| Registry | Billable days * selected tier's daily rate + storage over inclusion + applicable transfer |
| Container Apps | Chargeable CPU/memory duration at active/eligible idle rates + external requests beyond the grant + any environment fees |
| Service Bus | Selected tier base/capacity fee + chargeable operations/connections; Basic and Standard differ |
| Blob | Average GB-month by tier/redundancy + read/write operations + retrieval/transfer; versions and old job artifacts also occupy storage |
| Key Vault | Chargeable operations / pricing unit * rate; cache secrets appropriately, never fetch on every rendered field |
| SMS | Sender recurring fees + registrations + sum of billable segments * destination/sender rate + carrier surcharge + applicable taxes |
| Monitor | Chargeable ingestion by plan + retention + selected tests/alerts; avoid double-counting the shared grant |
| Network | Private endpoint-hours + data processing + DNS + enabled gateway/peering/egress/edge meters |

**Existing paid account:** expect a nonzero database/registry/network baseline
plus SMS, even if compute and eligible logs stay inside their grants.

**Eligible new free account:** database, the exact promotional registry/queue
tiers and small Blob usage may be covered temporarily. SMS and paid networking
can still bill; model both the introductory period and month 13. This document
does not confirm introductory free-account eligibility for the selected MSDN
subscription.

**Full production:** adds availability capacity, private endpoints or higher
tiers where required, ingress abuse protection, more logs and engine compute.
Do not use the minimal developer setup's grant math as a production budget.

### Verified SMS example, not a destination assumption

Microsoft's current toll-free SMS page lists a US number lease of **$2/month**,
US outbound base usage of **$0.0075/segment**, and an outbound carrier surcharge
of **$0.0025/segment**. Thus:

```text
100 single-segment US outbound OTPs:
$2 + 100 * ($0.0075 + $0.0025) = $3 before communications taxes/other fees

1,000 such segments:
$2 + 1,000 * $0.0100 = $12 before communications taxes/other fees
```

This is **not an India SMS quote**, not universal ACS availability and not a
promise that the selected account can acquire that sender. Resends count;
long/Unicode messages can become multiple segments. Other sender types may
have registration/campaign fees. Provider failures/credit eligibility must be
evaluated under actual billing terms, not presumed free.

## 6. Cost controls for this repository

- Live SMS remains disabled by default. Tests use injected recording senders;
  no live OTP or cloud infrastructure was used for the implemented slice.
- Frontend/API can start with minimum replicas 0 for development, accepting cold
  starts. Cap maximum replicas and worker concurrency; this does not cap every bill.
- Defer Service Bus/workers/Blob provisioning until the pipeline is implemented.
  Their absence must continue to show unavailable capabilities, not fake jobs.
- Do not provision Foundry, AI Search, Redis, AKS or APIM without a concrete need.
- Configure budget alerts before public exposure and monitor offer-expiration
  dates. Add application-level paid-work admission limits and SMS-spend controls.
- Keep the selected MSDN subscription's spending limit enabled and review
  remaining credit before its monthly reset on the 22nd. Use a separate
  production-eligible subscription for customer-facing hosting.
- Logs must exclude OTPs, phone numbers, session tokens and sensitive project
  data. Sample routine telemetry; avoid verbose solver output ingestion.
- Retain diagnostic artifacts deliberately; use reviewed lifecycle policies for
  disposable outputs. Do not auto-delete authoritative projects to save storage.
- Database stopping can save compute for eligible development usage, but storage
  remains billed and service auto-restart constraints apply. A stop is not a
  permanent billing off-switch.
- Keep private networking/production security decisions explicit: deferring them
  for an isolated development environment changes security, not just cost.

Budget alerts, lifecycle rules, infrastructure scaling and spend-based admission
controls are recommendations here, not already configured cloud controls.

## 7. Official sources

Pricing pages sometimes render regional rates dynamically. Where a retrieved
page does not expose a price, this document uses allowance descriptions or cost
formulas rather than inventing a unit rate.

- [Azure free-services catalogue](https://azure.microsoft.com/en-us/pricing/free-services/)
- [Azure Retail Prices API and currency/filter semantics](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Public retail meter endpoint](https://prices.azure.com/api/retail/prices?currencyCode=INR)
- [Azure free account and trial terms](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)
- [Visual Studio Enterprise offer MS-AZR-0063P](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0063p/)
- [Visual Studio monthly credit restrictions](https://azure.microsoft.com/en-us/pricing/member-offers/credit-for-visual-studio-subscribers/)
- [Container Apps billing and grant scope](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
- [PostgreSQL product/free-account offer](https://azure.microsoft.com/en-us/products/postgresql/)
- [PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/)
- [Azure SQL Database free offer and limitations](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer)
- [Azure SQL free-offer FAQ](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer-faq)
- [Container Registry pricing and Standard promotional offer](https://azure.microsoft.com/en-us/pricing/details/container-registry/)
- [Service Bus product/free offer](https://azure.microsoft.com/en-gb/products/service-bus/?nocdn=true)
- [Service Bus pricing](https://azure.microsoft.com/en-us/pricing/details/service-bus/)
- [Blob Storage pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
- [ACS SMS pricing, sender charges and credit exclusions](https://learn.microsoft.com/en-us/azure/communication-services/concepts/sms-pricing)
- [Key Vault pricing](https://azure.microsoft.com/en-us/pricing/details/key-vault/)
- [Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/)
- [Azure Monitor log-cost calculation](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs)
- [Bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/)
- [Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/)
- [Private DNS pricing](https://azure.microsoft.com/en-us/pricing/details/dns/)

Related: [architecture/resource inventory](ARCHITECTURE.md) and
[implemented platform boundaries](docs/python-react-platform.md).
