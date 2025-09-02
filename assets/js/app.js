/* Weather Caddie – Brookridge CC (MVP)
 * Hyper-local weather → caddie-style tips + compass (wind vs. facing)
 * Drop-in for assets/js/app.js
 */

/** ===== Course config ===== **/
const COURSE = {
  name: "Brookridge CC",
  lat: 38.9430,
  lon: -94.6900,
  elevation_ft: 1050,
  tz: "America/Chicago",
};

// ---- Load hole bearings and yardages from JSON ----
let HOLE_BEARINGS = {};
let HOLE_YARDS = {};

async function loadHoleData() {
  try {
    const resp = await fetch("assets/data/brookridge_holes.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Map hole → bearing, hole → yards
    HOLE_BEARINGS = Object.fromEntries(
      data.holes.map(h => [h.hole, h.bearing_deg])
    );
    HOLE_YARDS = Object.fromEntries(
      data.holes.map(h => [h.hole, h.yards])
    );

    console.log("✅ Hole data loaded", HOLE_BEARINGS, HOLE_YARDS);
  } catch (err) {
    console.error("❌ Failed to load brookridge_holes.json:", err);
    // Fallback: use your hardcoded bearings
    HOLE_BEARINGS = {
      1: 94,  2: 183, 3: 0,   4: 316, 5: 161, 6: 215,
      7: 106, 8: 286, 9: 4,  10: 94, 11: 273, 12: 220,
      13: 262,14: 277,15: 273,16: 76, 17: 2,  18: 116
    };
  }
}

// Heuristic coefficients (tweak after testing)
const COEFF = {
  elev_bonus_pct: Math.round((COURSE.elevation_ft / 1000) * 1.0 * 100) / 100, // ~1% / 1000 ft
  temp_pct_per_10F: 1.0,                 // ±1% per 10°F from 70°F
  wind_pct_per_mph_driver: 0.01 / 5,     // driver: ±1% / 5 mph
  wind_pct_per_mph_7i: 0.007 / 5,        // 7i: ±0.7% / 5 mph
  cross_drift_per200yd_per_mph: 0.7,     // yd drift per mph per 200 yd carry
  slow_green_rain_mm: 0.5,
  slow_green_humidity_pct: 90,
  fast_green_wind_mph: 15,
  fast_green_rh_pct: 50
};

/** ===== Utilities ===== **/
const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };
const deg2rad = (d) => d * Math.PI / 180;
const loadPrefs = () => JSON.parse(localStorage.getItem("wc_prefs") || "{}");
const savePrefs = (p) => localStorage.setItem("wc_prefs", JSON.stringify(p));

/** ===== Weather (Open-Meteo, no key) ===== **/
async function fetchWeather(nextHour = false) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", COURSE.lat);
  url.searchParams.set("longitude", COURSE.lon);
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,precipitation");
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", COURSE.tz);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather fetch failed");
  const data = await res.json();

  let T, RH, WSPD, WDIR, RAIN, stamp;
  if (!nextHour && data.current) {
    T = data.current.temperature_2m;
    RH = data.current.relative_humidity_2m;
    WSPD = data.current.wind_speed_10m;
    WDIR = data.current.wind_direction_10m;   // “from” degrees
    RAIN = data.current.precipitation ?? 0;   // mm last hr
    stamp = data.current.time;
  } else {
    const nowISO = data.current?.time ?? data.hourly.time[0];
    const idxNow = data.hourly.time.indexOf(nowISO);
    const idx = Math.min(Math.max(0, idxNow + 1), data.hourly.time.length - 1);
    T = data.hourly.temperature_2m[idx];
    RH = data.hourly.relative_humidity_2m[idx];
    WSPD = data.hourly.wind_speed_10m[idx];
    WDIR = data.hourly.wind_direction_10m[idx];
    RAIN = data.hourly.precipitation[idx];
    stamp = data.hourly.time[idx];
  }
  return { T, RH, WSPD, WDIR, RAIN, stamp };
}

/** ===== Wind vs hole + heuristics ===== **/
function componentsVsHole(windSpeed, windFromDeg, holeBearingDeg) {
  const toward = (windFromDeg + 180) % 360;   // convert “from” to “toward”
  const theta = deg2rad(toward - holeBearingDeg);
  const head = windSpeed * Math.cos(theta);   // +tail / −head relative to shot
  const cross = windSpeed * Math.sin(theta);  // +R→L / −L→R
  return { head, cross };
}

function carryPct(headCompMph, tempF, club) {
  const tempPct = ((tempF - 70) / 10) * COEFF.temp_pct_per_10F;
  const windCoef = club === "driver" ? COEFF.wind_pct_per_mph_driver : COEFF.wind_pct_per_mph_7i;
  const windPct = headCompMph * windCoef * 100;
  return COEFF.elev_bonus_pct + tempPct + windPct; // total %
}

function crossAimYards(crossMph, shotYards) {
  return crossMph * (shotYards / 200) * COEFF.cross_drift_per200yd_per_mph;
}

function greenNote(rainMM, rhPct, windMph) {
  if (rainMM >= COEFF.slow_green_rain_mm || rhPct >= COEFF.slow_green_humidity_pct) {
    return "Greens likely slower/damp. Favor a firmer strike; add pace.";
  }
  if (windMph >= COEFF.fast_green_wind_mph && rhPct <= COEFF.fast_green_rh_pct) {
    return "Dry & breezy: a bit quicker/firm; expect extra release.";
  }
  return "Typical speeds; trust your usual lines and pace.";
}

/** ===== UI renderers ===== **/
function renderWeather(wx) {
  const { T, RH, WSPD, WDIR, RAIN, stamp } = wx;
  $("wx").innerHTML =
    `<div><b>${COURSE.name}</b> · ${new Date(stamp).toLocaleString()}</div>
     <div>Temp: <b>${round(T,1)}°F</b> · Wind: <b>${round(WSPD,1)} mph</b> @ <b>${Math.round(WDIR)}° (from)</b></div>
     <div>Humidity: <b>${Math.round(RH)}%</b> · Rain (last hr): <b>${round(RAIN,2)} mm</b></div>`;
}

function tipsHtml(hole, bearing, wx, prefs) {
  const { T, RH, WSPD, WDIR, RAIN } = wx;
  const { head, cross } = componentsVsHole(WSPD, WDIR, bearing);

  const driverPct = carryPct(head, T, "driver");
  const ironPct   = carryPct(head, T, "7i");

  const driverAdjYds = prefs.driver * (driverPct / 100);
  const ironAdjYds   = prefs.iron   * (ironPct   / 100);

  const driverAim = crossAimYards(cross, prefs.driver);
  const ironAim   = crossAimYards(cross, prefs.iron);

  const sgn = (v) => (v > 0 ? "+" : "");
  const aimSide = (v) => (v > 0 ? "start it right" : (v < 0 ? "start it left" : "aim straight"));
  const crossTxtDir = cross > 0 ? "R→L" : (cross < 0 ? "L→R" : "none");
  const putt = greenNote(RAIN, RH, WSPD);

  return `
    <p><b>Hole ${hole}</b> (bearing <b>${bearing}°</b>) · Wind vs play:
      <span class="pill">Head/Tail: ${round(head,1)} mph (${head>=0?"tail":"head"})</span>
      <span class="pill">Cross: ${round(Math.abs(cross),1)} mph ${crossTxtDir}</span>
    </p>
    <p><b>Drive (~${prefs.driver} yds carry):</b>
      expect <b>${sgn(round(driverAdjYds))}${round(driverAdjYds)} yds</b>
      (${sgn(round(driverPct,1))}${round(driverPct,1)}%). Crosswind: ${aimSide(driverAim)} ~<b>${round(Math.abs(driverAim))} yds</b>.
    </p>
    <p><b>Approach (7-iron ~${prefs.iron} yds):</b>
      expect <b>${sgn(round(ironAdjYds))}${round(ironAdjYds)} yds</b>
      (${sgn(round(ironPct,1))}${round(ironPct,1)}%). Crosswind: ${aimSide(ironAim)} ~<b>${round(Math.abs(ironAim))} yds</b>.
    </p>
    <p><b>Putt / Greens:</b> ${putt}</p>
    <p class="muted">Tuning: elevation +${COEFF.elev_bonus_pct}% baseline; ±${COEFF.temp_pct_per_10F}% / 10°F; wind sens (driver) ${(COEFF.wind_pct_per_mph_driver*100*5).toFixed(2)}% / 5 mph.</p>
  `;
}

/** ===== Compass helpers (wind vs. facing) ===== **/
let LAST_WX = null; // set after fetching weather

function normalizeDeg(d){ d = d % 360; return d < 0 ? d + 360 : d; }

function relativeWindLabel(delta){
  const a = normalizeDeg(delta); // 0=headwind, 180=tailwind
  const dir =
    (a < 22.5 || a >= 337.5) ? "headwind" :
    (a >= 157.5 && a < 202.5) ? "tailwind" :
    (a >= 67.5 && a < 112.5) ? "from your right" :
    (a >= 247.5 && a < 292.5) ? "from your left" :
    (a > 22.5 && a < 67.5) ? "quartering right" :
    (a > 112.5 && a < 157.5) ? "quartering behind (right)" :
    (a > 202.5 && a < 247.5) ? "quartering behind (left)" :
    "quartering left";
  return { a, dir };
}

function extractHeading(evt){
  if (typeof evt.webkitCompassHeading === "number") return normalizeDeg(evt.webkitCompassHeading);
  if (typeof evt.alpha === "number") {
    const so = (screen.orientation && screen.orientation.angle) ? screen.orientation.angle : 0;
    return normalizeDeg(360 - evt.alpha + so);
  }
  return null;
}

async function enableCompass(){
  // iOS permission prompt
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const resp = await DeviceOrientationEvent.requestPermission();
      if (resp !== "granted") throw new Error("Permission denied");
    } catch (e) {
      alert("Compass permission denied. Settings → Safari → Motion & Orientation Access.");
      return;
    }
  }

  window.addEventListener("deviceorientation", (evt) => {
    const heading = extractHeading(evt);
    if (heading == null) return;

    const windFrom = LAST_WX?.WDIR ?? null; // meteorological "from" deg
    if (windFrom != null) {
      const rel = normalizeDeg(windFrom - heading); // wind-from relative to facing
      const arrow = document.getElementById("windArrow");
      if (arrow) arrow.style.transform = `rotate(${rel}deg)`;
      const { dir } = relativeWindLabel(rel);
      const wspd = LAST_WX?.WSPD != null ? Math.round(LAST_WX.WSPD) : "—";
      const ro = document.getElementById("compassReadout");
      if (ro) ro.textContent = `Facing: ${Math.round(heading)}° • Wind from: ${Math.round(windFrom)}° • ${dir} (${wspd} mph)`;
    }
  }, { passive: true });
}

/** ===== Main flow ===== **/
async function run() {
  // Inputs
  const holeStr = $("hole").value;
  const hole = parseInt(holeStr || "0", 10);
  if (!hole || hole < 1 || hole > 18) {
    $("out").innerHTML = `<p>Please select a hole (1–18).</p>`;
    return;
  }

  const prefs = {
    driver: parseFloat($("driver").value || "250"),
    iron:   parseFloat($("iron").value   || "165"),
    when:   $("when").value
  };

  // Bearing: prefer map value, allow manual override
  let bearing = HOLE_BEARINGS[hole];
  const manual = $("bearing").value;
  if (manual !== "") bearing = clamp(parseFloat(manual), 0, 359);

  // Persist user settings
  savePrefs({ driver: prefs.driver, iron: prefs.iron, lastBearing: bearing });

  // Weather → UI + tips
  $("wx").textContent = "Fetching weather…";
  $("out").innerHTML = `<p>Calculating tips…</p>`;
  const wx = await fetchWeather(prefs.when === "next");
  LAST_WX = wx;              // <-- so compass can use wind
  renderWeather(wx);
  $("out").innerHTML = tipsHtml(hole, bearing, wx, prefs);
}

/** ===== Init ===== **/
(async function init() {
  // Load bearings + yardages before anything else
  await loadHoleData();

  const p = loadPrefs();
  if (p.driver) $("driver").value = p.driver;
  if (p.iron) $("iron").value = p.iron;
  if (p.lastBearing !== undefined) $("bearing").value = p.lastBearing;

  $("hole").addEventListener("change", () => {
    const h = parseInt($("hole").value || "0", 10);
    if (!h) return;
    if ($("bearing").value.trim() === "" && HOLE_BEARINGS[h] != null) {
      $("bearing").value = HOLE_BEARINGS[h];
    }
  });

  $("go").addEventListener("click", async () => {
    try {
      await run();
    } catch (e) {
      $("out").innerHTML = `<p style="color:#b91c1c">Error: ${e.message}</p>`;
    }
  });
})();
