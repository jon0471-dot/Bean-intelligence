#!/usr/bin/env python3
"""M31 — execution-readiness verification (read-only, returncode-aware).

Re-proves fresh, fixing the M30 script's defect (bad tree constant
d2c232a7862… = nonexistent object; its purity PASS was vacuous):
  1. Remote ref state vs the M29/M30/M30.1 record (server-side ls-remote).
  2. Fast-forward proofs for every planned push (Ops A1/A2/C1/C2) + lineage guard.
  3. App-tree purity with CORRECT objects, two independent formulations.
  4. Deploy-config surface scan of both trees (old main + live tip).
  5. Manifest completeness (G1-G7 225/225; G8-G10 absent).
  6. Live set arithmetic (universe closes) + SAN-UNPUBLISHED count.
  7. LJ preservation facts.
Writes machine-readable evidence to recovery/m31-audit/m31-verify.json.
No ref is created, moved, or deleted; no merge performed; no remote mutation.
"""
import json
import subprocess
import sys

REPO = '/home/z/my-project'
TIP_REF = 'refs/heads/reconcile/sanitized-m27-m28-migration'
OLD_MAIN = '91a68090ef72f71f52797bd88f9b83831fbeb997'
LJ = 'e7d7003f36896b3ceaf07cde74d36275989469c1'
M262 = '8f61599271b1aa66e86a2c4956f6dc01eef8b737'
M263 = '18c93ed7b1e433bb1c06c0a803d5adff0dcaf064'
PR4 = 'e96d83a5196f45712350aaf41d13a1e5dfcebae7'
D2C = 'd2c232a6fa225644e91e967d2148558ba67b9679'          # verified app-tree COMMIT
D2C_TREE = 'd81fb3c11c2dc232443590e91379d5271b5f5c37'      # its actual tree (M31-verified)
AUDIT_SCRIPTS = [
    ':!scripts/m29cr1*', ':!scripts/m29cr_completeness_sweep.py',
    ':!scripts/m30_verify_state.py', ':!scripts/m301_verify_state.py',
    ':!scripts/m31_verify_state.py',
]
DEPLOY_FILES = ['.github/workflows', 'vercel.json', 'netlify.toml', '.vercel',
                'Dockerfile', 'docker-compose.yml', 'render.yaml', 'fly.toml', 'app.yml']
EVIDENCE = {}


def run(*args, check=True):
    p = subprocess.run(['git', '-C', REPO, *args], capture_output=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} -> rc={p.returncode}: {p.stderr.decode()[:300]}")
    return p


def out(*args, check=True):
    return run(*args, check=check).stdout.decode().strip()


def ok(label, cond, bucket=None):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
    if bucket is not None:
        bucket.append(bool(cond))
    return cond


def is_ancestor(a, b):
    return run('merge-base', '--is-ancestor', a, b, check=False).returncode == 0


def counts(a, b):
    l, r = out('rev-list', '--left-right', '--count', f'{a}...{b}').split('\t')
    return int(l), int(r)


def main():
    all_pass = []
    tip = out('rev-parse', TIP_REF)
    print(f'== LIVE TIP ==\n  {TIP_REF} = {tip}  ({out("rev-list", "--count", tip)} commits)')
    EVIDENCE['tip'] = tip

    print('\n== 1. REMOTE STATE (server-side ls-remote) ==')
    remote = {}
    for line in out('ls-remote', 'origin').splitlines():
        sha, ref = line.split()
        remote[ref] = sha
    EVIDENCE['remote'] = remote
    checks = [
        ('refs/heads/main', OLD_MAIN), ('refs/heads/feat/laxii-jazmii-restoration', LJ),
        ('refs/heads/feat/m26-2-media-capabilities', M262),
        ('refs/heads/fix/laxii-image-output-ux', M263),
    ]
    for ref, want in checks:
        ok(f'{ref} == {want[:8]} (unchanged since M29)', remote.get(ref) == want, all_pass)
    ok('main-sanitized absent on remote', 'refs/heads/main-sanitized' not in remote, all_pass)
    ok('main-archive absent on remote (pre-rename state)', 'refs/heads/main-archive' not in remote, all_pass)
    ok('reconcile/sanitized branch not on remote (local-only lineage)',
       'refs/heads/reconcile/sanitized-m27-m28-migration' not in remote, all_pass)
    ok('default branch HEAD -> old main (rename not started)', remote.get('HEAD') == OLD_MAIN, all_pass)

    print('\n== 2. FAST-FORWARD PROOFS (every planned push) ==')
    ok('FF-1 parent-1 of e96d83a == 18c93ed (Op A1 pure FF)',
       out('rev-parse', f'{PR4}^1') == M263, all_pass)
    ok('FF-2 m262 ancestor of e96d83a', is_ancestor(M262, PR4), all_pass)
    ok('FF-3 m262 ancestor of tip (Op C1 pure FF)', is_ancestor(M262, tip), all_pass)
    ok('FF-4 fix 18c93ed ancestor of tip (Op C2 pure FF)', is_ancestor(M263, tip), all_pass)
    ok('FF-5 e96d83a ancestor of tip', is_ancestor(PR4, tip), all_pass)
    ok('FF-6 LJ NOT ancestor of tip (no FF exists; L1/L2 only)', not is_ancestor(LJ, tip), all_pass)
    ok('FF-7 old main NOT ancestor of tip (lineage guard)', not is_ancestor(OLD_MAIN, tip), all_pass)
    mb = out('merge-base', tip, OLD_MAIN)
    ok(f'merge-base(tip, old main) == cafdb682 (19-commit shared root only)',
       mb == 'cafdb6826da9c4edcd62e2ead15d801869ae9c3a', all_pass)
    c_m262, c_fix, c_lj = counts(tip, M262), counts(tip, M263), counts(tip, LJ)
    ok('m262 branch-only commits == 0 (containment)', c_m262[1] == 0, all_pass)
    ok('fix branch-only commits == 0 (containment)', c_fix[1] == 0, all_pass)
    EVIDENCE['containment'] = {'m262': c_m262, 'fix': c_fix, 'lj': c_lj, 'merge_base': mb}
    print(f'  tip-vs-branch (tip-only/branch-only): m262 {c_m262}, fix {c_fix}, LJ {c_lj}')

    print('\n== 3. APP-TREE PURITY (corrected objects; two formulations) ==')
    pA = run('diff', '--stat', D2C, tip, '--', ':!docs', ':!scripts', check=False)
    okA = pA.returncode == 0 and pA.stdout.decode().strip() == ''
    ok(f'A: commit-level diff {D2C[:8]}..tip excluding docs/+scripts/ == empty', okA, all_pass)
    pB = run('diff', '--stat', D2C_TREE, tip, '--', ':!docs', *AUDIT_SCRIPTS, check=False)
    okB = pB.returncode == 0 and pB.stdout.decode().strip() == ''
    ok(f'B: tree-level diff {D2C_TREE[:8]}..tip excluding docs/ + audit scripts == empty', okB, all_pass)
    pC = run('diff', '--quiet', D2C, tip, '--', 'src', 'prisma', 'package.json', 'next.config.ts',
             check=False)
    ok('C: src/ prisma/ package.json next.config.ts byte-identical', pC.returncode == 0, all_pass)
    EVIDENCE['purity'] = {'A_commit_level': okA, 'B_tree_level': okB, 'C_app_paths': pC.returncode == 0}

    print('\n== 4. DEPLOY-CONFIG SURFACE (both trees) ==')
    for label, rev in [('old main', OLD_MAIN), ('sanitized tip', tip)]:
        hits = [f for f in DEPLOY_FILES if run('cat-file', '-e', f'{rev}:{f}', check=False).returncode == 0]
        ok(f'{label}: no deploy/workflow config files ({hits or "none"})', not hits, all_pass)
        EVIDENCE.setdefault('deploy_surface', {})[label] = hits

    print('\n== 5. MANIFEST (G1-G7 present; G8-G10 absent) ==')
    manifest = json.loads(out('show', f'{tip}:docs/M28-MIGRATION-MANIFEST.json'))
    total = g17 = missing17 = absent810 = present810 = 0
    for g in manifest['groups']:
        for it in g['members']:
            for pth in it['file_paths']:
                total += 1
                e = run('cat-file', '-e', f'{tip}:{pth}', check=False).returncode == 0
                if g['id'] in ('G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'):
                    g17 += 1
                    missing17 += 0 if e else 1
                else:
                    present810 += 1 if e else 0
                    absent810 += 0 if e else 1
    print(f'  total={total} G1-G7={g17} missing={missing17} G8-G10={total - g17} '
          f'absent={absent810} unexpectedly_present={present810}')
    ok('G1-G7 = 225/225 present at live tip', g17 == 225 and missing17 == 0, all_pass)
    ok('G8/G9/G10 = 89/89 absent from tip tree', absent810 == total - g17 and present810 == 0, all_pass)
    EVIDENCE['manifest'] = {'total': total, 'g17': g17, 'missing17': missing17,
                            'absent810': absent810, 'present810': present810}

    print('\n== 6. SET ARITHMETIC ==')
    old_refs = [OLD_MAIN, LJ, 'refs/heads/feat/m28-audio-reliability-quality',
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
                'refs/remotes/origin/feat/laxii-jazmii-restoration', 'refs/remotes/origin/main']
    uni = int(out('rev-list', '--all', '--count'))
    s = int(out('rev-list', '--count', tip))
    o_ns = int(out('rev-list', '--count', *old_refs, '^' + tip))
    san_unpub = int(out('rev-list', '--count', tip, '^origin/fix/laxii-image-output-ux',
                        '^origin/feat/m26-2-media-capabilities'))
    ok(f'universe closes: |S| {s} + |O-S| {o_ns} == {uni}', s + o_ns == uni, all_pass)
    print(f'  universe={uni} |S|={s} |O-S|={o_ns} SAN-UNPUBLISHED={san_unpub}')
    EVIDENCE['arithmetic'] = {'universe': uni, 'S': s, 'O_minus_S': o_ns, 'san_unpublished': san_unpub}

    print('\n== 7. LJ PRESERVATION FACTS ==')
    ok('LJ tree identical to old main tree (zero unique content)',
       run('diff', '--stat', OLD_MAIN, LJ, check=False).stdout.decode().strip() == '', all_pass)
    ok('LJ unique non-merge commits vs old main == 0',
       out('rev-list', LJ, '^' + OLD_MAIN, '--no-merges') == '', all_pass)
    n_lj = out('rev-list', '--count', LJ, '^' + tip)
    print(f'  LJ commits not in canonical: {n_lj} (199 old-side post-fork + merge object + docs commits)')
    EVIDENCE['lj'] = {'not_in_canonical': int(n_lj)}

    print('\n== RESULT ==')
    verdict = 'ALL-PASS' if all(all_pass) else 'FAILURES PRESENT'
    print(f'  {verdict} ({sum(all_pass)}/{len(all_pass)} checks passed)')
    EVIDENCE['verdict'] = verdict
    EVIDENCE['checks_passed'] = sum(all_pass)
    EVIDENCE['checks_total'] = len(all_pass)
    try:
        import os
        os.makedirs(f'{REPO}/recovery/m31-audit', exist_ok=True)
        with open(f'{REPO}/recovery/m31-audit/m31-verify.json', 'w') as fh:
            json.dump(EVIDENCE, fh, indent=2)
        print('  evidence: recovery/m31-audit/m31-verify.json')
    except OSError as exc:
        print(f'  evidence write skipped: {exc}')
    return 0 if all(all_pass) else 1


if __name__ == '__main__':
    sys.exit(main())
