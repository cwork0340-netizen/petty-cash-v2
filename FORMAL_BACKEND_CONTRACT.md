# Formal backend integration contract

The production backend must satisfy this contract before the public URL is changed.

## Opening boundary

- Cutover date: `2026-08-12`
- Cutover time: `17:00 Asia/Taipei`
- `twbio` / 全瑩 opening cash: `15943`
- `changying` / 長瑩 opening cash: `2071`
- The opening row is a typed `opening_balance` event, not income, replenishment, expense, or adjustment.
- Opening initialization is idempotent by `(cutoverDate, companyId)` and rejects a second conflicting amount.

## Company isolation

Every read and write must require a company identifier and use company-specific V2 sheets or a company column. A request for 全瑩 must never read or write 長瑩 rows.

## Historical boundary

Legacy tabs remain read-only. Legacy transactions are not replayed into the new ledger. Unresolved legacy items are linked in a migration register and do not change the opening cash twice.

Transactions not registered before cutover are historical-pending items only. They must not enter the new cash ledger. New-ledger writes begin at the cutover timestamp.

## Cash rules

- A same-record settlement updates the originating advance.
- `actualExpense + returnedCash = advance.amount` is required for a clean settlement.
- Returned cash is never income.
- A count stores ledger cash, actual cash, and difference; it never changes ledger cash.
- A difference requires a reason and remains visible until resolved.

## Deployment gate

The deployment is blocked until the production endpoint returns both companies with the two approved opening balances, and the following tests pass against a non-production copy of the formal workbook:

1. opening initialization and duplicate rejection;
2. company isolation;
3. same-record settlement;
4. count without ledger rewrite;
5. receipt pending after cash settlement;
6. one-click/idempotent save;
7. rollback to the old URL.

## Reliability and close controls

- The current role is `零用金管理者`.
- Offline entries may be queued as `pending_sync`, but are not posted until server confirmation.
- Retry uses the same request id and must be idempotent.
- Month-closed records are immutable. Corrections are new records referencing the original id and a required reason.
