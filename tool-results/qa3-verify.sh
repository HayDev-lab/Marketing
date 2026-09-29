#!/bin/bash
# Verify round 3: ASR feature (real TTS→ASR loop) + drag-drop week board + styling
cd /home/z/my-project
R=/home/z/my-project/tool-results
LOG=$R/qa3-verify.txt
: > $LOG

# 1. server
setsid bash -c 'exec bun run dev' > /home/z/my-project/dev.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 8)
  [ "$code" = "200" ] && break
done
echo "SERVER READY code=$code" >> $LOG

# 2. register/login QA user → cookie jar
rm -f $R/qa3.cookies
LOGIN=$(curl -s -c $R/qa3.cookies -X POST http://localhost:3000/api/auth -H "content-type: application/json" \
  -d '{"action":"register","email":"qa3@haydev.am","password":"Qa3-Passw0rd!","name":"QA Round 3"}')
echo "REGISTER: $(echo $LOGIN | head -c 120)" >> $LOG
# if user exists → login
if echo "$LOGIN" | rg -q "already|EXISTS|VALIDATION"; then
  LOGIN=$(curl -s -c $R/qa3.cookies -X POST http://localhost:3000/api/auth -H "content-type: application/json" \
    -d '{"action":"login","email":"qa3@haydev.am","password":"Qa3-Passw0rd!"}')
  echo "LOGIN: $(echo $LOGIN | head -c 120)" >> $LOG
fi

# 3. REAL ASR loop: TTS generates audio → feed to ASR → compare text
echo "--- TTS generate ---" >> $LOG
TTS=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/tts -H "content-type: application/json" \
  -d '{"text":"Բարև, աշխարհ։ Սա HayDev Marketing ձայնային թեստն է։","voice":"tongtong","speed":1}')
echo "TTS: $(echo $TTS | head -c 200)" >> $LOG
ASSET_ID=$(echo "$TTS" | sed -n 's/.*"assetId":"\([^"]*\)".*/\1/p')
if [ -n "$ASSET_ID" ]; then
  curl -s -b $R/qa3.cookies "http://localhost:3000/api/assets/$ASSET_ID/raw" -o $R/qa3-tts-audio.wav
  echo "AUDIO: $(stat -c%s $R/qa3-tts-audio.wav 2>/dev/null) bytes" >> $LOG
  B64=$(base64 -w0 $R/qa3-tts-audio.wav)
  echo "--- ASR transcribe (real provider call) ---" >> $LOG
  ASR=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/asr -H "content-type: application/json" \
    -d "{\"base64\":\"$B64\",\"fileName\":\"qa3-tts-audio.wav\",\"sizeBytes\":$(stat -c%s $R/qa3-tts-audio.wav)}")
  echo "ASR: $(echo $ASR | head -c 400)" >> $LOG
else
  echo "TTS FAILED — no assetId" >> $LOG
fi

# 4. invalid-format guard check
echo "--- ASR bad extension guard ---" >> $LOG
BAD=$(curl -s -b $R/qa3.cookies -X POST http://localhost:3000/api/generate/asr -H "content-type: application/json" \
  -d '{"base64":"aGVsbG8=","fileName":"evil.exe"}')
echo "GUARD: $(echo $BAD | head -c 160)" >> $LOG

# 5. browser UI checks
agent-browser open "http://127.0.0.1:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
# inject cookie into browser (register via UI-independent path: use the same session token)
TOKEN=$(rg "haydev_session" $R/qa3.cookies | awk '{print $NF}')
agent-browser eval "document.cookie='haydev_session=$TOKEN; path=/; max-age=604800'" >/dev/null 2>&1

# voice view
agent-browser open "http://127.0.0.1:3000/?view=voice" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2.5
echo "=== VOICE VIEW ===" >> $LOG
agent-browser eval "document.body.innerText.includes('ASR') || document.body.innerText.includes('Տրանսկրիպ') ? 'ASR-CARD-VISIBLE' : 'ASR-MISSING'" 2>&1 | tail -1 >> $LOG
agent-browser eval "!!document.querySelector('.dropzone')" 2>&1 | tail -1 >> $LOG
agent-browser errors 2>&1 | tail -3 >> $LOG
agent-browser screenshot $R/qa3-voice-asr.png >/dev/null 2>&1

# publishing view + drag & drop
agent-browser open "http://127.0.0.1:3000/?view=publishing" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2.5
echo "=== PUBLISHING VIEW ===" >> $LOG
agent-browser eval "document.querySelectorAll('.dropzone').length" 2>&1 | tail -1 >> $LOG
agent-browser eval "[...document.querySelectorAll('button[draggable=\"true\"]')].length + ' draggable chips'" 2>&1 | tail -1 >> $LOG
agent-browser screenshot $R/qa3-weekboard-before.png >/dev/null 2>&1
# BEFORE state via API
echo "--- schedule BEFORE drop ---" >> $LOG
curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule | head -c 400 >> $LOG; echo >> $LOG
# synthetic drag: chip → another day cell
DRAGJS="
(() => {
  const chips = [...document.querySelectorAll('button[draggable=\"true\"]')];
  if (!chips.length) return 'NO-CHIP';
  const chip = chips[0];
  const cells = [...document.querySelectorAll('[role=\"table\"] > div[role=\"row\"]')];
  if (cells.length < 7) return 'NO-CELLS';
  const chipDay = chip.closest('[role=\"row\"]');
  const target = cells.find(c => c !== chipDay) || cells[0];
  const dt = new DataTransfer();
  chip.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true, cancelable: true}));
  target.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
  const wasTarget = target.className.includes('drop-target');
  target.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
  chip.dispatchEvent(new DragEvent('dragend', {dataTransfer: dt, bubbles: true}));
  return 'DROP-DONE highlight-during-dragover=' + wasTarget;
})()
"
echo "--- synthetic drag ---" >> $LOG
agent-browser eval "$DRAGJS" 2>&1 | tail -1 >> $LOG
sleep 3
echo "toast: $(agent-browser eval "[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim().slice(0,80)).join(' | ') || 'none'" 2>&1 | tail -1)" >> $LOG
echo "--- schedule AFTER drop ---" >> $LOG
curl -s -b $R/qa3.cookies http://localhost:3000/api/schedule | head -c 400 >> $LOG; echo >> $LOG
agent-browser screenshot $R/qa3-weekboard-after.png >/dev/null 2>&1
agent-browser errors 2>&1 | tail -3 >> $LOG

# mobile ASR card
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:3000/?view=voice" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser screenshot $R/qa3-voice-mobile.png >/dev/null 2>&1
agent-browser errors 2>&1 | tail -2 >> $LOG

echo "=== DONE ===" >> $LOG
pkill -f "next dev" 2>/dev/null
echo "server stopped" >> $LOG
