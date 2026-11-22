#!/usr/bin/env python3
"""M29-CR definitive completeness sweep.

1. For all 36 manifest members: verify every migrated file path exists in the
   sanitized integration tree (8e5c2ea).
2. For all 258 old-side commits: collect every changed path under product-code
   prefixes that is MISSING from the sanitized tree — the only places where
   approved work could have been left behind. Each hit is then classified.
"""
import json
import subprocess
from collections import defaultdict

REPO = '/home/z/my-project'
SAN = '8e5c2ea78622a81117331892a6180afd976b818f'

OLD_REFS = [
    'refs/heads/main', 'refs/heads/feat/m28-audio-reliability-quality',
    'refs/heads/feat/gangzii-audio-production', 'refs/heads/feat/jazmii-auto-director',
    'refs/heads/feat/trust-specialist-coverage', 'refs/heads/feat/feb2027-trust-engine',
    'refs/heads/m25-intel-lanes', 'refs/heads/m26-audit', 'refs/heads/m26-release',
    'refs/heads/m261-security-closure', 'refs/heads/backup/feb2027-presplit-main',
    'refs/heads/backup/laxii-pre-restoration', 'refs/heads/backup/m22-wip-auto-commit',
    'refs/heads/backup/m25-intel-wip-auto-commit', 'refs/heads/backup/m25-wip-auto-commit',
    'refs/heads/backup/m26-baseline-auto-commit', 'refs/heads/backup/m26-f0b47ad-line',
    'refs/heads/backup/m261-local-main-pre-sync', 'refs/heads/backup/pre-phase0-81caaa3',
    'refs/heads/backup/pre-phase1-auto-commit', 'refs/backup/scratch-bf47b8c',
    'refs/remotes/origin/main', 'refs/remotes/origin/feat/laxii-jazmii-restoration',
]

PRODUCT_PREFIXES = ('src/', 'prisma/', 'workers/', 'public/api', 'package.json',
                    'bun.lock', 'next.config.ts', 'tailwind.config.ts',
                    'postcss.config.mjs', 'eslint.config.mjs', 'components.json',
                    'tsconfig.json', 'tests/', 'evals/', 'examples/', 'db/')
ALLOWED_RUNTIME_ARTIFACTS = ('cookies', 'login.json', 'verify.db', '.pid',
                             'dev.log', 'session', 'token', '.env', 'credentials')


def run(*args):
    return subprocess.run(['git', '-C', REPO, *args], capture_output=True)


def exists_in_san(path):
    return run('cat-file', '-e', f'{SAN}:{path}').returncode == 0


# ---- 1. manifest file presence -------------------------------------------
manifest = json.load(open(
    '/home/z/my-project/worktrees/m28-slm/docs/M28-MIGRATION-MANIFEST.json'))
print('=== MANIFEST FILE PRESENCE IN SANITIZED TREE (8e5c2ea) ===')
missing_by_group = defaultdict(list)
checked = 0
for g in manifest['groups']:
    for it in g['members']:
        for p in it['file_paths']:
            checked += 1
            if not exists_in_san(p):
                missing_by_group[g['id']].append((it['source_sha'][:8], p))
print(f'paths checked: {checked}')
for gid, miss in sorted(missing_by_group.items()):
    print(f'  {gid}: {len(miss)} missing')
    for sha, p in miss[:12]:
        print(f'    {sha} {p}')
if not missing_by_group:
    print('  -> ALL manifest paths present in the sanitized tree (0 missing)')

# ---- 2. product-code paths missing from sanitized tree --------------------
old_set = run('rev-list', *OLD_REFS, '^' + SAN).stdout.decode().split()
print(f'\n=== PRODUCT-CODE PATHS MISSING FROM SANITIZED TREE (over {len(old_set)} old-side commits) ===')
hits = defaultdict(set)   # path -> set of commit shorts
ncommits_scanned = 0
for sha in old_set:
    ncommits_scanned += 1
    out = run('diff-tree', '-r', '--no-commit-id', '--name-status',
              '--no-renames', '--root', sha).stdout.decode()
    for line in out.splitlines():
        parts = line.split('\t')
        st, path = parts[0], parts[-1]
        if st not in ('A', 'M'):
            continue
        if not path.startswith(PRODUCT_PREFIXES):
            continue
        if exists_in_san(path):
            continue
        hits[path].add(sha[:8])
print(f'commits scanned: {ncommits_scanned}')
print(f'distinct product-code paths missing from sanitized tree: {len(hits)}')
sensitive = {p for p in hits if any(a in p.lower() for a in ALLOWED_RUNTIME_ARTIFACTS)}
other = {p: c for p, c in hits.items() if p not in sensitive}
print(f'\n-- runtime/credential artifacts (sanitization exclusions): {len(sensitive)}')
for p in sorted(sensitive):
    print(f'   {p}  (in {len(hits[p])} commits)')
print(f'\n-- other product-code paths: {len(other)}')
for p, cs in sorted(other.items()):
    print(f'   {p}  commits: {sorted(cs)[:6]}{"..." if len(cs) > 6 else ""}')
