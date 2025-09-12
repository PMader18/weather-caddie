import { loadCourse, loadProfile, saveState, loadState, getActiveProfileId } from './store.js';


const byId = (id) => document.getElementById(id);


async function init() {
const course = await loadCourse('brookridge');
const tees = course.tees;
const teeSel = byId('teeSelect');
tees.forEach((t, i) => {
const opt = document.createElement('option');
opt.value = i;
const totalYds = t.holes.reduce((a,h)=>a+(h.yardage||0),0);
opt.textContent = `${t.name} — ${totalYds} yds`;
teeSel.appendChild(opt);
});


byId('btnBegin').addEventListener('click', async () => {
const teeIdx = Number(teeSel.value || 0);
const goal = Number(byId('goalScore').value || 0);
const plan = byId('threeHolePlan').value || '';
const profile = await loadProfile(getActiveProfileId());


const state = loadState();
state.activeRound = {
startedAt: new Date().toISOString(),
course: course.course,
tee: tees[teeIdx].name,
holes: tees[teeIdx].holes,
goalScore: goal,
planFirst3: plan,
profileSummary: { owner: profile.owner, clubs: profile.clubs.length }
};
saveState(state);
// Navigate to quick caddie page (existing index.html)
window.location.href = 'index.html';
});
}


init();