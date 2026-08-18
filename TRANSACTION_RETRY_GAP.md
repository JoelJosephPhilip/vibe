# Transaction retry gap in the database layer

Status: **fixed** — merged in [#17](https://github.com/JoelJosephPhilip/vibe/pull/17) (this fork). All 23 locations across `CourseRepository.ts`, `EnrollmentRepository.ts`, and `ProgressRepository.ts` now preserve the transient-error retry signal, via a shared `isTransientTransactionError()` helper. A 15-way concurrency stress test (`EnrollmentRepository.concurrentProgressUpdates.test.ts`) also surfaced and fixed a second issue: `BaseService._withTransaction` retried instantly with no backoff, so high-contention writers collided in lockstep — retries now use jittered exponential backoff, `MAX_RETRIES` 3→5. Verified via 3 consecutive clean CI runs of both the original failing test (`CrowdQuestion.e2e.test.ts`) and the new stress test. Not yet sent upstream to `vicharanashala/vibe`.



### Course/enrollment/progress actions can fail under normal concurrent usage, even though the platform already has a safety net that's supposed to prevent this

#### Impact

Students and instructors can occasionally see an action fail outright — creating a course version, enrolling in a course, saving quiz progress, bulk-updating enrollments — even when nothing was actually wrong with what they did. The failure is caused purely by timing: two operations touching the database at nearly the same moment. This gets **more likely, not less, as the platform grows** — it's the kind of issue that's rare with a handful of test users and increasingly common during real usage spikes, like everyone submitting near a deadline.

The frustrating part: **the platform already has code specifically designed to prevent exactly this.** When two database writes collide, the system is supposed to silently retry a moment later so the user never notices. That retry logic exists and is written correctly — but a separate bug elsewhere in the code accidentally throws away the signal that tells the retry logic "this is worth retrying." So the safety net is present, engineered, and tested — it's just disconnected in most of the places that need it.

#### Why this is worth fixing now rather than later

- **It gets worse with success.** The more the platform is adopted and the more concurrent users it has, the more often this fires. Fixing it now is cheap; fixing it after it's a recurring support complaint from real instructors and students is expensive in trust, not just engineering time.
- **The fix is already half-built — twice over.** The retry mechanism (`BaseService._withTransaction`) exists and works correctly. A previous contributor even already built the correct fix pattern (a helper called `isTransientTransactionError`) and applied it in several places in one file. It just wasn't applied everywhere it's needed. This isn't a "design something new" problem, it's a "finish applying a fix that's already proven to work" problem.
- **It's invisible until it isn't.** Nothing about this shows up in normal manual testing — it only appears under real concurrent load, which means it's exactly the kind of bug that looks fine in a demo and then surfaces as "random" failures once real users are on the platform.
- **It affects core workflows**, not an edge feature — course creation, enrollment, and progress tracking are among the most fundamental things the platform does.

#### Where the barrier is

When the database briefly can't complete an action due to a timing collision, the underlying database driver flags that specific error as "safe to retry" (an `errorLabels` array containing `TransientTransactionError`). Before that flag ever reaches the retry logic in `BaseService._withTransaction`, most repository methods catch the original error and repackage it into a simpler, generic `InternalServerError` (or plain `Error`) — and in doing so, drop the "safe to retry" flag along the way. The retry logic checks for that flag; without it, it assumes the failure is permanent and gives up immediately instead of trying again.

#### Scope of the fix

Confirmed present in the main project (`vicharanashala/vibe`, verified directly against `upstream/main`, not fork-specific), entirely within the backend's database layer — no controller, frontend, or business-logic changes required.

**Course operations** — course version creation, module/section/item management within a course, and related structural updates. This is the area already confirmed to cause a real, reproducible test failure (`CrowdQuestion.e2e.test.ts`), so it's the highest-confidence starting point. Also the file where the correct fix pattern already exists and is proven — most of the remaining work here is applying the *same* pattern to the methods that don't have it yet, not inventing anything new.

**Enrollment operations** — enrolling a student, updating enrollment progress, updating completed-item counts, bulk-updating multiple enrollments at once, and creating progress-tracking records at enrollment time. None of this file currently has the fix pattern at all. Bulk operations are worth calling out specifically: they touch many records in one transaction, which statistically makes them more likely to collide with something else writing to the same data at the same time — this is plausibly the highest-impact area even though it wasn't the one caught by the existing test suite.

**Progress-tracking operations** — recording a student's progress through course content. Smallest surface area, one location.

Each location follows the same broken shape and the same fix: preserve the database driver's original "safe to retry" signal when the error gets repackaged, instead of discarding it. No behavioral change for the success path, no changes to API responses, no new dependencies. The only observable difference is that a collision now gets quietly retried instead of surfacing as a failure.

#### Plan of action

1. **Audit** — done (see "Exact changes required" below for the verified, line-by-line list).
2. **Extract the shared helper** — `isTransientTransactionError()` currently lives as an unexported function local to `CourseRepository.ts`. Since `EnrollmentRepository.ts` and `ProgressRepository.ts` need the identical check, move it to a shared location (e.g. `backend/src/shared/...`) and import it in all three files, rather than duplicating the function three times.
3. **Apply the fix consistently** — same shape everywhere: check `isTransientTransactionError(error)` before wrapping, and if true, `throw error` unwrapped so `_withTransaction` can see the retry signal. Each fix is independent and low-risk.
4. **Verify against the known failing case** — re-run the existing test suite (including `CrowdQuestion.e2e.test.ts`) multiple times in a row, since the bug is timing-dependent and won't reproduce on every single run. A pass on the first try isn't sufficient proof; several consecutive clean runs is a better signal.
5. **Stress-check beyond the one known case** — since only one location was caught by the current tests, spot-check a couple of the enrollment/bulk-update paths manually (e.g., trigger concurrent requests against the same record) to confirm retries actually fire there too.
6. **Submit as a reviewable change** — one focused pull request covering all locations (the diff is repetitive and mechanical, easy to review quickly), with this report or a summary of it as the description so reviewers understand the "why," not just the "what."
7. **Validate, then propagate** — land it upstream, confirm it holds up, then make sure the fork stays in sync (already automated via the daily sync workflow).

**Estimated effort**: roughly half a day to a day of focused work — the audit and verification steps take longer than writing the fixes themselves, since each fix is a small, repetitive change.

---

## Draft GitHub issue

Title: `fix: transaction retry silently defeated across most repository methods`

```markdown
## Observed behaviour

`BaseService._withTransaction` retries a transaction up to 3 times when MongoDB
reports a transient error (`errorLabels` containing `TransientTransactionError`)
- e.g. a write conflict between two operations touching the same document at
nearly the same moment. This is expected and normal under concurrent load.

The retry only works if that error reaches `_withTransaction`'s catch block
with its `errorLabels` intact. In most repository methods, the original
MongoDB error is caught and rewrapped into a generic `InternalServerError`
(or plain `Error`) before it gets there - which discards `errorLabels` in
the process. The retry logic then sees a plain error with no labels, assumes
it's permanent, and gives up on the first attempt instead of retrying.

`CourseRepository.ts` already has the correct fix for this
(`isTransientTransactionError()` + `throw error` unwrapped) applied in
several methods - but not all of them, and `EnrollmentRepository.ts` /
`ProgressRepository.ts` don't have it at all.

## Reproduction

`src/modules/quizzes/tests/CrowdQuestion.e2e.test.ts` intermittently fails
with:

    MongoServerError: Caused by :: Unable to write to collection
    '...newCourseVersion' due to snapshot timestamp ... being older than
    collection minimum ...; please retry the operation

via `CourseRepository.createVersion`, which did not have the
`isTransientTransactionError` check. This is a real MongoDB transient error
that should have been retried automatically and wasn't.

## Affected paths

- `backend/src/shared/database/providers/mongo/repositories/CourseRepository.ts`
- `backend/src/shared/database/providers/mongo/repositories/EnrollmentRepository.ts`
- `backend/src/shared/database/providers/mongo/repositories/ProgressRepository.ts`
- `backend/src/shared/classes/BaseService.ts` (retry logic itself - correct, unchanged)

## Suggested fix

Extract `isTransientTransactionError()` out of `CourseRepository.ts` into a
shared location, import it in all three repositories, and apply the same
`if (isTransientTransactionError(error)) throw error;` guard to every
`catch` block currently missing it (full list in the tracking doc /
linked PR). No behavioural change on the success path or for genuine
(non-transient) errors.

Closes #<issue-number-if-any>
```

---

## Exact changes required

Verified by direct read of each file (not estimated). "Needs fix" = catches the
original error and constructs a brand-new `InternalServerError`/`Error` without
checking `isTransientTransactionError` first, so the retry signal is lost.
"Already fixed" = already has the check and rethrows unwrapped.

### `backend/src/shared/database/providers/mongo/repositories/CourseRepository.ts`

Helper `isTransientTransactionError()` is defined here (line 58, **not exported**).

**Already fixed** (has the check, no action needed): lines `772`, `842`, `1033`, `1079`, `1086`, `1196`

**Exploratory fix already applied this session** (line ~491, `createVersion`): currently uses a different approach (manually copies `error.errorLabels` onto the new `InternalServerError` instead of using `isTransientTransactionError` + rethrow). Works, but doesn't match the established convention used everywhere else in this file. **Should be redone to match the standard pattern** when this is picked up, for consistency.

**Needs fix** (12 locations):
| Line | Method / purpose |
|---|---|
| 517 | Add module to course version |
| 555 | Read course version |
| 962 | Delete course version |
| 1258 | Fetch courses |
| 1276 | Bulk update course versions |
| 1300 | Add new course version |
| 1418 | Cascade delete versions |
| 1448 | Update course version |
| 1485 | Create cohort settings |
| 1509 | Get cohort setting by ID |
| 1535 | Get cohort setting |
| 1563 | Update cohort settings |

### `backend/src/shared/database/providers/mongo/repositories/EnrollmentRepository.ts`

Does not import or use `isTransientTransactionError` at all currently.

**Already fine as-is** (rethrows original error or returns a fallback, no rewrapping): lines `107`, `3000`, `3059`, `3171`, `3388`

**Needs fix** (9 locations):
| Line | Method / purpose |
|---|---|
| 315 | Update progress in enrollment |
| 334 | Update completed items count in enrollment |
| 367 | Create enrollment |
| 537 | Create progress tracking |
| 751 | Get enrollments |
| 2501 | Bulk update enrollments |
| 3777 | Get enrollments for course version (throws plain `Error`, same underlying bug) |
| 3811 | Get student enrollments for course version (throws plain `Error`) |
| 3891 | Delete enrollments for course version (throws plain `Error`) |

### `backend/src/shared/database/providers/mongo/repositories/ProgressRepository.ts`

**Needs fix** (1 location):
| Line | Method / purpose |
|---|---|
| 475 | Delete quiz attempts |

### Also required

- Move `isTransientTransactionError()` out of `CourseRepository.ts` into a shared module (e.g. `backend/src/shared/database/...` or `backend/src/shared/functions/...`, matching whatever convention the codebase uses for small shared helpers - see `verifyRecaptcha` in `backend/src/shared/functions/` for a precedent) and export it, so all three repositories can import the same implementation instead of duplicating it.
- No changes needed to `BaseService.ts` - its retry logic is already correct.

## Total

**22 locations still need the fix**, 1 already patched (needs realignment to the standard pattern), 6 already correct. Line numbers above are from the codebase as of this session (2026-08-18) - re-verify before starting work in case the files have moved on.
