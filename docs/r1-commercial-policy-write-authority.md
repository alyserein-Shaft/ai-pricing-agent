# R1 Commercial Policy Write Authority — Decision Record (F-3)

Status: **accepted for R1.** Resolves the open question of who may write a scenario's
commercial policy in the single-user release.

## Decision

For **R1 (single user, single organization)**, a commercial policy may be configured by
an **authenticated authorized owner** of the project. Concretely:

1. The caller must have passed the R1 access boundary (server-verified session cookie
   or bearer credential). An anonymous caller is refused at the router before any
   handler runs (`worker/r1-access.mjs`, `enforceR1Access`).
2. The caller must be authorized for the project by the existing durable project
   authority (`worker/project-authority.mjs`, `resolveProjectAuthority`), which reads
   only the server-resolved actor — never request headers.
3. The write is recorded in the pricing audit trail with `actor_user_id`, `actor_role`,
   a governed `reason`, and the previous and new settings, so the actor is always
   attributable after the fact.

## What this explicitly does NOT claim

- It does **not** claim segregation of duties. The same authenticated operator who
  configures the policy can also calculate, approve the price, approve the quotation
  and issue it. There is no independent commercial approver in R1, and the system does
  not pretend otherwise.
- It does **not** create a second human role. Inventing a "policy writer" role for a
  one-person deployment would add authority machinery with no security value and would
  risk locking the only legitimate operator out of the single supported way to satisfy
  the `COMMERCIAL_POLICY_NOT_CONFIGURED` guard.
- It does **not** weaken the `COMMERCIAL_APPROVAL_ROLES` gate that governs *approving a
  price*. That gate is unchanged and still applies to commercial approval.

## Why not gate the write on `COMMERCIAL_APPROVAL_ROLES`

The commercial-policy write is a prerequisite for pricing, not a commercial approval.
Requiring commercial-approval authority to *set* the policy would mean the operator who
holds no approval role can never configure a policy and therefore can never price
anything — an R1 dead end. Gating the write on a role the single R1 operator does not
hold would have made the R1 commercial journey unreachable.

## Residual risk and R2

In R1 the audit trail is the control that substitutes for separation: every policy
change is attributed and reasoned. That is a weaker guarantee than independent
approval, and it is recorded here as a known R1 limitation rather than being
papered over.

R2 should introduce real separation — independent policy author versus commercial
approver, backed by multiple identities — when a multi-user product is authorized. The
`actor_user_id` / `actor_role` columns already written by this path are the audit
substrate that such a policy would build on.

## Evidence

- `tests/r1-access.test.mjs` — anonymous, spoofed-header and arbitrary-authorization
  callers are refused on the commercial-policy route.
- `tests/commercial-policy-persistence.test.mjs` — the write records actor, role and
  reason; cross-project writes are 404; blank or incomplete policies are 422 and never
  written.
- `tests/project-authority-enforcement.test.mjs` — project authority is derived from
  durable membership/ownership only, and a membership miss fails closed.
