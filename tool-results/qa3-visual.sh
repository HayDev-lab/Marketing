#!/bin/bash
# Final visual pass: desktop screenshots with tour dismissed
cd /home/z/my-project
R=/home/z/my-project/tool-results
LOG=$R/qa3-visual.txt
: > $LOG

setsid bash -c 'exec bun run dev' > /home/z/my-project/dev.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 8)
  [ "$code" = "200" ] && break
done
echo "SERVER READY code=$code" >> $LOG

rm -f $R/qa3.cookies
curl -s -c $R/qa3.cookies -X POST http://localhost:3000/api/auth -H "content-type: application/json" \
  -d '{"action":"login","email":"qa3@haydev.am","password":"Qa3-Passw0rd!"}' > /dev/null
TOKEN=$(rg "haydev_session" $R/qa3.cookies | awk '{print $NF}')

agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser eval "document.cookie='haydev_session=$TOKEN; path=/; max-age=604800'" >/dev/null 2>&1
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
# dismiss onboarding tour if open (Escape) + set done flag
agent-browser eval "localStorage.setItem('haydev-tour-done','1'); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 'ok'" 2>&1 | tail -1 >> $LOG
sleep 1
agent-browser open "http://127.0.0.1:3000/?view=voice" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
echo "voice view:" >> $LOG
agent-browser errors 2>&1 | tail -2 >> $LOG
agent-browser screenshot $R/qa3-voice-desktop.png >/dev/null 2>&1
agent-browser eval "JSON.stringify({dropzone: !!document.querySelector('.dropzone'), asrBadge: (document.body.innerText.match(/zai-asr · [A-Z_]+/)||[])[0] || 'n/a'})" 2>&1 | tail -1 >> $LOG

agent-browser open "http://127.0.0.1:3000/?view=publishing" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2.5
echo "publishing view:" >> $LOG
agent-browser errors 2>&1 | tail -2 >> $LOG
agent-browser screenshot $R/qa3-week-desktop.png >/dev/null 2>&1
agent-browser eval "JSON.stringify({chips: document.querySelectorAll('button[draggable=true]').length, gripIcons: document.querySelectorAll('.lucide-grip-vertical').length, emptyState: document.body.innerText.includes('—') ? 'dash-present' : 'n/a'})" 2>&1 | tail -1 >> $LOG

echo "=== DONE ===" >> $LOG
pkill -f "next dev" 2>/dev/null
echo "server stopped" >> $LOG
