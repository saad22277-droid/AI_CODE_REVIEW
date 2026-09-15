# Eval report (mode: live)

> Generated against the live gemini API.

| Case | Expected | Caught (TP) | Missed (FN) | False alarms (FP) |
|---|---|---|---|---|
| case-01-sql-injection | 1 | 1 | 0 | 0 |
| case-02-hardcoded-secret | 1 | 1 | 0 | 0 |
| case-03-null-deref | 1 | 1 | 0 | 0 |
| case-04-off-by-one | 1 | 1 | 0 | 0 |
| case-05-clean-code | 0 | 0 | 0 | 0 |

## Aggregate

- True positives: **4**
- False negatives (missed bugs): **0**
- False positives (false alarms): **0**
- Precision: **100%**
- Recall: **100%**
- F1: **100%**

## Per-case detail

### case-01-sql-injection
SQL query built via string concatenation of an unsanitized request param.

### case-02-hardcoded-secret
Live-looking Stripe secret key committed as a source literal.

### case-03-null-deref
Accesses user.profile.displayName with no check that profile exists.

### case-04-off-by-one
Loop uses `i <= end` instead of `i < end`, reading one index past the intended page.

### case-05-clean-code
Clean UI label constants. No real bug — includes the word 'password' as a harmless form-label string, deliberately, to test for false positives.