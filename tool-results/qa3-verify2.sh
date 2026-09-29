#!/bin/bash
# Verify round 3 — part 2: ASR real call (file body) + drag-drop with fresh scheduled post
cd /home/z/my-project
R=/home/z/my-project/tool-results
LOG=$R/qa3-verify2.txt
: > $LOG

# 1. server
setsid bash -c 'exec bun run dev' > /home/z/my-project/dev.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 8)
  [ "$code" = "200" ] && break
done
echo "SERVER READY code=$code" >> $LOG

# 2. login qa3 (exists from part 1)
rm -f $R/qa3.cookies
curl -s -c $R/qa3.cookies -X POST http://localhost:3000/api/auth -H "content-type: application/json" \
  -d '{"action":"login","email":"qa3@haydev.am","password":"Qa3-Passw0rd!"}' > /dev/null
echo "LOGIN done" >> $LOG

# 3. REAL ASR call — body via file to avoid ARG_MAX
if [ ! -s $R/qa3-tts-audio.wav ]; then
  TTS=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/tts -H "content-type: application/json" \
    -d '{"text":"Բարև, աշխարհ։ Սա HayDev Marketing ձայնային թեստն է։","voice":"tongtong","speed":1}')
  ASSET_ID=$(echo "$TTS" | sed -n 's/.*"assetId":"\([^"]*\)".*/\1/p')
  curl -s -b $R/qa3.cookies "http://localhost:3000/api/assets/$ASSET_ID/raw" -o $R/qa3-tts-audio.wav
fi
SZ=$(stat -c%s $R/qa3-tts-audio.wav)
python3 - "$SZ" > $R/qa3-asr-body.json << 'PYEOF'
import base64, json, sys
with open('/home/z/my-project/tool-results/qa3-tts-audio.wav','rb') as f:
    b64 = base64.b64encode(f.read()).decode()
json.dump({"base64": b64, "fileName": "qa3-tts-audio.wav", "sizeBytes": int(sys.argv[1])}, sys.stdout)
PYEOF
echo "--- REAL ASR call (audio ${SZ} bytes) ---" >> $LOG
ASR=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/asr -H "content-type: application/json" --data-binary @$R/qa3-asr-body.json)
echo "ASR RESPONSE: $(echo $ASR | head -c 500)" >> $LOG

# 4. build a scheduled post for qa3 (draft → media → approve → schedule)
BRAND=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/brands -H "content-type: application/json" \
  -d '{"name":"QA3 Brand"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
ITEM=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/content -H "content-type: application/json" \
  -d "{\"title\":\"Drag QA post\",\"brandId\":\"$BRAND\",\"platform\":\"instagram\",\"language\":\"hy\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
ASSET=$(curl -s -b $R/qa3.cookies "http://localhost:3000/api/generate/tts" -X POST -H "content-type: application/json" \
  -d '{"action":"list_voices"}' > /dev/null; \
  curl -s -b $R/qa3.cookies "http://localhost:3000/api/assets" 2>/dev/null | head -c 100)
# reuse the TTS asset for approval media: find its id via jobs → simpler: generate tiny tts again
TTS2=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/tts -H "content-type: application/json" \
  -d '{"text":"քաշելու թեստ","voice":"tongtong","speed":1}')
ASSET_ID2=$(echo "$TTS2" | sed -n 's/.*"assetId":"\([^"]*\)".*/\1/p')
curl -s -b $R/qa3.cookies -X PATCH "http://localhost:3000/api/content/$ITEM" -H "content-type: application/json" \
  -d "{\"assetId\":\"$ASSET_ID2\"}" > /dev/null
curl -s -b $R/qa3.cookies -X POST "http://localhost:3000/api/content/$ITEM/transition" -H "content-type: application/json" -d '{"to":"READY_FOR_REVIEW"}' > /dev/null
curl -s -b $R/qa3.cookies -X POST "http://localhost:3000/api/content/$ITEM/transition" -H "content-type: application/json" -d '{"to":"APPROVED"}' > /dev/null
TOMORROW=$(date -u -d "+1 day 10:00" +%Y-%m-%dT10:00:00.000Z 2>/dev/null || date -u -d "+1 day" +%Y-%m-%d | xargs -I{} echo {}T10:00:00.000Z)
SCHED=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/schedule -H "content-type: application/json" \
  -d "{\"contentItemId\":\"$ITEM\",\"platform\":\"instagram\",\"scheduledAt\":\"$TOMORROW\",\"timezone\":\"Asia/Yerevan\"}")
echo "SCHEDULED: $(echo $SCHED | head -c 260)" >> $LOG
echo "POST_ID=$(echo $SCHED | sed -n 's/.*"post":{"id":"\([^"]*\)".*/\1/p')" >> $LOG

# 5. browser: cookie + publishing + drag
TOKEN=$(rg "haydev_session" $R/qa3.cookies | awk '{print $NF}')
agent-browser open "http://127.0.0.1:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser eval "document.cookie='haydev_session=$TOKEN; path=/; max-age=604800'" >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=publishing" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 3
echo "=== PUBLISHING ===" >> $LOG
agent-browser eval "'chips=' + document.querySelectorAll('button[draggable=\"true\"]').length" 2>&1 | tail -1 >> $LOG
agent-browser eval "[...document.querySelectorAll('button[draggable=\"true\"]')].map(c=>c.getAttribute('aria-label')?.slice(0,40)).join(' | ')" 2>&1 | tail -1 >> $LOG
BEFORE=$(curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule)
echo "BEFORE: $(echo $BEFORE | head -c 220)" >> $LOG
DRAGJS="
(() => {
  const chips = [...document.querySelectorAll('button[draggable=\"true\"]')];
  if (!chips.length) return 'NO-CHIP';
  const chip = chips[0];
  const cells = [...document.querySelectorAll('[role=\"table\"] > div[role=\"row\"]')];
  if (cells.length < 7) return 'NO-CELLS ' + cells.length;
  const chipDay = chip.closest('[role=\"row\"]');
  const target = cells.find(c => c !== chipDay);
  const dt = new DataTransfer();
  chip.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true, cancelable: true}));
  target.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
  const highlight = target.className.includes('drop-target');
  target.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
  chip.dispatchEvent(new DragEvent('dragend', {dataTransfer: dt, bubbles: true}));
  return 'DROP-DONE highlight=' + highlight + ' targetDay=' + target.textContent.slice(0,12);
})()
"
echo "--- synthetic drag ---" >> $LOG
agent-browser eval "$DRAGJS" 2>&1 | tail -1 >> $LOG
sleep 3
echo "toast: $(agent-browser eval "[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim().slice(0,80)).join(' | ') || 'none'" 2>&1 | tail -1)" >> $LOG
AFTER=$(curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule)
echo "AFTER: $(echo $AFTER | head -c 220)" >> $LOG
agent-browser errors 2>&1 | tail -3 >> $LOG
agent-browser screenshot $R/qa3-weekboard-after.png >/dev/null 2>&1

echo "=== DONE ===" >> $LOG
pkill -f "next dev" 2>/dev/null
echo "server stopped" >> $LOG
