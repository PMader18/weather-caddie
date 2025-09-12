import { loadProfile, setActiveProfileId, getActiveProfileId } from './store.js';


const byId = (id) => document.getElementById(id);
const tbody = document.querySelector('#clubTable tbody');


function renderClubs(profile) {
tbody.innerHTML = '';
profile.clubs.forEach(c => {
const tr = document.createElement('tr');
tr.innerHTML = `<td>${c.name}</td><td>${Math.round(c.average_carry)}</td><td>${Math.round(c.average_total)}</td><td>±${c.dispersion ?? '—'}</td>`;
tbody.appendChild(tr);
});
}


async function init() {
const current = getActiveProfileId();
byId('profileSelect').value = current;
let profile = await loadProfile(current);
renderClubs(profile);


byId('btnLoad').addEventListener('click', async () => {
const id = byId('profileSelect').value;
setActiveProfileId(id);
profile = await loadProfile(id);
renderClubs(profile);
});


byId('btnAddClub').addEventListener('click', () => {
// MVP: only visual
const name = byId('clubName').value || 'Club';
const carry = Number(byId('clubCarry').value || 0);
const total = Number(byId('clubTotal').value || 0);
const disp = Number(byId('clubDisp').value || 0);
const tr = document.createElement('tr');
tr.innerHTML = `<td>${name}</td><td>${carry}</td><td>${total}</td><td>±${disp}</td>`;
tbody.appendChild(tr);
});
}


init();