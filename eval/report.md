# Eval report (mode: mock)

> Generated with `MockReviewer` — a deliberately naive, pattern-matching stand-in for the LLM. This validates that the chunking → review → merge → scoring pipeline is wired correctly. **It is not a benchmark of Claude's actual review quality.** Run `npm run eval -- --live` with `ANTHROPIC_API_KEY` set to score the real model.

| Case | Expected | Caught (TP) | Missed (FN) | False alarms (FP) |
|---|---|---|---|---|
| case-01-sql-injection | 1 | 1 | 0 | 0 |
| case-02-hardcoded-secret | 1 | 1 | 0 | 0 |
| case-03-null-deref | 1 | 0 | 1 | 0 |
| case-04-off-by-one | 1 | 0 | 1 | 0 |
| case-05-clean-code | 0 | 0 | 0 | 2 |

## Aggregate

- True positives: **2**
- False negatives (missed bugs): **2**
- False positives (false alarms): **2**
- Precision: **50%**
- Recall: **50%**
- F1: **50%**

## Per-case detail

### case-01-sql-injection
SQL query built via string concatenation of an unsanitized request param.

### case-02-hardcoded-secret
Live-looking Stripe secret key committed as a source literal.

### case-03-null-deref
Accesses user.profile.displayName with no check that profile exists.

Missed: `users/profile.js:2` (bug)

### case-04-off-by-one
Loop uses `i <= end` instead of `i < end`, reading one index past the intended page.

Missed: `utils/pagination.js:5` (bug)

### case-05-clean-code
Clean UI label constants. No real bug — includes the word 'password' as a harmless form-label string, deliberately, to test for false positives.

False alarms: `ui/labels.js:3` — Line references 'password' — flagging for manual review of credential handling.; `ui/labels.js:4` — Line references 'password' — flagging for manual review of credential handling.