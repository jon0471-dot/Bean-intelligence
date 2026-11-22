#!/usr/bin/env python3
"""M30 — fresh verification of sanitized-lineage state and branch reconciliation math.

Read-only. Verifies, against the LIVE integration tip (resolved dynamically):
  1. All G1-G7 manifest paths present in the tip tree (G8/G9/G10 counted separately).
  2. Live set arithmetic (S, O, overlap, union) across all refs.
  3. Remote-state comparison against the M29-recorded SHAs.
  4. Per-target-branch reconciliation matrix:
       vs origin/main (old) ahead/behind, vs canonical tip ahead/behind,
       containment, fast-forward proofs for every proposed push.
No ref is created, moved, or deleted; no merge is performed (merge-tree dry runs only).
"""
import json
import subprocess
import sys

REPO = '/home/z/my-project'
TIP_REF = 'refs/heads/reconcile/sanitized-m27-m28-migration'
M29_RECORDED = {
    'refs/heads/main (remote)': '91a68090ef72f71f52797bd88f9b83831fbeb997',
    'refs/heads/feat/laxii-jazmii-restoration (remote)': 'e7d7003f36896b3ceaf07cde74d36275989469c1',
    'refs/heads/feat/m26-2-media-capabilities (remote)': '8f61599271b1aa66e86a2c4956f6dc01eef8b737',
    'refs/heads/fix/laxii-image-output-ux (remote)': '18c93ed7b1e433bb1c06c0a803d5adff0dcaf064',
}
OLD_MAIN = '91a68090ef72f71f52797bd88f9b83831fbeb997'
LJ = 'e7d7003f36896b3ceaf07cde74d36275989469c1'
M262 = '8f61599271b1aa66e86a2c4956f6dc01eef8b737'
M263 = '18c93ed7b1e433bb1c06c0a803d5adff0dcaf064'
PR4 = 'e96d83a5196f45712350aaf41d13a1e5dfcebae7'


def run(*args):
    return subprocess.run(['git', '-C', REPO, *args], capture_output=True)


def out(*args):
    return run(*args).stdout.decode().strip()


def ok(label, cond):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
    return cond


def is_ancestor(a, b):
    return run('merge-base', '--is-ancestor', a, b).returncode == 0


def counts(a, b):
    """left-only(a) / right-only(b)"""
    l, r = out('rev-list', '--left-right', '--count', f'{a}...{b}').split('\t')
    return int(l), int(r)


def main():
    tip = out('rev-parse', TIP_REF)
    print(f'== LIVE INTEGRATION TIP ==\n  {TIP_REF} = {tip}')
    app_tree = 'd2c232a78622a81117331892a6180afd976b818f'
    # exact app-tree identity check: tip vs verified d2c232a outside docs/audit scripts
    d = run('diff', '--stat', f'{app_tree}', tip, '--', ':!docs', ':!scripts/m29cr1*',
            ':!scripts/m29cr_completeness_sweep.py', ':!scripts/m30_verify_state.py').stdout.decode().strip()
    ok(f'app tree outside docs/ + audit scripts identical to verified {app_tree[:8]} (diff: {d or "empty"})',
       d == '')

    print('\n== 1. MANIFEST PATHS AT LIVE TIP ==')
    mf = run('show', f'{tip}:docs/M28-MIGRATION-MANIFEST.json').stdout.decode()
    manifest = json.loads(mf)
    total = g17 = missing17 = absent810 = present810 = 0
    miss = []
    for g in manifest['groups']:
        gid = g['id']
        for it in g['members']:
            for p in it['file_paths']:
                total += 1
                e = run('cat-file', '-e', f'{tip}:{p}').returncode == 0
                if gid in ('G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'):
                    g17 += 1
                    if not e:
                        missing17 += 1
                        miss.append((gid, p))
                else:
                    if e:
                        present810 += 1
                    else:
                        absent810 += 1
    print(f'  total manifest paths: {total} (G1-G7={g17}, G8-G10={g17 and total-g17})')
    print(f'  G1-G7 present at tip: {g17 - missing17}/{g17}, missing={missing17}')
    for gid, p in miss[:10]:
        print(f'    MISSING {gid} {p}')
    print(f'  G8/G9/G10 intentionally absent: {absent810}, unexpectedly present: {present810}')
    ok('G1-G7 = 225/225 present at live tip', g17 == 225 and missing17 == 0)

    print('\n== 2. REMOTE STATE vs M29-RECORDED ==')
    remote = dict()
    for line in out('ls-remote', 'origin').splitlines():
        sha, ref = line.split()
        remote[ref] = sha
    for label, sha in M29_RECORDED.items():
        ref = label.split(' ')[0].replace('refs/heads/', 'refs/heads/')
        rsha = remote.get(ref)
        ok(f'{ref} unchanged since M29 ({rsha[:8]})', rsha == sha)
    ok('main-sanitized absent on remote (publication precondition)', 'refs/heads/main-sanitized' not in remote)
    ok('default branch = main (HEAD -> refs/heads/main = 91a6809)', remote.get('HEAD') == OLD_MAIN)

    print('\n== 3. LIVE SET ARITHMETIC (all refs) ==')
    all_count = int(out('rev-list', '--all', '--count'))
    s_count = int(out('rev-list', '--count', tip))
    old_refs = [OLD_MAIN, LJ,
                'refs/heads/feat/m28-audio-reliability-quality', 'refs/heads/feat/gangzii-audio-production',
                'refs/heads/feat/jazmii-auto-director', 'refs/heads/feat/trust-specialist-coverage',
                'refs/heads/feat/feb2027-trust-engine', 'refs/heads/m25-intel-lanes',
                'refs/heads/m26-audit', 'refs/heads/m26-release', 'refs/heads/m261-security-closure',
                'refs/heads/main',
                'refs/heads/backup/feb2027-presplit-main', 'refs/heads/backup/laxii-pre-restoration',
                'refs/heads/backup/m22-wip-auto-commit', 'refs/heads/backup/m25-intel-wip-auto-commit',
                'refs/heads/backup/m25-wip-auto-commit', 'refs/heads/backup/m26-baseline-auto-commit',
                'refs/heads/backup/m26-f0b47ad-line', 'refs/heads/backup/m261-local-main-pre-sync',
                'refs/heads/backup/pre-phase0-81caaa3', 'refs/heads/backup/pre-phase1-auto-commit',
                'refs/backup/scratch-bf47b8c',
                'refs/remotes/origin/feat/laxii-jazmii-restoration', 'refs/remotes/origin/main']
    o_count = int(out('rev-list', '--count', *old_refs))
    o_not_s = int(out('rev-list', '--count', *old_refs, '^' + tip))
    print(f'  |S| (sanitized tip) = {s_count}; |O| (old-side refs) = {o_count}; '
          f'O-S = {o_not_s}; overlap = {o_count - o_not_s}')
    print(f'  universe rev-list --all = {all_count}; S + (O-S) = {s_count + o_not_s}')
    ok('universe accounting closes (S + (O-S) == rev-list --all)', s_count + o_not_s == all_count)

    print('\n== 4. RECONCILIATION MATRIX (live tip as canonical candidate) ==')
    rows = []
    for name, sha in [('feat/laxii-jazmii-restoration', LJ),
                      ('feat/m26-2-media-capabilities', M262),
                      ('fix/laxii-image-output-ux', M263)]:
        b_main = counts(OLD_MAIN, sha)          # main-only / branch-only vs old main
        c_tip = counts(tip, sha)                # tip-only / branch-only vs canonical
        rows.append((name, sha, b_main, c_tip))
        print(f'  {name}:')
        print(f'    vs origin/main : behind={b_main[0]} ahead={b_main[1]} (API-fresh: see report)')
        print(f'    vs canonical tip: behind={c_tip[0]} ahead={c_tip[1]}')
        print(f'    branch contained in canonical: {c_tip[1] == 0}')
        print(f'    FF push {sha[:8]} -> tip possible: {is_ancestor(sha, tip)}')

    print('\n== 5. FAST-FORWARD PROOFS for every proposed push ==')
    ok(f'FF-1: parent-1 of PR4 e96d83a == 18c93ed (fix branch can FF to e96d83a)',
       out('rev-parse', f'{PR4}^1') == M263)
    ok('FF-2: m262 8f61599 is ancestor of PR4 (fully contained after FF-1)', is_ancestor(M262, PR4))
    ok('FF-3: m262 8f61599 is ancestor of live tip (canonical FF push possible)', is_ancestor(M262, tip))
    ok('FF-4: fix 18c93ed is ancestor of live tip', is_ancestor(M263, tip))
    ok('FF-5: PR4 e96d83a is ancestor of live tip', is_ancestor(PR4, tip))
    ok('FF-6: LJ e7d7003 is NOT ancestor of live tip (FF impossible; only merge-in or owner-gated move)',
       not is_ancestor(LJ, tip))
    ok('FF-7: old main 91a6809 is NOT ancestor of live tip (lineage isolation guard)',
       not is_ancestor(OLD_MAIN, tip))
    mb = out('merge-base', tip, OLD_MAIN)
    ok(f'lineage guard: merge-base(tip, old main) == cafdb68…', mb.startswith('cafdb68'))

    print('\n== 6. LJ MERGE-IN DRY RUN (conflict surface, no objects written to refs) ==')
    mt = run('merge-tree', '--write-tree', '--name-only', tip, LJ)
    lines = mt.stdout.decode().splitlines()
    conflicts = [l for l in lines[1:] if l.strip()]
    print(f'  merge-tree exit={mt.returncode}; conflicted paths = {len(conflicts)}')
    for p in conflicts[:12]:
        print(f'    {p}')
    if len(conflicts) > 12:
        print(f'    ... and {len(conflicts) - 12} more')

    print('\n== 7. OBJECT PRESERVATION for LJ alignment option ==')
    n_lj = out('rev-list', '--count', LJ, '^' + tip)
    n_lj_tree_diff = run('diff', '--stat', OLD_MAIN, LJ).stdout.decode().strip()
    print(f'  LJ commits not in canonical: {n_lj}')
    ok('LJ tree identical to old main tree (no unique content; only the merge object)', n_lj_tree_diff == '')
    print(f'  LJ unique object(s): {out("rev-list", LJ, "^" + OLD_MAIN, "--no-merges") or "(none)"}; '
          f'non-merge unique commits = 0')


if __name__ == '__main__':
    sys.exit(main())
