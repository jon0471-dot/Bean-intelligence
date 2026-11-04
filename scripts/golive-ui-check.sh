#!/bin/bash
# Rendered-site verification v2: register via API, then sign in THROUGH THE UI
# and screenshot the authenticated dashboard + JAZMII + LAXII workspaces.
set -u
BASE="http://localhost:3000"
OUT="scripts/phase5-ui-out"
mkdir -p "$OUT"
EMAIL="golive$(date +%s)@bean-e2e.test"
PASS="E2eTest!Passw0rd"
S=$(curl -s -o "$OUT/reg.json" -w "%{http_code}" -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"GoLive E2E\"}")
echo "register -> $S"
OUT="$OUT" EMAIL="$EMAIL" PASS="$PASS" node - <<'EOF'
const { chromium } = require('playwright');
const out = process.env.OUT, email = process.env.EMAIL, pass = process.env.PASS;
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
  // Sign in through the real UI form (tab: Sign in)
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: 'Sign in to BEAN' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/dashboard.png` });
  // JAZMII workspace
  await page.locator('button:has-text("JAZMII")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/jazmii.png` });
  // LAXII studio (edit panel with AI Edit button)
  await page.locator('button:has-text("LAXII")').first().click();
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("edit")').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/laxii.png` });
  await browser.close();
  console.log('screenshots done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
EOF
echo "done"