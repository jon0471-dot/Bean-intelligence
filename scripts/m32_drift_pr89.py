#!/usr/bin/env python3
"""M32 post-publication drift handling — PRs #8 and #9.

Two open PRs appeared after the M32 migration completed (created 07:37:41Z /
07:38:16Z 2026-11-22 under the owner account, empty bodies):
  #8  head=main-archive  (old main 91a6809)  base=main (sanitized)
  #9  head=archive/feat-laxii-jazmii-restoration-pre-m32 (old LJ e7d7003) base=main

Both propose exactly what the migration forbids: importing old-lineage
history into sanitized main. They are NOT merged. They are closed with
explanatory notes; no ref is touched, nothing is deleted.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = 'https://api.github.com/repos/jon0471-dot/Bean-intelligence'

NOTE_8 = """Closing without merging — this PR is a side effect of the M32 branch migration, not proposed work.

What this PR is: the branch-comparison view opened against `main-archive`, which is the preserved **bit-for-bit copy of the pre-migration public `main` (`91a6809…`)** created during the 2026-11-22 sanitized migration. It exists purely as a historical archive.

Why it must not be merged: the migration contract explicitly requires that the old public history is **never merged into the sanitized `main`**. The diff shown here is the full old-lineage-vs-sanitized divergence — expected, and exactly why the archive exists as a separate ref. Merging would import that old lineage into the sanitized line.

Nothing is lost by closing: `main-archive` remains in place at its exact original SHA, undeleted and fully recoverable (commit API verified). All M32 verification records are on `main` (`docs/M32-EXECUTION-REPORT.md`, `scripts/m32_verify_state.py`). If this PR was opened intentionally as a long-term placeholder, it can be reopened — but leaving it open keeps an accidental-merge hazard against the sanitized default branch."""

NOTE_9 = """Closing without merging — this PR is a side effect of the M32 branch migration, not proposed work.

What this PR is: the branch-comparison view opened against `archive/feat-laxii-jazmii-restoration-pre-m32`, which is the safety backup of the original `feat/laxii-jazmii-restoration` tip (`e7d7003…`) created immediately before the authorized M32 realignment of that branch. It exists purely as a historical archive of the old LJ lineage.

Why it must not be merged: the migration contract requires that old-lineage history is **never merged into the sanitized `main`**. The old LJ tip has zero unique approved application content (M30/M31: tree identical to old main), and its history stays preserved on the archive ref.

Nothing is lost by closing: the archive branch remains in place at its exact original SHA, undeleted and fully recoverable (commit API verified). If this PR was opened intentionally as a long-term placeholder, it can be reopened — but leaving it open keeps an accidental-merge hazard against the sanitized default branch."""


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
                                          'User-Agent': 'm32-drift'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, (json.loads(e.read().decode() or '{}'))


def main():
    tok = token()
    for n, note in [(8, NOTE_8), (9, NOTE_9)]:
        st, pr = api(f'/pulls/{n}', tok)
        if st != 200:
            print(f'PR #{n}: GET HTTP {st}')
            return 1
        if pr.get('state') == 'closed':
            print(f'PR #{n}: already closed')
            continue
        if pr.get('merged_at'):
            print(f'PR #{n}: MERGED — do not touch, investigate')
            return 1
        st2, cm = api(f'/issues/{n}/comments', tok, method='POST', body={'body': note})
        if st2 != 201:
            print(f'PR #{n}: comment HTTP {st2}')
            return 1
        st3, cl = api(f'/pulls/{n}', tok, method='PATCH', body={'state': 'closed'})
        if st3 != 200 or cl.get('state') != 'closed':
            print(f'PR #{n}: close HTTP {st3}')
            return 1
        print(f'PR #{n}: explanatory comment posted, closed unmerged')
    st4, open_prs = api('/pulls?state=open', tok)
    print(f'open PRs now: {len(open_prs or [])}')
    # confirm archive refs untouched
    p = subprocess.run(['git', 'ls-remote', 'origin',
                        'refs/heads/main-archive',
                        'refs/heads/archive/feat-laxii-jazmii-restoration-pre-m32'],
                       capture_output=True)
    print('archive refs after closure:')
    print(p.stdout.decode().strip())
    return 0 if len(open_prs or []) == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
