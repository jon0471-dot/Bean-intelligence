#!/usr/bin/env python3
"""M32 — post-synchronization verification (read-only, returncode-aware).

Proves the completed M32 migration on live GitHub:
  1. Lineage: the published tip is the verified sanitized line — contains
     CANONICAL_SHA (8f32b719), PR#4 reconciliation e96d83a, M26.2 (8f61599)
     and M26.3 (18c93ed) tips; old main lineage excluded; M32 report commit
     touched ONLY docs/ + scripts/.
  2. App-tree purity: src/prisma/package.json/next.config.ts byte-identical
     to the M31-verified app tree (d2c232a6fa2).
  3. Remote refs (server-side ls-remote): main == the three feature branches
     == this line's tip; main-archive == old main 91a6809 bit-for-bit;
     archive/feat-laxii-jazmii-restoration-pre-m32 == e7d7003; HEAD == tip.
  4. GitHub API: default_branch == main; old main + old LJ commits reachable
     through their archive refs; archive branch object == LJ old SHA.
  5. Compare API x3: status identical, ahead_by 0, behind_by 0.
  6. Manifest: G1-G7 225/225 present at tip; G8/G9/G10 89/89 absent.
  7. PRs #1-#7 all closed; #4 and #7 merged (fast-forward detection).
  8. LJ preservation: old LJ tree identical to old main tree.
  9. Universe arithmetic closes (S + O-S == all).
Writes evidence JSON to recovery/m32-audit/m32-verify.json (local, not
committed). No ref is created, moved, or deleted; no remote mutation.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

REPO = '/home/z/my-project'
API = 'https://api.github.com/repos/jon0471-dot/Bean-intelligence'
TIP_REF = 'refs/heads/reconcile/sanitized-m27-m28-migration'
OLD_MAIN = '91a68090ef72f71f52797bd88f9b83831fbeb997'
LJ_OLD = 'e7d7003f36896b3ceaf07cde74d36275989469c1'
M262 = '8f61599271b1aa66e86a2c4956f6dc01eef8b737'
M263 = '18c93ed7b1e433bb1c06c0a803d5adff0dcaf064'
PR4 = 'e96d83a5196f45712350aaf41d13a1e5dfcebae7'
CANONICAL = '8f32b7198d042df0211a8f88be8f78e9b897a229'
D2C = 'd2c232a6fa225644e91e967d2148558ba67b9679'
MERGE_BASE_ROOT = 'cafdb6826da9c4edcd62e2ead15d801869ae9c3a'
ARCHIVE_LJ_REF = 'archive/feat-laxii-jazmii-restoration-pre-m32'
FEATURES = ['feat/laxii-jazmii-restoration', 'feat/m26-2-media-capabilities',
            'fix/laxii-image-output-ux']
OLD_REFS = [
    OLD_MAIN, LJ_OLD, 'refs/heads/feat/m28-audio-reliability-quality',
    'refs/heads/feat/gangzii-audio-production', 'refs/heads/feat/jazmii-auto-director',
    'refs/heads/feat/trust-specialist-coverage', 'refs/heads/feat/feb2027-trust-engine',
    'refs/heads/m25-intel-lanes', 'refs/heads/m26-audit', 'refs/heads/m26-release',
    'refs/heads/m261-security-closure', 'refs/heads/main',
    'refs/heads/backup/feb2027-presplit-main', 'refs/heads/backup/laxii-pre-restoration',
    'refs/heads/backup/m22-wip-auto-commit', 'refs/heads/backup/m25-intel-wip-auto-commit',
    'refs/heads/backup/m25-wip-auto-commit', 'refs/heads/backup/m26-baseline-auto-commit',
    'refs/heads/backup/m26-f0b47ad-line', 'refs/heads/backup/m261-local-main-pre-sync',
    'refs/heads/backup/pre-phase0-81caaa3', 'refs/heads/backup/pre-phase1-auto-commit',
    'refs/backup/scratch-bf47b8c',
    'refs/remotes/origin/main-archive',
    'refs/remotes/origin/' + ARCHIVE_LJ_REF,
]
EVIDENCE = {}


def git(*args):
    p = subprocess.run(['git', '-C', REPO, *args], capture_output=True)
    return p.returncode, p.stdout.decode().strip(), p.stderr.decode().strip()


def out(*args, check=True):
    rc, o, e = git(*args)
    if check and rc != 0:
        raise RuntimeError(f"git {' '.join(args)} -> rc={rc}: {e[:300]}")
    return o


def token():
    p = subprocess.run(['git', 'credential', 'fill'],
                       input=b'protocol=https\nhost=github.com\n\n',
                       capture_output=True)
    for line in p.stdout.decode().splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    return None


def api(path, tok):
    req = urllib.request.Request(f'{API}{path}',
                                 headers={'Authorization': f'token {tok}',
                                          'Accept': 'application/vnd.github+json',
                                          'User-Agent': 'm32-verify'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, (json.loads(e.read().decode() or '{}'))


def ok(label, cond, bucket):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
    bucket.append(bool(cond))
    return cond


def main():
    tok = token()
    if not tok:
        print('FATAL: no token from credential store')
        return 2
    all_pass = []
    tip = out('rev-parse', TIP_REF)
    print(f'== TIP ==\n  {TIP_REF} = {tip}  ({out("rev-list", "--count", tip)} commits)')
    EVIDENCE['tip'] = tip

    print('\n== 1. LINEAGE ==')
    ok('tip contains CANONICAL_SHA 8f32b719', git('merge-base', '--is-ancestor', CANONICAL, tip)[0] == 0, all_pass)
    ok('tip contains PR#4 reconciliation e96d83a', git('merge-base', '--is-ancestor', PR4, tip)[0] == 0, all_pass)
    ok('tip contains M26.2 tip 8f61599', git('merge-base', '--is-ancestor', M262, tip)[0] == 0, all_pass)
    ok('tip contains M26.3 tip 18c93ed', git('merge-base', '--is-ancestor', M263, tip)[0] == 0, all_pass)
    ok('old main NOT ancestor of tip (lineage guard)', git('merge-base', '--is-ancestor', OLD_MAIN, tip)[0] != 0, all_pass)
    ok('merge-base(tip, old main) == 19-commit shared root', out('merge-base', tip, OLD_MAIN) == MERGE_BASE_ROOT, all_pass)
    pA = subprocess.run(['git', '-C', REPO, 'diff', '--stat', CANONICAL, tip,
                         '--', ':!docs', ':!scripts'], capture_output=True)
    ok('M32 report commit touched ONLY docs/ + scripts/ (diff else empty)',
       pA.returncode == 0 and pA.stdout.decode().strip() == '', all_pass)

    print('\n== 2. APP-TREE PURITY ==')
    pC = subprocess.run(['git', '-C', REPO, 'diff', '--quiet', D2C, tip,
                         '--', 'src', 'prisma', 'package.json', 'next.config.ts'],
                        capture_output=True)
    ok('src/ prisma/ package.json next.config.ts byte-identical to M31-verified tree',
       pC.returncode == 0, all_pass)

    print('\n== 3. REMOTE REFS (server-side ls-remote) ==')
    remote = {}
    for line in out('ls-remote', 'origin').splitlines():
        sha, ref = line.split()
        remote[ref] = sha
    EVIDENCE['remote'] = remote
    for b in FEATURES:
        ok(f'refs/heads/{b} == tip', remote.get(f'refs/heads/{b}') == tip, all_pass)
    ok('refs/heads/main == tip', remote.get('refs/heads/main') == tip, all_pass)
    ok('refs/heads/main-archive == old main 91a6809 (bit-for-bit)',
       remote.get('refs/heads/main-archive') == OLD_MAIN, all_pass)
    ok(f'refs/heads/{ARCHIVE_LJ_REF} == old LJ e7d7003',
       remote.get(f'refs/heads/{ARCHIVE_LJ_REF}') == LJ_OLD, all_pass)
    ok('remote HEAD == tip', remote.get('HEAD') == tip, all_pass)

    print('\n== 4. GITHUB API ==')
    st, repo = api('', tok)
    ok('default_branch == main', (repo or {}).get('default_branch') == 'main', all_pass)
    EVIDENCE['default_branch'] = (repo or {}).get('default_branch')
    st2, _ = api(f'/commits/{OLD_MAIN}', tok)
    ok('old main commit reachable (via main-archive)', st2 == 200, all_pass)
    st3, _ = api(f'/commits/{LJ_OLD}', tok)
    ok('old LJ commit reachable (via archive ref)', st3 == 200, all_pass)
    st4, br = api(f'/branches/{ARCHIVE_LJ_REF}', tok)
    ok('archive branch API == old LJ SHA', st4 == 200 and (br or {}).get('commit', {}).get('sha') == LJ_OLD, all_pass)
    st5, br5 = api('/branches/main-archive', tok)
    ok('main-archive branch API == old main SHA', st5 == 200 and (br5 or {}).get('commit', {}).get('sha') == OLD_MAIN, all_pass)

    print('\n== 5. COMPARE API (x3) ==')
    EVIDENCE['compares'] = {}
    for b in FEATURES:
        st6, d = api(f'/compare/main...{b}', tok)
        cmp_res = {'status': (d or {}).get('status'), 'ahead_by': (d or {}).get('ahead_by'),
                   'behind_by': (d or {}).get('behind_by')}
        EVIDENCE['compares'][b] = cmp_res
        ok(f'main...{b} = identical/0/0', st6 == 200 and cmp_res['status'] == 'identical'
           and cmp_res['ahead_by'] == 0 and cmp_res['behind_by'] == 0, all_pass)

    print('\n== 6. MANIFEST (G1-G7 present; G8-G10 absent) ==')
    manifest = json.loads(out('show', f'{tip}:docs/M28-MIGRATION-MANIFEST.json'))
    total = g17 = missing17 = present810 = 0
    for g in manifest['groups']:
        for it in g['members']:
            for pth in it['file_paths']:
                total += 1
                e = git('cat-file', '-e', f'{tip}:{pth}')[0] == 0
                if g['id'] in ('G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'):
                    g17 += 1
                    missing17 += 0 if e else 1
                else:
                    present810 += 1 if e else 0
    ok(f'G1-G7 = 225/225 present at tip', g17 == 225 and missing17 == 0, all_pass)
    ok('G8/G9/G10 = 89/89 absent from tip tree',
       present810 == 0 and g17 == 225 and total == 314, all_pass)
    EVIDENCE['manifest'] = {'total': total, 'g17': g17, 'missing17': missing17,
                            'unexpectedly_present_810': present810}

    print('\n== 7. PULL REQUESTS ==')
    EVIDENCE['prs'] = {}
    st7, prs = api('/pulls?state=closed&per_page=20&sort=updated&direction=desc', tok)
    prmap = {p['number']: p for p in (prs or [])}
    for n in (1, 2, 3, 4, 5, 6, 7):
        p = prmap.get(n)
        EVIDENCE['prs'][n] = {'state': (p or {}).get('state'),
                              'merged_at': (p or {}).get('merged_at')}
        ok(f'PR #{n} closed', p is not None and p.get('state') == 'closed', all_pass)
    ok('PR #4 merged (fast-forward detection)', (prmap.get(4) or {}).get('merged_at') is not None, all_pass)
    ok('PR #7 merged (fast-forward detection)', (prmap.get(7) or {}).get('merged_at') is not None, all_pass)
    st8, open_prs = api('/pulls?state=open', tok)
    ok('zero open pull requests', st8 == 200 and (open_prs or []) == [], all_pass)

    print('\n== 8. LJ PRESERVATION ==')
    ok('old LJ tree identical to old main tree (zero unique content)',
       subprocess.run(['git', '-C', REPO, 'diff', '--stat', OLD_MAIN, LJ_OLD],
                      capture_output=True).stdout.decode().strip() == '', all_pass)

    print('\n== 9. UNIVERSE ARITHMETIC ==')
    uni = int(out('rev-list', '--all', '--count'))
    s = int(out('rev-list', '--count', tip))
    o_ns = int(out('rev-list', '--count', *OLD_REFS, '^' + tip))
    ok(f'universe closes: |S| {s} + |O-S| {o_ns} == {uni}', s + o_ns == uni, all_pass)
    EVIDENCE['arithmetic'] = {'universe': uni, 'S': s, 'O_minus_S': o_ns}

    print('\n== RESULT ==')
    verdict = 'ALL-PASS' if all(all_pass) else 'FAILURES PRESENT'
    print(f'  {verdict} ({sum(all_pass)}/{len(all_pass)} checks passed)')
    EVIDENCE['verdict'] = verdict
    EVIDENCE['checks_passed'] = sum(all_pass)
    EVIDENCE['checks_total'] = len(all_pass)
    try:
        import os
        os.makedirs(f'{REPO}/recovery/m32-audit', exist_ok=True)
        with open(f'{REPO}/recovery/m32-audit/m32-verify.json', 'w') as fh:
            json.dump(EVIDENCE, fh, indent=2)
        print('  evidence: recovery/m32-audit/m32-verify.json (local, not committed)')
    except OSError as exc:
        print(f'  evidence write skipped: {exc}')
    return 0 if all(all_pass) else 1


if __name__ == '__main__':
    sys.exit(main())
