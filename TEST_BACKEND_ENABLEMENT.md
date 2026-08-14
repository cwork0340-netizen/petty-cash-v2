# V2 Test Backend Enablement Checklist

This checklist applies only to the separate V2 test project. It must never be used with the official petty-cash PWA, its Apps Script project, or its spreadsheet.

## Required before enabling the V2 test API

1. In the separate Apps Script project, authorize only the test project and run `initializeTestDatabase` once.
2. In the cwork-owned test Apps Script project, replace `V2_TEST_SPREADSHEET_ID` with the newly created isolated test Sheet ID. Confirm the only created tabs are `cash_transactions`, `cash_counts`, and `audit_log`.
3. Add a randomly generated value under Script Properties as `V2_TEST_API_KEY`. It must not be stored in source code, the client, or a spreadsheet cell.
4. Deploy the separate Apps Script project as a web app, then set its URL only in the Vercel test project's `V2_TEST_GAS_URL` environment variable.
5. Set the same secret only in the Vercel test project's `V2_TEST_GAS_KEY` environment variable.
6. Verify that `/api/test-gas` returns `test_backend_not_configured` before the two Vercel settings exist, and that a direct Apps Script request without the key returns `unauthorized_test_request` after deployment.

## Required end-to-end evidence

- Read `getHomeData`, `getRecords`, and `getAudit` for each test company.
- Submit each of the ten cases in `TEST_GATE.md` against the test backend.
- Repeat one submitted request using the same `requestId`; it must return the same result without creating a duplicate transaction.
- Verify an inventory count changes no ledger amount and a returned-cash amount does not create an income transaction.
- Record three save timings each for advance, settlement, direct expense, and count. Any P0/P1 issue blocks user review.

## Stop conditions

- A URL, spreadsheet, or Apps Script project is not explicitly identified as the separate V2 test resource.
- A request can access the backend without the test key.
- Any action can point at the official spreadsheet or official web app.

If any stop condition occurs, do not continue the test and do not deploy to the official URL.
