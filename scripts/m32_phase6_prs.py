#!/usr/bin/env python3
"""M32 Phase 6 — close PRs #1 and #6 with explanatory notes.

Facts recorded in the note (all verified live):
  - canonical migration: old main -> main-archive (bit-for-bit), sanitized
    history promoted to main; head branches synchronized by fast-forward
  - GitHub rename API re-pointed base label to main-archive; retarget to
    main is rejected by GitHub (no commits between base and head)
  - head is identical to main (compare API: identical / 0 / 0)
  - PRs #4 and #7 were auto-marked merged by GitHub fast-forward detection
No credentials, no sensitive material in the note text.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = 'https://api.github.com/repos/jon0471-dot/Bean-intelligence'

NOTE_1 = """Closing as superseded by the M32 sanitized-branch synchronization (2026-11-22).

What happened:
- The old public `main` was preserved bit-for-bit as `main-archive` (91a6809), and the verified sanitized integration history (8f32b719 — containing all approved application work from this PR) was promoted to `main` as the default branch.
- The head branch `feat/m26-2-media-capabilities` was synchronized to that canonical tip by ordinary fast-forward push. The GitHub compare API now reports `main...feat/m26-2-media-capabilities` as `identical` (ahead_by 0, behind_by 0) — every commit in this PR is contained in `main` itself.
- During the branch rename step, GitHub's branch-rename API re-pointed this PR's base label from `main` to `main-archive`. Retargeting it back to `main` is rejected by GitHub ("There are no new commits between base branch 'main' and head branch") — which itself confirms the PR is empty relative to `main`.

No content is lost: all approved work in this PR is on `main`. This closure is a bookkeeping disposition of an empty PR, not a rejection of the work. Discussions are preserved.

The full verification record (compare results, ref SHAs, archive preservation) is in `docs/M32-EXECUTION-REPORT.md` on the new `main`, together with `scripts/m32_verify_state.py` for independent re-verification."""

NOTE_6 = """Closing as superseded by the M32 sanitized-branch synchronization (2026-11-22).

What happened:
- The old public `main` was preserved bit-for-bit as `main-archive` (91a6809), and the verified sanitized integration history (8f32b719 — containing all approved application work from this PR, including the PR #4 reconciliation commit e96d83a) was promoted to `main` as the default branch.
- The head branch `fix/laxii-image-output-ux` was synchronized to that canonical tip by ordinary fast-forward push. The GitHub compare API now reports `main...fix/laxii-image-output-ux` as `identical` (ahead_by 0, behind_by 0) — every commit in this PR is contained in `main` itself.
- During the branch rename step, GitHub's branch-rename API re-pointed this PR's base label from `main` to `main-archive`. Retargeting it back to `main` is rejected by GitHub ("There are no new commits between base branch 'main' and head branch") — which itself confirms the PR is empty relative to `main`.

No content is lost: all approved work in this PR is on `main`. This closure is a bookkeeping disposition of an empty PR, not a rejection of the work. Discussions are preserved.

The full verification record (compare results, ref SHAs, archive preservation) is in `docs/M32-EXECUTION-REPORT.md` on the new `main`, together with `scripts/m32_verify_state.py` for independent re-verification."""


def token():
    p = subprocess.run(['git', 'credential', 'fill'],
                       input=b'protocol=https\nhost=github.com\n\n',
                       capture_output=True)
    for line in p.stdout.decode().splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    return None


def api(path, tok, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f'{API}{path}', method=method, data=data,
                                 headers={'Authorization': f'token {tok}',
                                          'Accept': 'application/vnd.github+json',
                                          'User-Agent': 'm32-exec'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, (json.loads(e.read().decode() or '{}'))


def main():
    tok = token()
    plan = [(1, NOTE_1), (6, NOTE_6)]
    for n, note in plan:
        st, pr = api(f'/pulls/{n}', tok)
        if st != 200:
            print(f'PR #{n}: GET failed HTTP {st}')
            return 1
        if pr.get('state') == 'closed':
            print(f'PR #{n}: already closed ({pr.get("merged_at") or "not merged"})')
            continue
        st2, cm = api(f'/issues/{n}/comments', tok, method='POST', body={'body': note})
        if st2 != 201:
            print(f'PR #{n}: comment POST failed HTTP {st2}: {json.dumps(cm)[:200]}')
            return 1
        st3, cl = api(f'/pulls/{n}', tok, method='PATCH', body={'state': 'closed'})
        if st3 != 200 or cl.get('state') != 'closed':
            print(f'PR #{n}: close failed HTTP {st3}: {json.dumps(cl)[:200]}')
            return 1
        print(f'PR #{n}: comment posted (HTTP {st2}) and closed as superseded (HTTP {st3})')
    # final PR inventory
    st4, prs = api('/pulls?state=all&per_page=20&sort=updated&direction=desc', tok)
    if st4 == 200:
        rows = [(p['number'], p['state'], p.get('merged_at') or '-') for p in prs
                if p['number'] in (1, 2, 3, 4, 5, 6, 7)]
        print('PR inventory (1-7):', rows)
    return 0


if __name__ == '__main__':
    sys.exit(main())
