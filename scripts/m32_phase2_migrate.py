#!/usr/bin/env python3
"""M32 Phase 2 — preserve old main, promote sanitized main (step-gated).

Steps (each verified before the next; abort on any anomaly):
  0. Preconditions: fresh ls-remote matches expected pre-migration state;
     local CANONICAL_SHA resolves; ancestry re-checked.
  1. Publish CANONICAL_SHA as refs/heads/main-sanitized (ordinary create).
  2. Rename refs/heads/main -> refs/heads/main-archive (GitHub rename API).
  3. Rename refs/heads/main-sanitized -> refs/heads/main (rename API).
  4. Set default branch to main (PATCH repo settings).
  5. Full verification of every ref + default branch.

Token from git credential store, used in memory only, never printed.
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
GIT = '/home/z/my-project'
EVIDENCE = {}


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
    refs = {}
    for line in o.splitlines():
        sha, ref = line.split()
        refs[ref] = sha
    return refs


def show(step, msg):
    print(f'[step {step}] {msg}')


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else '0'
    tok = token()
    if not tok:
        die('no token from credential store')

    if step == '0':
        show(0, 'preconditions')
        rc, tip, _ = git('rev-parse', CANONICAL + '^{commit}')
        if rc or tip != CANONICAL:
            die(f'local CANONICAL_SHA does not resolve: {tip}')
        rc, anc, _ = git('merge-base', '--is-ancestor',
                         'e96d83a5196f45712350aaf41d13a1e5dfcebae7', CANONICAL)
        if rc != 0:
            die('e96d83a (PR#4) not ancestor of CANONICAL')
        rc, anc2, _ = git('merge-base', '--is-ancestor', M262, CANONICAL)
        rc3, anc3, _ = git('merge-base', '--is-ancestor', M263, CANONICAL)
        if rc != 0 or rc3 != 0:
            die('m262/m263 tips not ancestors of CANONICAL')
        refs = lsremote()
        expect = {'refs/heads/main': OLD_MAIN,
                  'refs/heads/feat/laxii-jazmii-restoration': LJ,
                  'refs/heads/feat/m26-2-media-capabilities': M262,
                  'refs/heads/fix/laxii-image-output-ux': M263}
        for ref, want in expect.items():
            if refs.get(ref) != want:
                die(f'{ref} = {refs.get(ref)} != expected {want}')
        for ref in ('refs/heads/main-archive', 'refs/heads/main-sanitized',
                    'refs/heads/archive/feat-laxii-jazmii-restoration-pre-m32'):
            if ref in refs:
                die(f'{ref} unexpectedly already exists')
        if refs.get('HEAD') != OLD_MAIN:
            die(f"remote HEAD={refs.get('HEAD')} != old main")
        print('  preconditions OK: remote matches pre-migration record, ancestry verified')
        return 0

    if step == '1':
        show(1, f'publish main-sanitized at {CANONICAL[:8]}')
        refs = lsremote()
        if refs.get('refs/heads/main') != OLD_MAIN:
            die('old main moved since step 0')
        if 'refs/heads/main-sanitized' in refs:
            die('main-sanitized already exists')
        p = subprocess.run(['git', '-C', GIT, 'push', 'origin',
                            f'{CANONICAL}:refs/heads/main-sanitized'],
                           capture_output=True)
        if p.returncode != 0:
            die(f'push main-sanitized failed: {p.stderr.decode()[:400]}')
        refs = lsremote()
        if refs.get('refs/heads/main-sanitized') != CANONICAL:
            die(f"main-sanitized = {refs.get('refs/heads/main-sanitized')} != CANONICAL")
        print('  main-sanitized published and verified server-side')
        return 0

    if step == '2':
        show(2, 'rename main -> main-archive (GitHub rename API)')
        refs = lsremote()
        if refs.get('refs/heads/main') != OLD_MAIN:
            die('old main moved since publication')
        if refs.get('refs/heads/main-sanitized') != CANONICAL:
            die('main-sanitized not in place')
        st, resp = api('/branches/main/rename', tok, method='POST',
                       body={'new_name': 'main-archive'})
        print(f'  rename API -> HTTP {st}')
        if st not in (200, 201):
            die(f'rename failed: {json.dumps(resp)[:500]}')
        refs = lsremote()
        if refs.get('refs/heads/main-archive') != OLD_MAIN:
            die(f"main-archive = {refs.get('refs/heads/main-archive')} != {OLD_MAIN}")
        if 'refs/heads/main' in refs:
            die('refs/heads/main still exists after rename')
        st2, repo = api('', tok)
        EVIDENCE['default_after_rename2'] = repo.get('default_branch')
        print(f"  main-archive verified bit-for-bit; default_branch now: {repo.get('default_branch')}")
        return 0

    if step == '3':
        show(3, 'rename main-sanitized -> main (GitHub rename API)')
        refs = lsremote()
        if refs.get('refs/heads/main-archive') != OLD_MAIN:
            die('main-archive drifted')
        if refs.get('refs/heads/main-sanitized') != CANONICAL:
            die('main-sanitized drifted')
        st, resp = api('/branches/main-sanitized/rename', tok, method='POST',
                       body={'new_name': 'main'})
        print(f'  rename API -> HTTP {st}')
        if st not in (200, 201):
            die(f'rename failed: {json.dumps(resp)[:500]}')
        refs = lsremote()
        if refs.get('refs/heads/main') != CANONICAL:
            die(f"main = {refs.get('refs/heads/main')} != CANONICAL")
        if 'refs/heads/main-sanitized' in refs:
            die('main-sanitized still exists after rename')
        print('  main == CANONICAL verified; main-sanitized consumed by rename')
        return 0

    if step == '4':
        show(4, 'set default branch -> main')
        st, repo = api('', tok)
        if repo.get('default_branch') == 'main':
            print('  default_branch already main')
        else:
            st2, resp = api('', tok, method='PATCH', body={'default_branch': 'main'})
            if st2 != 200:
                die(f'PATCH default_branch failed: HTTP {st2} {json.dumps(resp)[:300]}')
        st3, repo3 = api('', tok)
        refs = lsremote()
        if repo3.get('default_branch') != 'main':
            die(f"default_branch = {repo3.get('default_branch')}")
        if refs.get('HEAD') != CANONICAL:
            die(f"remote HEAD = {refs.get('HEAD')} != CANONICAL")
        print(f"  default_branch=main; remote HEAD={refs.get('HEAD')[:8]} == CANONICAL")
        return 0

    if step == '5':
        show(5, 'full verification of refs + default branch')
        refs = lsremote()
        want = {'refs/heads/main-archive': OLD_MAIN, 'refs/heads/main': CANONICAL,
                'refs/heads/feat/laxii-jazmii-restoration': LJ,
                'refs/heads/feat/m26-2-media-capabilities': M262,
                'refs/heads/fix/laxii-image-output-ux': M263}
        bad = {r: refs.get(r) for r, v in want.items() if refs.get(r) != v}
        if bad:
            die(f'refs mismatch: {bad}')
        st, c_old = api(f'/commits/{OLD_MAIN}', tok)
        st2, c_new = api(f'/commits/{CANONICAL}', tok)
        if st != 200:
            die('old main commit NOT reachable on GitHub anymore')
        if st2 != 200:
            die('canonical commit not reachable')
        refs.pop('HEAD', None)
        print(f'  refs = {json.dumps({k: v[:8] for k, v in refs.items()}, indent=2)}')
        print(f'  old main {OLD_MAIN[:8]} reachable via main-archive: HTTP {st}')
        print(f'  canonical {CANONICAL[:8]} reachable via main: HTTP {st2}')
        st3, repo3 = api('', tok)
        print(f"  default_branch = {repo3.get('default_branch')}")
        print('  PHASE 2 COMPLETE')
        return 0

    die(f'unknown step {step}')


if __name__ == '__main__':
    sys.exit(main())
