#!/usr/bin/env python3
"""M32 Phases 3/4/5 — synchronize the three feature branches to CANONICAL_SHA.

Phase 3  feat/m26-2-media-capabilities   ordinary FF push
Phase 4  fix/laxii-image-output-ux       ordinary FF push (PR#4 e96d83a re-proved)
Phase 5  feat/laxii-jazmii-restoration   backup ref first, then scoped
         --force-with-lease anchored to the exact pre-update SHA

Every phase re-fetches the live remote before and after; any drift of a
target ref between checks aborts the phase. Token from the git credential
store, in memory only.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'jon0471-dot/Bean-intelligence'
API = f'https://api.github.com/repos/{REPO}'
OLD_MAIN = '91a68090ef72f71f52797bd88f9b83831fbeb997'
CANONICAL = '8f32b7198d042df0211a8f88be8f78e9b897a229'
LJ = 'e7d7003f36896b3ceaf07cde74d36275989469c1'
M262 = '8f61599271b1aa66e86a2c4956f6dc01eef8b737'
M263 = '18c93ed7b1e433bb1c06c0a803d5adff0dcaf064'
PR4 = 'e96d83a5196f45712350aaf41d13a1e5dfcebae7'
ARCHIVE_LJ = 'archive/feat-laxii-jazmii-restoration-pre-m32'
GIT = '/home/z/my-project'


def die(msg):
    print(f'!! ABORT: {msg}')
    sys.exit(1)


def git(*args):
    p = subprocess.run(['git', '-C', GIT, *args], capture_output=True)
    return p.returncode, p.stdout.decode().strip(), p.stderr.decode().strip()


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


def lsremote():
    rc, o, e = git('ls-remote', 'origin')
    if rc:
        die(f'ls-remote failed: {e}')
    return dict(reversed(line.split()) for line in o.splitlines()
                if line.split()[1] != 'HEAD')


def compare(tok, base, head):
    st, d = api(f'/compare/{base}...{head}', tok)
    if st != 200:
        die(f'compare {base}...{head} HTTP {st}')
    return {'status': d.get('status'), 'ahead_by': d.get('ahead_by'),
            'behind_by': d.get('behind_by')}


def ff_push(tok, ref, start_sha, label):
    """Ordinary (non-force) push of CANONICAL to ref, after proving FF."""
    refs = lsremote()
    if refs.get('refs/heads/main') != CANONICAL:
        die('main no longer CANONICAL — remote drifted')
    if refs.get(ref) != start_sha:
        die(f'{ref} moved: {refs.get(ref)} != expected {start_sha}')
    rc, _, _ = git('merge-base', '--is-ancestor', start_sha, CANONICAL)
    if rc != 0:
        die(f'{start_sha} is NOT an ancestor of CANONICAL — no FF exists')
    # dry-run proof: rejected non-FF would fail here
    p = subprocess.run(['git', '-C', GIT, 'push', '--dry-run', 'origin',
                        f'{CANONICAL}:{ref}'], capture_output=True)
    out = p.stderr.decode() + p.stdout.decode()
    if p.returncode != 0 or '[rejected]' in out:
        die(f'dry-run FF proof failed for {ref}: {out[:400]}')
    print(f'  [{label}] dry-run FF proof OK ({start_sha[:8]} -> {CANONICAL[:8]})')
    p = subprocess.run(['git', '-C', GIT, 'push', 'origin', f'{CANONICAL}:{ref}'],
                       capture_output=True)
    if p.returncode != 0:
        die(f'push failed for {ref}: {p.stderr.decode()[:400]}')
    refs = lsremote()
    if refs.get(ref) != CANONICAL:
        die(f'{ref} after push = {refs.get(ref)}')
    cmp_res = compare(tok, 'main', ref.removeprefix('refs/heads/'))
    print(f'  [{label}] pushed; compare main...{ref[11:]} = {cmp_res}')
    if not (cmp_res['status'] == 'identical' and cmp_res['ahead_by'] == 0
            and cmp_res['behind_by'] == 0):
        die(f'{label} final compare not identical: {cmp_res}')
    return cmp_res


def phase3(tok):
    print('== PHASE 3: feat/m26-2-media-capabilities ==')
    return ff_push(tok, 'refs/heads/feat/m26-2-media-capabilities', M262, 'P3')


def phase4(tok):
    print('== PHASE 4: fix/laxii-image-output-ux ==')
    refs = lsremote()
    if refs.get('refs/heads/fix/laxii-image-output-ux') != M263:
        die('fix branch moved unexpectedly')
    rc, _, _ = git('merge-base', '--is-ancestor', PR4, CANONICAL)
    if rc != 0:
        die('PR#4 reconciliation e96d83a NOT contained in CANONICAL')
    print('  PR#4 reconciliation e96d83a contained in CANONICAL: YES')
    return ff_push(tok, 'refs/heads/fix/laxii-image-output-ux', M263, 'P4')


def phase5(tok):
    print('== PHASE 5: feat/laxii-jazmii-restoration ==')
    refs = lsremote()
    if refs.get('refs/heads/feat/laxii-jazmii-restoration') != LJ:
        die(f"LJ moved before backup: {refs.get('refs/heads/feat/laxii-jazmii-restoration')}")
    if ARCHIVE_LJ in refs:
        die('archive ref already exists')
    print(f'  1. LJ live SHA captured: {LJ}')
    # 2/3. create backup ref at the exact original SHA
    p = subprocess.run(['git', '-C', GIT, 'push', 'origin',
                        f'{LJ}:refs/heads/{ARCHIVE_LJ}'], capture_output=True)
    if p.returncode != 0:
        die(f'backup push failed: {p.stderr.decode()[:400]}')
    refs = lsremote()
    if refs.get(f'refs/heads/{ARCHIVE_LJ}') != LJ:
        die(f'archive ref = {refs.get(f"refs/heads/{ARCHIVE_LJ}")} != {LJ}')
    print(f'  2-3. backup ref {ARCHIVE_LJ} created at {LJ[:8]} (ls-remote verified)')
    # 4. verify via API
    st, br = api(f'/branches/{ARCHIVE_LJ}', tok)
    if st != 200 or br.get('commit', {}).get('sha') != LJ:
        die(f'archive branch API mismatch: HTTP {st}')
    st2, c = api(f'/commits/{LJ}', tok)
    if st2 != 200:
        die('original LJ commit not reachable through API')
    print(f'  4. archive ref API verified (HTTP {st}); commit {LJ[:8]} reachable (HTTP {st2})')
    # 5. reachability through backup ref — commit GET via archive ref
    st3, c3 = api(f'/commits/{ARCHIVE_LJ}', tok)
    if st3 != 200 or c3.get('sha') != LJ:
        die('LJ commit not reachable through backup ref')
    print('  5. LJ commit reachable through backup ref: YES')
    # 6. scoped force-with-lease anchored to the exact captured SHA
    p = subprocess.run(['git', '-C', GIT, 'push',
                        f'--force-with-lease=refs/heads/feat/laxii-jazmii-restoration:{LJ}',
                        'origin', f'{CANONICAL}:refs/heads/feat/laxii-jazmii-restoration'],
                       capture_output=True)
    out = p.stderr.decode() + p.stdout.decode()
    if p.returncode != 0:
        die(f'force-with-lease push failed: {out[:400]}')
    print(f'  6. force-with-lease push OK (lease anchor {LJ[:8]})')
    refs = lsremote()
    if refs.get('refs/heads/feat/laxii-jazmii-restoration') != CANONICAL:
        die(f"LJ after update = {refs.get('refs/heads/feat/laxii-jazmii-restoration')}")
    if refs.get(f'refs/heads/{ARCHIVE_LJ}') != LJ:
        die('archive ref drifted during update')
    cmp_res = compare(tok, 'main', 'feat/laxii-jazmii-restoration')
    st4, c4 = api(f'/commits/{LJ}', tok)
    print(f'  compare main...feat/laxii-jazmii-restoration = {cmp_res}')
    print(f'  original LJ commit still reachable (HTTP {st4}); archive ref = {refs.get(f"refs/heads/{ARCHIVE_LJ}")[:8]}')
    if not (cmp_res['status'] == 'identical' and cmp_res['ahead_by'] == 0
            and cmp_res['behind_by'] == 0 and st4 == 200):
        die('phase 5 final verification failed')
    return cmp_res


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else '3'
    tok = token()
    if not tok:
        die('no token from credential store')
    res = {'3': phase3, '4': phase4, '5': phase5}[phase](tok)
    print(f'  PHASE {phase} COMPLETE: {json.dumps(res)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
