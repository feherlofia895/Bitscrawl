# Gallery package compatibility

The compact challenge summary accepts both monthly challenge API contracts:
`submission_ends_at` is used when available, otherwise `voting_starts_at` is
the entry deadline. This UI package does not change monthly entry rules.

The historical `20260924113451_allow_editing_own_feed_posts.sql` migration
was applied to the existing production database under version `20260924113829`.
Its local filename is retained to preserve the existing working history.
The following `20260925204835_increase_daily_feed_limit_to_three.sql` migration
is already applied there and supersedes the publishing function with limit 3.
Do not blindly reapply these files or run migration repair against production;
reconcile the migration history explicitly before any future database rollout.
New isolated databases can apply the local migration sequence normally.

Verification: `npm run build`, `npm run lint`, `npm run test:gallery-controls`,
`npm run test:editor`, and `npm run test:weekly-drawing:local`.
The existing monthly tests depend on calendar time and may fail on the older
Git baseline during its voting window; they are not proof of a clean full suite.

The production frontend currently includes additional working-tree packages
that are being reviewed and committed separately. Deploying this intermediate
Git snapshot alone would remove those existing features. Production releases
must preserve them and record the actual build source until reconciliation ends.
