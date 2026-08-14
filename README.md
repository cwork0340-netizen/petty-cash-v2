# Formal cutover — 2026-08-12

This package defines the safe opening boundary for the production migration.

- 全瑩 opens at **NT$15,943**.
- 長瑩 opens at **NT$2,071**.
- Cutover starts at **2026-08-12 17:00 Asia/Taipei**.
- These are opening cash balances from the physical count, not income, replenishment, or an adjustment.
- Historical transactions remain read-only and are not replayed into the new ledger.
- Historical unresolved items are carried as separate follow-up items so they cannot change the opening cash twice.
- Returned cash is applied only to its originating advance and is never classified as income.
- Transactions not registered before cutover remain historical-pending and do not enter the new ledger.
- The current operating role is **零用金管理者**.
- Offline entries remain **待同步** until server confirmation; retries reuse the same request id.
- Closed records are immutable; corrections are new records linked to the original with a required reason.

The production backend must refuse to start the new ledger unless this file's cutover date and company balances match the approved physical count record.
