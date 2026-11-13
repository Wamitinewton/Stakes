# Sprint 6: Submit and buffer

| | |
|---|---|
| **Dates** | Sat Dec 20 – Mon Dec 22, 2026 |
| **Epic** | #63 |
| **Owner** | **Newton** |
| **Reviewer** | Ian: independent logged-out link check |
| **Load** | 1 pt |
| **Hard deadline** | **Mon 22 Dec 2026, 12:00 PT = 23:00 Nairobi** |

## Goal

Submitted on Devpost on 20 December, leaving two days of buffer before the deadline.

**Done when:** the submission is confirmed, the video is public, and the installation links have been verified from a logged-out browser.

## Story

| # | Story | Pts | Prio |
|---|---|---|---|
| 64 | Submit on Devpost and verify every public link | 1 | P0 |

### #64 Submit on Devpost and verify every public link

**Sat 20 Dec, morning (Newton):** submit the Devpost draft prepared in Sprint 5 (#61).
- Both team members listed on the Devpost project
- Category **Apps for Business Teams**; bonus **Best apps with Teamwork Graph integration**
- Video URL, repo URL, installation links, gallery images, built-with tags, technology requirement text

**Sat 20 Dec, afternoon (Newton, from a logged-out private window). Ian then repeats the check on a different machine, as the reviewer:**

| Link | Check | ✓ |
|---|---|---|
| YouTube video | Plays logged out; public (not unlisted); under 3:00; captions on | |
| GitHub repo | Public; README renders with images; `LICENSE` and `skill.md` present | |
| `stakes` installation link | Reaches the consent screen | |
| `stakes-bridge` installation link | Reaches the consent screen | |
| `skill.md` raw URL | Opens | |
| Devpost page | Shows the submission, video embed and gallery | |

Post both filled tables as comments on #64.

**Acceptance criteria**
- [ ] Submitted by December 20
- [ ] All links verified logged out

## Rules after submission

- **Only bug fixes.** No features, no scope changes (changing scope would invalidate the installation links and screenshots).
- Every fix goes through a PR reviewed by the other person, and is deployed to production only if both agree it's needed for judging.
- Don't move the `v1.0` tag. If a fix is deployed, tag it `v1.0.1` and note it in the Devpost "Updates" section if Devpost allows.
- Keep the demo sites and the HubSpot and Slack accounts alive until judging ends.

## Buffer plan (Dec 21–22)

| If… | Then… |
|---|---|
| A link breaks | Fix and re-verify, logged out |
| Devpost rejects a field | Edit and resubmit before the deadline (Devpost allows edits until the deadline) |
| A blocking bug is found | Fix on a `fix/` branch → PR → review → production deploy → re-run #59's fresh install |
| Nothing goes wrong | Rest. Write the retrospective on epic #63 |

## Sprint review

- [ ] #64 table complete
- [ ] Retrospective: what worked in the two-person split, what didn't (comment on #63)
- [ ] Epic #63 closed after the deadline passes
