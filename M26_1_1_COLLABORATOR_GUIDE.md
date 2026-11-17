# M26.1.1 COLLABORATOR GUIDE — Recovering After the History Rewrite

Audience: anyone with a clone, fork, mirror or CI workspace of
`jon0471-dot/Bean-intelligence` (GitHub). Published by the repository
owner when the rewritten history goes live (see
`M26_1_1_RESULTS.md` §8 for the publication runbook).

**What happened:** all Git history before the rewrite date was rewritten
with `git-filter-repo` to permanently remove 42 sensitive paths (37
session-token jars, 3 `login.json` captures, 2 SQLite snapshot paths that
hosted 8 database snapshots — 170 exposed session-token identities, 100
user records and 2 disposable test-credential ciphertexts in total). Every
commit SHA from before the rewrite changed. The old history still exists
in: clones made before the rewrite, forks, mirrors, CI caches and
GitHub-side cached views. Those copies must be refreshed or purged.

**Golden rules**

1. Never `git push --force` (or any push) from a clone made before the
   rewrite — it can republish the removed secret-bearing history. If you
   must push after re-basing your work, use
   `git push --force-with-lease=refs/heads/<branch>:<expected-remote-sha>`.
2. Never run `git clean -fdx` as a reflex. It deletes ALL untracked and
   ignored files — local databases, `.env`, build outputs, downloaded
   models, evidence artifacts. This guide never uses it as a default;
   where cleaning is truly needed it is scoped and listed file-by-file.
3. Assume every pre-rewrite commit SHA you have memorized or bookmarked
   is dead. Old hashes may 404 on github.com (that is expected and good).

---

## 1. If you have NO local work: fresh clone (recommended)

```bash
mv Bean-intelligence Bean-intelligence.old-$(date +%Y%m%d)   # keep for now, do NOT push from it
git clone https://github.com/jon0471-dot/Bean-intelligence.git
cd Bean-intelligence
bun install && bun run test          # 2,188 pass expected
```

After you have confirmed nothing else is needed from the old copy, archive
or delete `Bean-intelligence.old-*` locally (it contains the removed
history; never push it, never share it).

## 2. If you have local work: migrate it, do not merge histories

```bash
# 0. from your OLD clone: put every uncommitted change and local branch somewhere safe
git stash list                       # note stashes
git stash push -u -m "pre-rewrite-migration"   # -u includes untracked files (NOT ignored files)
git bundle create ../my-local-work.bundle --branches --tags   # snapshot ALL local branches
git bundle verify ../my-local-work.bundle

# 1. fresh clone (step 1 above)

# 2. rebuild your work ON TOP of the new history
git fetch ../my-local-work.bundle 'refs/heads/*:refs/old-work/*'   # or clone the bundle to a scratch dir
git checkout main                     # new history
git checkout -b my-feature            # your branch, based on NEW main
git checkout my-feature -- <paths>    # cherry-pick FILES you need from refs/old-work/<branch>
#   ...or, for whole commits:
git cherry-pick <old-sha>             # works if the commit touched no removed path;
                                      # conflicts are expected where the rewrite changed SHAs
```

Alternatives that also work: `git format-patch` from the old clone and
`git am` onto the new one; or export a diff of your uncommitted work
(`git diff > ../my.patch`) and re-apply it. Do NOT `git pull` / `git
merge old-main` — the histories share no ancestry any more and a merge
would resurface the removed objects.

## 3. Open pull requests

At rewrite-preparation time the repository had no open PRs and no PR refs
advertised (`git ls-remote` checked). If you had a PR branch elsewhere:

```bash
# recreate the branch from the rewritten main, then re-apply your changes
git checkout -b <pr-branch> origin/main
git checkout <pr-branch> -- <your files>        # or cherry-pick / format-patch (step 2)
git push -u origin <pr-branch>                  # normal push of a NEW branch, no lease needed
# then open a fresh PR; the old PR (if any) cannot be rebased onto rewritten history
```

Re-run all gates on the new PR — every pre-rewrite CI result is tied to
dead SHAs.

## 4. CI (GitHub-hosted and self-hosted)

- GitHub-hosted runners: start from a clean VM every run — nothing to do.
- Any cache that persists `.git` between runs (actions/cache, third-party
  caches): **invalidate/purge every cache key** that contains repository
  objects; the next run re-populates from the rewritten history.
- Self-hosted runners: purge persisted workspaces, not with
  `git clean -fdx`, but by removing the runner's checkout directory
  entirely and letting the runner re-clone:
  ```bash
  systemctl stop <runner-service>            # or your runner's stop mechanism
  rm -rf /path/to/runner/_work/<repo>        # the runner re-creates it; check your runner docs first
  systemctl start <runner-service>
  ```
  Also clear runner-level dependency caches if they key on commit SHAs.
- Deploy keys / webhooks: no change needed for a history rewrite; if the
  platform reports stale refs, delete and re-add them.
- The repository currently has NO GitHub Actions workflows (verified
  pre-rewrite) — CI exposure is limited to external/self-hosted systems.

## 5. Forks

At preflight the repo had **0 forks**. Re-check after publication
(GitHub → Insights → Forks, or the fork-network page). Any fork that
exists retains the FULL old history (forks are not rewritten by the
parent's rewrite). Options, in order of preference:

1. Ask the fork owner to delete the fork and re-fork after the rewrite
   (cleanest, and the old objects leave the fork network).
2. Contact GitHub Support to purge the fork network of the unreachable
   objects — GitHub can run GC across the network on request.
3. If the fork holds valuable independent work, that work must be
   migrated exactly like step 2 above, then the fork deleted and
   re-forked.

## 6. Mirrors

Any mirror (push-mirror, backup, internal GitLab/Gitea import) still
holds the old objects. Delete and re-clone/re-mirror from the rewritten
repository. Schedule a one-time re-sync instead of incremental mirroring,
because the histories share no ancestry.

## 7. Verifying your copy is clean

```bash
git fetch origin
git rev-parse origin/main                       # must equal the post-rewrite tip (see RESULTS §8 step 6)
git rev-list --objects --all \
  | grep -E "cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt"
# expect: NO output
```

Optionally re-run the repo's own scanners:
`bun run scripts/m261/secret-scan.ts` (0 `bean_session` hits) and
`bun run scripts/m261/db-census.ts` (0 DB blobs).

## 8. Report cards for the notification message

Short form to send to collaborators/consumers:

> Repository history was rewritten on <publication date> to remove leaked
> credentials. Clones made before that date are obsolete and MUST NOT be
> pushed from. Fresh-clone via `git clone <repo-url>`; migrate local work
> per M26_1_1_COLLABORATOR_GUIDE.md §2; never use bare `git push --force`;
> invalidate CI caches that persist `.git`; forks/mirrors must be deleted
> and re-created.

## 9. What NOT to worry about

- Your issue trackers, releases metadata, branch-protection settings and
  repository settings are unaffected.
- Tags: none exist, so none needed rewriting.
- The M26.1 documents in the repo (`M26_1_RESULTS.md`,
  `M26_1_OWNER_ACTIONS.md`, `docs/M26_1_QUARANTINE_INVENTORY.md`) contain
  no secret values by construction and survive the rewrite (new SHAs,
  same content).
