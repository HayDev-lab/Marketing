#!/bin/bash
# QA mega-run: start dev server, sweep all views via agent-browser, collect console/errors, stop server
cd /home/z/my-project
LOG=/home/z/my-project/tool-results/qa3-results.txt
: > $LOG

# 1. start server
setsid bash -c 'exec bun run dev' > /home/z/my-project/dev.log 2>&1 < /dev/null &
SERVER_PID=$!
for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 8)
  [ "$code" = "200" ] && break
done
echo "SERVER READY code=$code after ~$((i*2))s" >> $LOG

# 2. browser sweep
agent-browser open "http://127.0.0.1:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 3
VIEWS="dashboard brands trends planner content image video voice prompts publishing analytics settings mcp"
for v in $VIEWS; do
  agent-browser open "http://127.0.0.1:3000/?view=$v" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 1.5
  echo "=== VIEW $v ===" >> $LOG
  echo "--- errors:" >> $LOG
  agent-browser errors 2>&1 | tail -3 >> $LOG
  echo "--- console(err|warn):" >> $LOG
  agent-browser console 2>&1 | rg -i "error|warn" | tail -5 >> $LOG || echo "(clean)" >> $LOG
  # page render sanity: main heading text
  agent-browser eval "document.querySelector('main h1,h2')?.textContent?.trim()?.slice(0,60) || 'NO-HEADING'" 2>&1 | tail -1 >> $LOG
done

# 3. viewport sanity check (mobile)
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
echo "=== MOBILE 390x844 dashboard ===" >> $LOG
agent-browser errors 2>&1 | tail -3 >> $LOG
agent-browser eval "!!document.querySelector('button[aria-label*=menu], button[aria-label*=Menu]')" 2>&1 | tail -1 >> $LOG

# screenshots
agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser screenshot /home/z/my-project/tool-results/qa3-dashboard.png >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=publishing" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser screenshot /home/z/my-project/tool-results/qa3-publishing.png >/dev/null 2>&1

echo "=== DONE ===" >> $LOG
# 4. stop server
kill -- -$(ps -o pgid= -p $SERVER_PID | tr -d ' ') 2>/dev/null
pkill -f "next dev" 2>/dev/null
echo "server stopped" >> $LOG
