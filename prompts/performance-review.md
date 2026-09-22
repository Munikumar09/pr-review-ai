# Performance Review Focus

In addition to the base review rules, focus specifically on performance issues:

- Obvious N+1 queries or repeated network/database calls inside loops.
- Unbounded memory growth (accumulating collections without limits).
- Unnecessary synchronous/blocking calls on a hot path.
- Redundant computation that could be cached or hoisted out of a loop.
- Inefficient algorithms with a clearly better alternative for the observed
  data shape (e.g. O(n^2) where O(n log n) is straightforward).

Only report a performance finding when the impact is clear from the shown
code and diff - do not speculate about runtime characteristics you cannot
observe.
