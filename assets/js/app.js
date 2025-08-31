/* Weather Caddie – Brookridge CC (MVP)
 * Hyper-local weather → caddie-style tips (drive, approach, putt)
 * Drop-in for assets/js/app.js
 */

/** CONFIG: Course & physics heuristics **/
const COURSE = {
  name: "Brookridge CC",
  // Approx clubhouse coords; adjust if you want to use a specific mid-course lat/lon:
  lat: 38.9430,
  lon: -94.6900,
  elevation_ft: 1050, // ~Overland Park; used for baseline carry bonus
  tz: "America/Chicago",
};

// Per-hole tee→green bearing in degrees (0=N, 90=E, 180=S, 270=W).
// ⚠️ These are *placeholder* bearings. Replace with real values.
// Tip to capture real bearings is below.
const HOLE_BEARINGS = {
  1: 45,  2: 120, 3: 200, 4: 310, 5: 135, 6: 270,
  7: 85,  8: 160, 9: 340, 10: 25, 11: 190, 12: 255,
  13: 100,14: 150,15: 210,16: 300,17: 60, 18: 330
};

// Heuristic tuning (easy to tweak after a few rounds)
const COEFF = {
  elev_bonus_pct: Math.round((COURSE.elevation_ft / 1000) * 1.0 * 100) / 100, // ≈1% per 1000 ft
  temp_pct_per_10F: 1.0,            // % carry change per 10°F from 70°F
  wind_pct_per_mph_driver: 0.01/5,   // % per mph tail/head for driver (tail=+)
  wind_pct_per_mph_7i: 0.007/5,      // % per mph for 7-iron
  cross_drift_per200yd_per_mph: 0.7, // yards of drift per mph per 200 yds of carry
  slow_green_rain_mm: 0.5,           // rain in last hour considered “wet”
  slow_green_humidity_pct: 90,       // RH threshold for dew/slow
  fast_green_wind_mph: 15,           // dry & windy → a bit quicker/firm
  fast_green_rh_pct: 50
};

/** Utilities **/
const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round = (v, d=0) => { const f = 10**d; return Math.round(v*f)/f; };
const deg2rad = (d) => d * Math.PI / 180;
const loadPrefs = () => JSON.parse(localStorage.getItem("wc_prefs") || "{}");
const savePrefs = (p) => localStorage.setItem("wc_prefs", JSON.stringify(p));

/** Weather fetch (Open-Meteo, no key) **/
async function fetchWeather(nextHour=false) {
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
    T    = data.current.temperature_2m;
    RH   = data.current.relative_humidity_2m;
    WSPD = data.current.wind_speed_10m;
    WDIR = data.current.wind_direction_10m;   // “from” direction in °
    RAIN = data.current.precipitation ?? 0;   // last hour, mm
    stamp = data.current.time;
  } else {
    const nowISO = data.current?.time ?? data.hourly.time[0];
    const idxNow = data.hourly.time.indexOf(nowISO);
    const idx = Math.min(Math.max(0, idxNow + 1), data.hourly.time.length - 1);
    T    = data.hourly.temperature_2m[idx];
    RH   = data.hourly.relative_humidity_2m[idx];
    WSPD = data.hourly.wind_speed_10m[idx];
    WDIR = data.hourly.wind_direction_10m[idx];
    RAIN = data.hourly.precipitation[idx];
    stamp = data.hourly.time[idx];
  }

  return { T, RH, WSPD, WDIR, RAIN, stamp };
}

/** Wind vs. hole math **/
function componentsVsHole(windSpeed, windFromDeg, holeBearingDeg) {
  // Convert “from” to a vector blowing toward:
  const toward = (windFromDeg + 180) % 360;
  const theta = deg2rad(toward - holeBearingDeg);
  const head = windSpeed * Math.cos(theta);   // + = tailwind, − = headwind
  const cross = windSpeed * Math.sin(theta);  // + = R→L, − = L→R (relative to shot)
  return { head, cross };
}

function carryPct(headCompMph, tempF, club) {
  const elevPct = COEFF.elev_bonus_pct;
  const tempPct = ((tempF - 70) / 10) * COEFF.temp_pct_per_10F;
  const windCoef = club === "driver" ? COEFF.wind_pct_per_mph_driver : COEFF.wind_pct_per_mph_7i;
  const windPct = headCompMph * windCoef * 100; // positive with tailwind
  return elevPct + tempPct + windPct;           // % total
}

function crossAimYards(crossMph, shotYards) {
  return crossMph * (shotYards / 200) * COEFF.cross_drift_per200yd_per_mph;
}

function greenNote(rainMM, rhPct, windMph) {
  if (rainMM >= COEFF.slow_green_rain_mm || rhPct >= COEFF.slow_green_humidity_pct) {
    return "Greens likely slower/damp. Favor a firmer strike; add pace on uphill putts.";
  }
  if (windMph >= COEFF.fast_green_wind_mph && rhPct <= COEFF.fast_green_rh_pct) {
    return "Surfaces a bit quicker/firm; expect a touch more release on approaches.";
  }
  return "Typical speeds for here; read your usual lines and pace.";
}

/** UI helpers **/
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

  const sgn = v => (v > 0 ? "+" : "");
  const aimSide = v => v > 0 ? "start it right" : (v < 0 ? "start it left" : "aim straight");
  const crossTxtDir = cross > 0 ? "R→L" : (cross < 0 ? "L→R" : "none");

  const putt = greenNote(RAIN, RH, WSPD);

  return `
    <p><b>Hole ${hole}</b> (bearing <b>${bearing}°</b>) · Wind vs play:
      <span class="pill">Head/Tail: ${round(head,1)} mph (${head>=0?"tail":"head"})</span>
      <span class="pill">Cross: ${round(Math.abs(cross),1)} mph ${crossTxtDir}</span>
    </p>
    <p><b>Drive (~${prefs.driver} yds carry):</b>
      expect <b>${sgn(round(driverAdjYds))}${round(driverAdjYds)} yds</b> change
      (${sgn(round(driverPct,1))}${round(driverPct,1)}%). Crosswind: ${aimSide(driverAim)} by ~<b>${round(Math.abs(driverAim))} yds</b>.
    </p>
    <p><b>Approach (7-iron ~${prefs.iron} yds):</b>
      expect <b>${sgn(round(ironAdjYds))}${round(ironAdjYds)} yds</b>
      (${sgn(round(ironPct,1))}${round(ironPct,1)}%). Crosswind: ${aimSide(ironAim)} by ~<b>${round(Math.abs(ironAim))} yds</b>.
    </p>
    <p><b>Putt / Greens:</b> ${putt}</p>
    <p class="muted">Tip tuning: elevation +${COEFF.elev_bonus_pct}% baseline; ±${COEFF.temp_pct_per_10F}% per 10°F; wind sensitivity driver=${(COEFF.wind_pct_per_mph_driver*100*5).toFixed(2)}%/5mph, 7i=${(COEFF.wind_pct_per_mph_7i*100*5).toFixed(2)}%/5mph.</p>
  `;
}

/** Main flow **/
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

  // Bearing: prefer saved map, allow manual override field (if user typed it)
  let bearing = HOLE_BEARINGS[hole];
  const manual = $("bearing").value;
  if (manual !== "") bearing = clamp(parseFloat(manual), 0, 359);

  // persist carries + last bearing for convenience
  savePrefs({ driver: prefs.driver, iron: prefs.iron, lastBearing: bearing });

  // Fetch weather
  $("wx").textContent = "Fetching weather…";
  $("out").innerHTML = `<p>Calculating tips…</p>`;
  const wx = await fetchWeather(prefs.when === "next");
  renderWeather(wx);

  // Render tips
  $("out").innerHTML = tipsHtml(hole, bearing, wx, prefs);
}

/** Wire up UI **/
(function init() {
  const p = loadPrefs();
  if (p.driver) $("driver").value = p.driver;
  if (p.iron) $("iron").value = p.iron;
  if (p.lastBearing !== undefined) $("bearing").value = p.lastBearing;

  // convenience: autofill bearing from map when hole changes (but don’t override manual)
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
