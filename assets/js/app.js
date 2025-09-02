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

    HOLE_BEARINGS = Object.fromEntries(data.holes.map(h => [h.hole, h.bearing_deg]));
    HOLE_YARDS    = Object.fromEntries(data.holes.map(h => [h.hole, h.yards]));

    console.log("✅ Hole data loaded", HOLE_BEARINGS, HOLE_YARDS);
  } catch (err) {
    console.error("❌ Failed to load brookridge_holes.json:", err);
    // Fallback bearings so the app still runs
    HOLE_BEARINGS = {
      1: 94,  2: 183, 3: 0,   4: 316, 5: 161, 6: 215,
      7: 106, 8: 286, 9: 4,  10: 94, 11: 273, 12: 220,
      13: 262,14: 277,15: 273,16: 76, 17: 2,  18: 116
    };
    HOLE_YARDS = {};
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
    <p><b>Hole ${hole}</b> <span class="muted">(bearing <b>${bearing}°</b>)</span> · Wind vs play:
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
// ---------- Compass helpers (cardinals + broadcast-y phrases) ----------
function normalizeDeg(d){ d = d % 360; return d < 0 ? d + 360 : d; }

function toCardinal(deg) {
  const names = ["North","NE","East","SE","South","SW","West","NW"];
  return names[Math.round(normalizeDeg(deg) / 45) % 8];
}

/**
 * Build phrases like:
 *  - "Wind out of the East, off your right"
 *  - "Wind out of the South, at your back"
 *  - "Wind out of the NW, hurting, off your left"
 *
 * heading: where the player/device is facing (0=N)
 * windFrom: meteorological FROM direction in degrees
 */
function golfWindPhrase(heading, windFrom) {
  const windTo   = normalizeDeg(windFrom + 180);           // where the air is going
  const relTo    = normalizeDeg(windTo - heading);         // wind-to relative to player
  const relFrom  = normalizeDeg(windFrom - heading);       // wind-from relative to player

  // Helping / hurting / cross (based on wind-to)
  let primary; // "at your back", "into you", "helping", "hurting", "crosswind"
  if (relTo < 22.5 || relTo >= 337.5) {
    primary = "at your back";                   // strong downwind
  } else if (relTo >= 157.5 && relTo < 202.5) {
    primary = "into you";                       // strong headwind
  } else if ((relTo >= 67.5 && relTo < 112.5) || (relTo >= 247.5 && relTo < 292.5)) {
    primary = "crosswind";                      // near pure cross
  } else if ((relTo >= 22.5 && relTo < 67.5) || (relTo >= 292.5 && relTo < 337.5)) {
    primary = "helping";                        // quartering downwind
  } else { // (112.5–157.5) or (202.5–247.5)
    primary = "hurting";                        // quartering into
  }

  // Side phrase uses wind-FROM relative to facing (announcers say "off the right/left" by origin)
  let side = "";
  if (relFrom >= 67.5 && relFrom < 112.5) side = "off your right";
  else if (relFrom >= 247.5 && relFrom < 292.5) side = "off your left";
  else if ((relFrom > 22.5 && relFrom < 67.5) || (relFrom > 112.5 && relFrom < 157.5)) side = "from the right";
  else if ((relFrom > 202.5 && relFrom < 247.5) || (relFrom > 292.5 && relFrom < 337.5)) side = "from the left";

  // Assemble broadcast-style line
  const fromCard = toCardinal(windFrom);
  let tail;
  if (primary === "crosswind") {
    tail = side || "crosswind";
  } else if (primary === "at your back" || primary === "into you") {
    tail = primary; // no side needed
  } else { // helping/hurting quartering
    tail = side ? `${primary}, ${side}` : primary;
  }

  return { fromCard, windTo, relTo, phrase: `Wind out of the ${fromCard}, ${tail}` };
}

// ---------- Replacement compass listener (arrow = wind-to; text = broadcast phrasing) ----------
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
    // Determine heading (0 = facing North)
    let heading = null;
    if (typeof evt.webkitCompassHeading === "number") {
      heading = normalizeDeg(evt.webkitCompassHeading);
    } else if (typeof evt.alpha === "number") {
      const so = (screen.orientation && screen.orientation.angle) ? screen.orientation.angle : 0;
      heading = normalizeDeg(360 - evt.alpha + so);
    }
    if (heading == null) return;

    const windFrom = LAST_WX?.WDIR;
    const wspd = LAST_WX?.WSPD;

    if (typeof windFrom !== "number") return;

    // Build phrase + rotate arrow to wind-to
    const info = golfWindPhrase(heading, windFrom);
    const arrow = document.getElementById("windArrow");
    if (arrow) arrow.style.transform = `rotate(${info.relTo}deg)`; // arrow points where air is going (downwind)

    const readout = document.getElementById("compassReadout");
    if (readout) {
      const speedTxt = (typeof wspd === "number") ? ` • ${Math.round(wspd)} mph` : "";
      readout.textContent = `${info.phrase}${speedTxt}`;
      // e.g., "Wind out of the East, off your right • 12 mph"
      // or    "Wind out of the South, at your back • 8 mph"
    }
  }, { passive: true });
}


/** ===== Main flow ===== **/
async function run() {
  // Gather inputs
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

  // Bearing strictly from data (no manual override)
  let bearing = HOLE_BEARINGS[hole];
  if (bearing == null) {
    $("out").innerHTML = `<p style="color:#b91c1c">Missing bearing for hole ${hole}. Check assets/data/brookridge_holes.json.</p>`;
    return;
  }
  if ($("bearingView")) $("bearingView").textContent = `${bearing}°`;

  // Persist user settings
  savePrefs({ driver: prefs.driver, iron: prefs.iron, lastBearing: bearing });

  // Weather → UI + tips
  $("wx").textContent = "Fetching weather…";
  $("out").innerHTML = `<p>Calculating tips…</p>`;
  const wx = await fetchWeather(prefs.when === "next");
  LAST_WX = wx;              // compass uses wind
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

  // Update the bearing pill when hole changes
  $("hole").addEventListener("change", () => {
    const h = parseInt($("hole").value || "0", 10);
    if (!h) return;
    const b = HOLE_BEARINGS[h];
    if (b != null && $("bearingView")) $("bearingView").textContent = `${b}°`;
  });

  // Wire buttons
  $("go").addEventListener("click", async () => {
    try {
      await run();
    } catch (e) {
      $("out").innerHTML = `<p style="color:#b91c1c">Error: ${e.message}</p>`;
    }
  });

  // Optional compass button
  document.getElementById("enableCompass")?.addEventListener("click", enableCompass);
})();
