#!/bin/bash
# Verify round 3 — part 3: drag-drop retest after dataTransfer fix
cd /home/z/my-project
R=/home/z/my-project/tool-results
LOG=$R/qa3-verify3.txt
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

BEFORE=$(curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule | sed -n 's/.*"scheduledAt":"\([^"]*\)".*/\1/p')
echo "BEFORE scheduledAt: $BEFORE" >> $LOG

TOKEN=$(rg "haydev_session" $R/qa3.cookies | awk '{print $NF}')
agent-browser open "http://127.0.0.1:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser eval "document.cookie='haydev_session=$TOKEN; path=/; max-age=604800'" >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=publishing" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 3

# async drag sequence: dragstart → wait 100ms → dragover → wait 100ms → drop (lets React flush state)
DRAGJS="
(async () => {
  const chips = [...document.querySelectorAll('button[draggable=\"true\"]')];
  if (!chips.length) return 'NO-CHIP';
  const chip = chips[0];
  const cells = [...document.querySelectorAll('[role=\"table\"] > div[role=\"row\"]')];
  if (cells.length < 7) return 'NO-CELLS ' + cells.length;
  const chipDay = chip.closest('[role=\"row\"]');
  const target = cells.find(c => c !== chipDay);
  const dt = new DataTransfer();
  chip.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true, cancelable: true}));
  await new Promise(r => setTimeout(r, 120));
  target.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
  await new Promise(r => setTimeout(r, 120));
  const highlight = target.className.includes('drop-target');
  target.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
  chip.dispatchEvent(new DragEvent('dragend', {dataTransfer: dt, bubbles: true}));
  return 'DROP-DONE highlight=' + highlight + ' targetDay=' + target.textContent.slice(0, 12);
})()
"
echo "--- async synthetic drag ---" >> $LOG
agent-browser eval "$DRAGJS" 2>&1 | tail -1 >> $LOG
sleep 3
echo "toast: $(agent-browser eval "[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim().slice(0,80)).join(' | ') || 'none'" 2>&1 | tail -1)" >> $LOG
AFTER=$(curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule | sed -n 's/.*"scheduledAt":"\([^"]*\)".*/\1/p')
echo "AFTER scheduledAt: $AFTER" >> $LOG
[ "$BEFORE" != "$AFTER" ] && echo "DRAG-RESCHEDULE: OK (date changed)" >> $LOG || echo "DRAG-RESCHEDULE: FAILED (unchanged)" >> $LOG
agent-browser errors 2>&1 | tail -3 >> $LOG
agent-browser screenshot $R/qa3-weekboard-after.png >/dev/null 2>&1

# voice view final check with real file selection is browser-fileless; verify dropzone accepts DataTransfer file drop guard (bad type toast)
agent-browser open "http://127.0.0.1:3000/?view=voice" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
VJS="
(async () => {
  const dz = document.querySelector('.dropzone');
  if (!dz) return 'NO-DROPZONE';
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(8)], 'bad.txt', {type: 'text/plain'}));
  dz.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
  dz.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
  await new Promise(r => setTimeout(r, 400));
  const toasts = [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent.trim().slice(0, 60)).join(' | ');
  return 'DROPFILE toast=' + (toasts || 'none');
})()
"
echo "--- dropzone file-guard test ---" >> $LOG
agent-browser eval "$VJS" 2>&1 | tail -1 >> $LOG
agent-browser errors 2>&1 | tail -3 >> $LOG
agent-browser screenshot $R/qa3-voice-final.png >/dev/null 2>&1

echo "=== DONE ===" >> $LOG
pkill -f "next dev" 2>/dev/null
echo "server stopped" >> $LOG
