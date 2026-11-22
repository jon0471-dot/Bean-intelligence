#!/usr/bin/env python3
"""M32 Phase 2 precondition — fresh platform/deploy-integration surface audit.

Read-only GitHub API audit of everything that could be affected by a
default-branch migration: deployments, hooks, pages, environments,
workflows, branch protection, rulesets, GitHub App installations (Vercel
detection), check runs on main, and open PR inventory.

Token is taken from the git credential store IN MEMORY only; it is never
printed, stored, or transmitted anywhere except GitHub's API over TLS.
Writes evidence JSON to recovery/m32-audit/platform-surface.json (local only,
not committed).
"""
import json
import subprocess
import sys
import urllib.request

REPO = 'jon0471-dot/Bean-intelligence'
API = f'https://api.github.com/repos/{REPO}'
EVIDENCE = {}


def token():
    p = subprocess.run(['git', 'credential', 'fill'],
                       input=b'protocol=https\nhost=github.com\n\n',
                       capture_output=True)
    for line in p.stdout.decode().splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    return None


def api(path, tok, method='GET'):
    req = urllib.request.Request(f'{API}{path}', method=method,
                                 headers={'Authorization': f'token {tok}',
                                          'Accept': 'application/vnd.github+json',
                                          'User-Agent': 'm32-exec'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, (json.loads(e.read().decode() or '{}'))


def summarize(label, status, data, keys):
    row = {'status': status}
    if isinstance(data, list):
        row['count'] = len(data)
        row['items'] = [{k: it.get(k) for k in keys if k in it} for it in data[:20]]
    elif isinstance(data, dict):
        for k in keys:
            if k in data:
                row[k] = data[k]
    EVIDENCE[label] = row
    print(f'  {label}: HTTP {status} -> {json.dumps(row)[:400]}')


def main():
    tok = token()
    if not tok:
        print('FATAL: no token from credential store')
        return 2
    print('== M32 PLATFORM SURFACE AUDIT (read-only) ==')

    st, repo = api('', tok)
    summarize('repo', st, repo, ['full_name', 'default_branch', 'private',
                                 'has_pages', 'fork', 'archived'])
    st, dep = api('/deployments', tok)
    summarize('deployments', st, dep, ['id', 'sha', 'ref', 'environment',
                                       'created_at', 'producer'])
    st, hooks = api('/hooks', tok)
    summarize('hooks', st, hooks, ['id', 'name', 'active', 'config'])
    st, pages = api('/pages', tok)
    summarize('pages', st, pages, ['status', 'source', 'build_type'])
    st, envs = api('/environments', tok)
    summarize('environments', st, envs, ['name', 'id'])
    st, wfs = api('/actions/workflows', tok)
    summarize('workflows', st, wfs, ['name', 'path', 'state'])
    st, runs = api('/actions/runs?per_page=5', tok)
    summarize('workflow_runs', st, runs, ['name', 'status', 'head_branch'])
    st, prot = api('/branches/main/protection', tok)
    summarize('branch_protection_main', st, prot, ['required_status_checks',
                                                   'enforce_admins', 'restrictions'])
    st, rules = api('/rulesets', tok)
    summarize('rulesets', st, rules, ['id', 'name', 'enforcement', 'target'])
    st, inst = api('/installation', tok)
    app_name = (inst or {}).get('app_slug') if isinstance(inst, dict) else None
    EVIDENCE['github_app_installation'] = {'status': st, 'app_slug': app_name}
    print(f'  github_app_installation: HTTP {st} app_slug={app_name}')
    st, checks = api('/commits/91a68090ef72f71f52797bd88f9b83831fbeb997/check-runs', tok)
    cr = (checks or {}).get('check_runs', []) if isinstance(checks, dict) else []
    EVIDENCE['check_runs_old_main'] = {'status': st, 'count': len(cr),
                                       'names': [c.get('name') for c in cr[:10]]}
    print(f'  check_runs_old_main: HTTP {st} count={len(cr)} names={[c.get("name") for c in cr[:10]]}')
    st, prs = api('/pulls?state=open&per_page=20', tok)
    summarize('open_prs', st, prs, ['number', 'title', 'head', 'base', 'state'])
    st, cvs = api('/status/91a68090ef72f71f52797bd88f9b83831fbeb997', tok)
    EVIDENCE['combined_status_old_main'] = {'status': st,
                                            'state': (cvs or {}).get('state'),
                                            'count': len((cvs or {}).get('statuses', []))}
    print(f"  combined_status_old_main: HTTP {st} state={(cvs or {}).get('state')}")

    with open('/home/z/my-project/recovery/m32-audit/platform-surface.json', 'w') as fh:
        json.dump(EVIDENCE, fh, indent=2, default=str)
    print('  evidence: recovery/m32-audit/platform-surface.json (local, not committed)')

    v = EVIDENCE['repo'].get('default_branch')
    print(f"\n  DEFAULT BRANCH = {v}")
    print('  AUDIT COMPLETE (no mutations performed)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
