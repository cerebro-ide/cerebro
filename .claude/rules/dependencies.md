---
paths:
  - "**/package.json"
  - "package-lock.json"
---

# Dependencies

- **Few, and mainstream:** Cerebro writes its own components (decision "Minimal dependencies").
  A new dependency needs a reason, given in the decision that adds it.
- **Only releases out for at least two weeks**, pinned to an exact version. When the latest is
  newer, take the one before and say so ("6.12.3 was out for under two weeks").
- **Install scripts are off unless allowed** in the root `package.json`'s `allowScripts`.
