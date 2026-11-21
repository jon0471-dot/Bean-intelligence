#!/usr/bin/env bash
# M27 — UI inspection: boot the production build, register a user, capture
# GANGZII desktop + mobile screenshots (real evidence, single session).
set -u
cd /home/z/my-project
export BEAN_ENGINE_EMBEDDED=0   # UI inspection only; no worker pools needed
mkdir -p /tmp/m27-ui
LOG=/tmp/m27-ui/server.log

echo "=== boot ==="
nohup bunx next start -p 3100 > "$LOG" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 40); do
  sleep 2
  if curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 40 | grep -q "{"; then
    echo "server ready (pid $SERVER_PID) after $((i*2))s"; break
  fi
done
curl -s --max-time 5 "http://localhost:3100/api/health" | head -c 300; echo

echo "=== register user ==="
TS=$(date +%s)
EMAIL="ui-inspect-$TS@test.local"
PASS='UiInspect-2027!x'
REG=$(curl -s --max-time 10 -X POST "http://localhost:3100/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"M27 UI Inspector\"}")
echo "$REG" | head -c 200; echo
LOGIN=$(curl -s --max-time 10 -c /tmp/m27-ui/cookies.txt -X POST "http://localhost:3100/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$LOGIN" | head -c 200; echo
USERID=$(node -e "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();db.user.findUnique({where:{email:'$EMAIL'}}).then(u=>{console.log(u?u.id:'NOTFOUND');process.exit(0)}).catch(()=>process.exit(1))")
echo "userId=$USERID"
echo "$USERID" > /tmp/m27-ui/userid.txt
echo "$EMAIL" > /tmp/m27-ui/email.txt

echo "=== browser: desktop GANGZII ==="
agent-browser set viewport 1440 900
agent-browser open "http://localhost:3100/"
agent-browser wait --load networkidle
# Login through the UI to reach the shell
agent-browser snapshot -i -c 2>/dev/null | head -30
