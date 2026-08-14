# Formal backend implementation plan

The new spreadsheet is prepared, but the public backend is not changed yet.

1. Create a separate Apps Script project bound to the new spreadsheet ID.
2. Implement the V2 transaction contract with `twbio` and `changying` company IDs.
3. Make `V2_開帳` the only opening-balance source; reject conflicting duplicate initialization.
4. Route records before `2026-08-12T17:00:00+08:00` to `V2_歷史待整理` with `historical_pending` and `includeInLedger=false`.
5. Add server-confirmed posting states for offline queue items.
6. Add month-close lock and correction relation (`originalId`, reason, new record id).
7. Run the integration model and browser workflow against a non-production copy.
8. Only after QA sign-off, deploy a release candidate and then switch the original public URL.

The existing old Apps Script remains untouched until the release candidate passes.
