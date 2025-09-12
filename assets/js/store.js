const WC_STORE_KEY = "wc_state_v1";
export const loadState = () => JSON.parse(localStorage.getItem(WC_STORE_KEY) || "{}");
export const saveState = (s) => localStorage.setItem(WC_STORE_KEY, JSON.stringify(s));


export function getActiveProfileId() {
const s = loadState();
return s.activeProfile || "patrick";
}
export function setActiveProfileId(id) {
const s = loadState();
s.activeProfile = id;
saveState(s);
}


export async function loadProfile(profileId) {
if (profileId === "patrick") {
const r = await fetch("assets/data/player_profile/patrick.json", { cache: "no-store" });
return r.json();
}
// default fallback
return { owner: "default", clubs: [ { name: "7 iron", average_carry: 155, average_total: 165, dispersion: 8 } ] };
}


export async function loadCourse(courseId = "brookridge") {
const r = await fetch("assets/data/course_brookridge.json", { cache: "no-store" });
return r.json();
}