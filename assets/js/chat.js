import { loadProfile } from './store.js';
const byId = (id) => document.getElementById(id);
const log = byId('chatLog');


function addMsg(who, text) {
const div = document.createElement('div');
div.className = `msg ${who}`;
div.textContent = text;
log.appendChild(div);
log.scrollTop = log.scrollHeight;
}


async function replyWithStub(q) {
// Extremely simple canned logic using profile
const prof = await loadProfile('patrick');
const seven = prof.clubs.find(c=>/7\s*iron/i.test(c.name));
if (/7\s*iron/i.test(q) && seven) {
return `Your 7‑iron carry ~${Math.round(seven.average_carry)} yds (±${seven.dispersion}).`;
}
if (/driver/i.test(q)) {
const d = prof.clubs.find(c=>/driver/i.test(c.name));
if (d) return `Driver total ~${Math.round(d.average_total)} yds with typical dispersion ±${d.dispersion}.`;
}
return "Let’s pick a smart target based on your averages and today’s wind. (AI hookup TBD)";
}


// Speech in/out (browser APIs)
let recognizing = false;
let recog;
if ('webkitSpeechRecognition' in window) {
recog = new webkitSpeechRecognition();
recog.lang = 'en-US';
recog.onresult = (e) => {
const txt = e.results[0][0].transcript;
addMsg('me', txt);
replyWithStub(txt).then(t=>{
addMsg('ai', t);
if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(t));
});
};
}


byId('btnMic').addEventListener('click', ()=>{
if (!recog) return alert('Speech API not supported');
if (!recognizing) { recog.start(); recognizing=true; }
});


byId('btnSend').addEventListener('click', async ()=>{
const t = byId('chatText').value.trim();
if (!t) return;
addMsg('me', t);
byId('chatText').value='';
const ans = await replyWithStub(t);
addMsg('ai', ans);
if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(ans));
});