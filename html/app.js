/**
 * Statistical monitoring of opportunity for players aged 16 to 23.
 *
 * How to read this file:
 * 1. defines colors, formats and shared state;
 * 2. gathers text, scale and axis helpers;
 * 3. loads the dataset and fills controls and the numbers in the text;
 * 4. draws the generic opening illustration;
 * 5. provides the shared canvas chart layer (canvas, tooltips, clicks and tables);
 * 6–10. draw figures 01 to 05;
 * 11. wires filters, search and resizing.
 *
 * The data comes from html/data/player_opportunity_explorer.json, built by notebook 02.
 */
(() => {
  "use strict";

  // 1. Colors, formats and state
  const COLOR = {
    ink: "#1a1814",
    muted: "#6b6457",
    faint: "#8f8778",
    rule: "#d5cab4",
    grid: "#ebe4d5",
    zero: "#b8ad97",
    dot: "#a39b8b",
    accent: "#06478f",
    red: "#b01f16",
    gold: "#e0a800",
    sheet: "#fbf8f1",
    band: "#f2ecdf",
    bar: "#cdc3ae"
  };
  const FONT = {
    mono: '10px "DM Mono", ui-monospace, monospace',
    monoBold: '500 10px "DM Mono", ui-monospace, monospace',
    label: '600 12px "Instrument Sans", Arial, sans-serif'
  };
  const POSITIONS = [["", "All positions"], ["Goalkeeper", "Goalkeeper"], ["Defender", "Defender"], ["Midfield", "Midfielder"], ["Attack", "Forward"]];
  const DATA_URL = "html/data/player_opportunity_explorer.json";
  const integer = new Intl.NumberFormat("en-US");
  const decimal = (value, digits = 2) => (Number(value) + 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value, digits = 2) => (value > 0 ? "+" : value < 0 ? "−" : "") + decimal(Math.abs(value), digits);
  const percent = (value) => Math.round(value * 100) + "%";
  // Dates as "28 Sep 2020".
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formatDate = (iso) => {
    if (!iso) return "n/a";
    const [year, month, day] = iso.split("-").map(Number);
    return `${day} ${MONTHS[month - 1]} ${year}`;
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    data: null,
    players: [],
    byId: new Map(),
    leagues: [],
    clubs: [],
    watches: [],
    seasons: [],
    active: null,
    trajectoryMode: "signal",
    ageMax: 24
  };
  const $ = (id) => document.getElementById(id);


  // 2. Text, scale and axis helpers
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const positionName = (value) => (POSITIONS.find((p) => p[0] === value) || [0, value || "n/a"])[1];
  // League names come from the dataset; the two "Primera División" share a name, so the country goes in brackets.
  const COUNTRY = { Paraguai: "Paraguay", Uruguai: "Uruguay" };
  const leagueName = (code) => {
    const league = state.leagues.find((item) => item.id === code);
    return league ? league.name.replace(/\s*[—–]\s*(.+)$/, (_, country) => ` (${COUNTRY[country] || country})`) : code || "n/a";
  };
  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const linear = (domain, range) => (value) => range[0] + ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);
  // Rounds the domain to half units and always includes zero.
  const niceDomain = (values, floorMin = 0, ceilMax = 1) => [
    Math.min(floorMin, Math.floor(Math.min(...values) * 2) / 2),
    Math.max(ceilMax, Math.ceil(Math.max(...values) * 2) / 2)
  ];
  const ticks = (min, max, maxCount = 8) => {
    const step = [0.5, 1, 2, 5].find((s) => (max - min) / s <= maxCount) || 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100 + 0);
    return out;
  };

  function decodeHistory(player) {
    const schema = state.data.historySchema || [];
    const monitorIndex = schema.indexOf("monitoring_ewma_x100");
    let cumulative = 0;
    return player.history.map((h) => {
      cumulative += h[4];
      return {
        date: h[0], age: h[1] / 1000, league: state.leagues[h[2]].id, club: state.clubs[h[3]],
        minutes: h[4], percentile: h[6] / 1000, watch: h[10] || 0,
        signal: monitorIndex < 0 || h[monitorIndex] == null ? h[8] / 100 : h[monitorIndex] / 100,
        cumulative
      };
    });
  }

  // Consecutive decisions at the same club and league.
  function spells(rows) {
    const out = [];
    rows.forEach((row, i) => {
      const last = out[out.length - 1];
      if (last && last.club === row.club && last.league === row.league) last.end = i;
      else out.push({ club: row.club, league: row.league, start: i, end: i });
    });
    return out;
  }

  function setStat(name, text) {
    document.querySelectorAll(`[data-stat="${name}"]`).forEach((el) => { el.textContent = text; });
  }


  // 3. Loading the dataset
  fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => document.fonts.ready.then(() => init(data)))
    .catch((error) => {
      console.error(error);
      document.body.classList.remove("loading");
      const box = $("loadError");
      box.hidden = false;
      box.textContent = "The dataset could not be loaded. Serve the page over local HTTP (python3 -m http.server) from the project root.";
      document.querySelectorAll("[data-status]").forEach((el) => { el.textContent = "Data unavailable."; });
    });

  function init(data) {
    state.data = data;
    state.players = data.players;
    state.leagues = data.leagues;
    state.clubs = data.clubs;
    state.watches = data.watches || [];
    state.seasons = data.seasonLeaders || [];
    state.players.forEach((player) => state.byId.set(player.id, player));
    indexWatchSeasons();

    const ranked = state.players.filter((p) => p.score != null);
    const maxAge = Math.max(...ranked.map((p) => p.signalAge), ...state.watches.map((w) => w.age));
    state.ageMax = Math.max(data.meta.maxAge + 1, Math.ceil(maxAge));

    fillControls();
    fillStats(ranked);
    document.body.classList.remove("loading");

    const featured = pickFeatured(ranked);
    updateDistribution();
    populateSeasons();
    populateWatchSeasons();
    updateMoment();
    selectPlayer(featured, false);
    observeResize();

    if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }));
  }

  // Links each watch to its league season, by the date of the watch.
  function indexWatchSeasons() {
    const windows = new Map();
    state.seasons.forEach((row) => {
      const key = row.league + "|" + row.seasonId;
      if (!windows.has(key)) windows.set(key, { league: row.league, label: row.seasonLabel, start: row.seasonStart, end: row.seasonEnd });
    });
    const list = [...windows.values()];
    state.watches.forEach((watch) => {
      const season = list.find((w) => w.league === watch.league && w.start <= watch.date && watch.date <= w.end);
      if (season) Object.assign(watch, { seasonLabel: season.label, seasonStart: season.start });
    });
  }

  function fillControls() {
    const leagues = [...state.leagues].sort((a, b) => leagueName(a.id).localeCompare(leagueName(b.id), "en"));
    const options = leagues.map((l) => `<option value="${esc(l.id)}">${esc(leagueName(l.id))}</option>`).join("");
    $("distLeagues").innerHTML = options;
    document.querySelectorAll("[data-leagues]").forEach((select) => {
      select.innerHTML = (select.dataset.all ? `<option value="">${esc(select.dataset.all)}</option>` : "") + options;
    });
    document.querySelectorAll("[data-positions]").forEach((select) => {
      select.innerHTML = POSITIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    });
    $("seasonLeague").value = state.leagues.some((l) => l.id === "BR-1") ? "BR-1" : state.leagues[0].id;
  }

  // Numbers in the text, always computed from the loaded dataset.
  function fillStats(ranked) {
    const meta = state.data.meta;
    setStat("players", integer.format(meta.target_players));
    setStat("leagues", integer.format(state.leagues.length));
    setStat("watches", integer.format(state.watches.length));

    const top5 = ranked.filter((p) => p.score >= 95);
    setStat("top5", integer.format(top5.length));
    setStat("top5Share", percent(top5.filter((p) => p.signalAge >= 18 && p.signalAge < 21).length / top5.length));

    setStat("watchMinutes", integer.format(Math.round(median(state.watches.map((w) => w.minutes)))));
    setStat("watchAge", decimal(median(state.watches.map((w) => w.age)), 1) + " years");
    setStat("watchRounds", integer.format(Math.round(median(state.watches.map((w) => w.rounds)))) + " decisions");

    const moment = state.players.filter((p) => p.usagePlotEligible && p.watchCount > 0);
    setStat("momentum", integer.format(moment.length));
    setStat("declineShare", percent(moment.filter((p) => p.ewmaChange < 0).length / moment.length));

    const lastTenth = ranked.filter((p) => p.signalAge % 1 >= 0.9).length;
    const firstTenth = ranked.filter((p) => p.signalAge % 1 < 0.1).length;
    setStat("birthdayRatio", decimal(lastTenth / firstTenth, 1) + "×");
  }

  // Featured player: the highest percentile among players with a watch and many decisions.
  function pickFeatured(ranked) {
    const pool = ranked.filter((p) => p.watchCount > 0 && p.rounds >= 80);
    return (pool.length ? pool : ranked).slice().sort((a, b) => b.score - a.score || b.peakEwma - a.peakEwma)[0];
  }


  // 4. Opening illustration
  // A generic, made-up run of decisions (not a real player): cameos, then a breakthrough.
  // The signal and the watch follow the same rules as the study, so the picture stays honest.
  function drawHero() {
    const svg = $("heroArt");
    const minutes = [0, 0, 12, 0, 0, 7, 0, 0, 18, 0, 0, 0, 25, 0, 30, 0, 45, 62, 28, 90, 71, 90, 0, 90, 84, 90, 90, 64, 90, 90,
      90, 90, 78, 90, 0, 90, 90, 90, 90, 90, 67, 90, 90, 90, 90, 90];
    const residual = minutes.map((m) => (m / 90) * 2.2 - 0.8);
    const signal = [];
    residual.forEach((r, i) => signal.push(i ? 0.25 * r + 0.75 * signal[i - 1] : 0.25 * r));
    const watchIndex = residual.findIndex((_, i) => i >= 1 && residual.slice(Math.max(0, i - 2), i + 1).filter((r) => r >= 0.75).length >= 2);
    const W = 560, H = 300, pad = { l: 28, r: 28, t: 34, b: 22 }, barZone = 64;
    const x = linear([0, minutes.length - 1], [pad.l, W - pad.r]);
    const y = linear([-1, 1.5], [H - pad.b - barZone - 18, pad.t]);
    const barBase = H - pad.b;
    const bw = ((W - pad.l - pad.r) / minutes.length) * 0.58;
    let html = `<line x1="${pad.l}" x2="${W - pad.r}" y1="${barBase}" y2="${barBase}" stroke="${COLOR.rule}"/>`;
    minutes.forEach((m, i) => {
      const h = (m / 90) * barZone;
      if (h > 0) html += `<rect x="${x(i) - bw / 2}" y="${barBase - h}" width="${bw}" height="${h}" fill="${COLOR.bar}"/>`;
    });
    const d = signal.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    html += `<path class="draw" d="${d}" fill="none" stroke="${COLOR.accent}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    html += `<circle cx="${x(watchIndex)}" cy="${y(signal[watchIndex])}" r="6.5" fill="${COLOR.gold}" stroke="${COLOR.ink}" stroke-width="1.3"/>`;
    // The line climbs to the right, so the label sits up and to the left of the dot.
    html += watchTag(x(watchIndex), y(signal[watchIndex]) - 8, "EARLY WATCH", 0, 10);
    svg.innerHTML = html;
    const path = svg.querySelector(".draw");
    if (path) path.style.setProperty("--length", Math.ceil(path.getTotalLength()));
  }

  // Watch label on a paper background, so it does not compete with the line.
  function watchTag(px, py, text, width, size) {
    const w = text.length * size * 0.62 + 10;
    const right = px + 12 + w < width;
    const x0 = right ? px + 10 : px - 10 - w;
    const y0 = py - size - 4 < 4 ? py + 10 : py - size - 10;
    return `<rect x="${x0}" y="${y0}" width="${w}" height="${size + 8}" fill="${COLOR.sheet}" stroke="${COLOR.ink}" stroke-width=".8"/>` +
      `<text x="${x0 + 5}" y="${y0 + size + 2}" font-family="DM Mono, monospace" font-size="${size}" letter-spacing=".04em" fill="${COLOR.ink}">${text}</text>`;
  }

  // Marks the start of each calendar year on the decision axis.
  function yearTicks(rows, x, yPos, size) {
    let html = "", lastYear = null, lastX = -Infinity;
    rows.forEach((r, i) => {
      const year = r.date.slice(0, 4);
      if (year !== lastYear) {
        if (x(i) - lastX > 34) {
          html += `<text x="${x(i)}" y="${yPos}" font-family="DM Mono" font-size="${size}" fill="${COLOR.faint}">${year}</text>`;
          lastX = x(i);
        }
        lastYear = year;
      }
    });
    return html;
  }


  // 5. Shared canvas chart layer
  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  // Grid, tick labels and axis titles; returns the scales.
  function drawAxes(ctx, o) {
    const { width, height, pad } = o;
    const x = o.xScale || linear(o.xDomain, [pad.left, width - pad.right]);
    const y = o.yScale || linear(o.yDomain, [height - pad.bottom, pad.top]);
    ctx.font = FONT.mono;
    ctx.lineWidth = 1;
    o.xTicks.forEach((t, i) => {
      const gx = Math.round(x(t.value)) + 0.5;
      ctx.strokeStyle = t.value === 0 && o.zeroX ? COLOR.zero : COLOR.grid;
      ctx.beginPath(); ctx.moveTo(gx, pad.top); ctx.lineTo(gx, height - pad.bottom); ctx.stroke();
      ctx.fillStyle = COLOR.muted;
      ctx.textAlign = i === 0 ? "left" : i === o.xTicks.length - 1 ? "right" : "center";
      ctx.fillText(t.label, gx, height - pad.bottom + 18);
    });
    o.yTicks.forEach((t) => {
      const gy = Math.round(y(t.value)) + 0.5;
      ctx.strokeStyle = t.value === 0 && o.zeroY !== false ? COLOR.zero : COLOR.grid;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(width - pad.right, gy); ctx.stroke();
      ctx.fillStyle = COLOR.muted;
      ctx.textAlign = "right";
      ctx.fillText(t.label, pad.left - 10, gy + 3);
    });
    ctx.font = FONT.monoBold;
    ctx.fillStyle = COLOR.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.xTitle, pad.left + (width - pad.left - pad.right) / 2, height - 6);
    ctx.save();
    ctx.translate(13, pad.top + (height - pad.top - pad.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(o.yTitle, 0, 0);
    ctx.restore();
    return { x, y };
  }

  const ageTicks = () => {
    const out = [];
    for (let a = state.data.meta.minAge; a <= state.ageMax; a++) out.push({ value: a, label: String(a) });
    return out;
  };
  const valueTicks = (domain, signedLabels) => ticks(domain[0], domain[1]).map((v) => ({ value: v, label: (signedLabels && v > 0 ? "+" : "") + decimal(v, v % 1 ? 1 : 0) }));

  function emptyMessage(ctx, width, height, text) {
    ctx.fillStyle = COLOR.muted;
    ctx.font = '13px "Instrument Sans", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(text, width / 2, height / 2);
  }

  // Selected player, marked with a ring.
  function ring(ctx, x, y) {
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = COLOR.ink; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.ink; ctx.fill();
  }

  function placeTooltip(tip, wrap, clientX, clientY) {
    const rect = wrap.getBoundingClientRect();
    const margin = 8, gap = 14;
    tip.style.display = "block";
    const box = tip.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const left = Math.max(margin, Math.min(rect.width - box.width - margin, px - box.width / 2));
    let top = py - box.height - gap;
    if (top < margin) top = py + gap;
    tip.style.left = left + "px";
    tip.style.top = Math.max(margin, Math.min(rect.height - box.height - margin, top)) + "px";
  }

  // Shared interaction: nearest point on hover and click.
  const charts = {};
  function bindChart(key, { canvas, wrap, tip, radius = 12, tooltip }) {
    const chart = { points: [], canvas, wrap, tip };
    const nearest = (event) => {
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left, py = event.clientY - rect.top;
      let best = null, bestD = radius * radius;
      for (const p of chart.points) {
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    };
    canvas.addEventListener("pointermove", (event) => {
      const point = nearest(event);
      canvas.style.cursor = point ? "pointer" : "crosshair";
      if (!point) { tip.style.display = "none"; return; }
      tip.innerHTML = tooltip(point);
      placeTooltip(tip, wrap, event.clientX, event.clientY);
    });
    canvas.addEventListener("pointerleave", () => { tip.style.display = "none"; });
    canvas.addEventListener("click", (event) => {
      const point = nearest(event);
      if (point) selectPlayer(point.player, true);
    });
    charts[key] = chart;
    return chart;
  }

  // Accessible table: keyboard and screen-reader alternative to the chart.
  function renderTable(container, rows, columns) {
    if (!rows.length) { container.innerHTML = '<p class="figure-note" style="padding:14px 18px">No players for these filters.</p>'; return; }
    container.innerHTML = `<table class="data-table"><thead><tr>${columns.map((c) => `<th class="${c.num ? "num" : ""}" scope="col">${c.label}</th>`).join("")}</tr></thead><tbody>${rows.map((row) =>
      `<tr>${columns.map((c, i) => i === 0
        ? `<th scope="row"><button type="button" data-player="${esc(row.player.id)}">${esc(row.player.name)}</button></th>`
        : `<td class="${c.num ? "num" : ""}">${c.value(row)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    container.querySelectorAll("[data-player]").forEach((button) => {
      button.addEventListener("click", () => selectPlayer(state.byId.get(button.dataset.player), true));
    });
  }


  // 6. Figure 01: age and value of the highest signal
  const dist = { rows: [], highlight: [] };
  bindChart("dist", {
    canvas: $("distCanvas"), wrap: $("distWrap"), tip: $("distTip"), radius: 10,
    tooltip: ({ player: p }) => `<b>${esc(p.name)}</b>${esc(positionName(p.position))} · ${esc(p.signalClub)}<br>${esc(leagueName(p.signalLeague))}<br><span class="mono">peak at ${decimal(p.signalAge, 1)} · signal ${decimal(p.peakEwma)} · percentile ${decimal(p.score, 1)}</span>`
  });

  function updateDistribution() {
    const mode = $("distHighlight").value, position = $("distPosition").value;
    const isHighlighted = mode === "top5" ? (p) => p.score >= 95 : mode === "top1" ? (p) => p.score >= 99 : (p) => p.signalLeague === mode;
    dist.rows = state.players.filter((p) => p.score != null && Number.isFinite(p.peakEwma) && (!position || p.position === position));
    dist.highlight = dist.rows.filter(isHighlighted);
    const label = mode === "top5" ? "Top 5% signals" : mode === "top1" ? "Top 1% signals" : leagueName(mode);
    $("distLegend").innerHTML = `<span class="key"><i class="blue"></i>${esc(label)} (${integer.format(dist.highlight.length)})</span><span class="key"><i class="grey"></i>Other players (${integer.format(dist.rows.length - dist.highlight.length)})</span>`;
    renderTable($("distTable"), dist.highlight.slice().sort((a, b) => b.peakEwma - a.peakEwma).slice(0, 25).map((player) => ({ player })), [
      { label: "Player" },
      { label: "League at peak", value: (r) => esc(leagueName(r.player.signalLeague)) },
      { label: "Club at peak", value: (r) => esc(r.player.signalClub) },
      { label: "Age", num: true, value: (r) => decimal(r.player.signalAge, 1) },
      { label: "Signal", num: true, value: (r) => decimal(r.player.peakEwma) },
      { label: "Percentile", num: true, value: (r) => decimal(r.player.score, 1) }
    ]);
    drawDistribution();
  }

  function drawDistribution() {
    if (!state.data) return;
    const chart = charts.dist;
    const { ctx, width, height } = prepareCanvas(chart.canvas);
    const pad = { left: 56, right: 18, top: 14, bottom: 44 };
    const yDomain = niceDomain(state.players.filter((p) => p.score != null).map((p) => p.peakEwma));
    const { x, y } = drawAxes(ctx, {
      width, height, pad, xDomain: [state.data.meta.minAge, state.ageMax], yDomain,
      xTicks: ageTicks(), yTicks: valueTicks(yDomain),
      xTitle: "AGE AT HIGHEST SIGNAL (YEARS)", yTitle: "HIGHEST OPPORTUNITY SIGNAL"
    });
    const highlighted = new Set(dist.highlight);
    chart.points = [];
    ctx.fillStyle = COLOR.dot;
    ctx.globalAlpha = 0.28;
    dist.rows.forEach((p) => {
      if (highlighted.has(p)) return;
      const px = x(p.signalAge), py = y(p.peakEwma);
      ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
      chart.points.push({ x: px, y: py, player: p });
    });
    ctx.fillStyle = COLOR.accent;
    ctx.globalAlpha = dist.highlight.length > 1500 ? 0.45 : 0.75;
    dist.highlight.forEach((p) => {
      const px = x(p.signalAge), py = y(p.peakEwma);
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      chart.points.push({ x: px, y: py, player: p });
    });
    ctx.globalAlpha = 1;
    const active = state.active && dist.rows.includes(state.active) ? state.active : null;
    if (active) ring(ctx, x(active.signalAge), y(active.peakEwma));
  }


  // 7. Figure 02: leaders of one league and season
  const season = { rows: [] };
  bindChart("season", {
    canvas: $("seasonCanvas"), wrap: $("seasonWrap"), tip: $("seasonTip"), radius: 12,
    tooltip: ({ player: p, row }) => `<b>#${row.rank} · ${esc(p.name)}</b>${esc(positionName(row.position))} · ${esc(row.club)} · ${esc(row.seasonLabel)}<br><span class="mono">signal ${decimal(row.peakEwma)} at ${decimal(row.peakAge, 1)} · ${formatDate(row.peakDate)}<br>${integer.format(row.minutes)} min in ${integer.format(row.decisions)} decisions</span>`
  });

  function populateSeasons() {
    const league = $("seasonLeague").value, previous = $("seasonSelect").value;
    const seen = new Map();
    state.seasons.forEach((row) => { if (row.league === league && !seen.has(row.seasonId)) seen.set(row.seasonId, row); });
    const ordered = [...seen.values()].sort((a, b) => b.seasonStart.localeCompare(a.seasonStart));
    $("seasonSelect").innerHTML = ordered.map((r) => `<option value="${esc(r.seasonId)}">${esc(r.seasonLabel)}${r.ongoing ? " (ongoing)" : ""}</option>`).join("");
    if (seen.has(previous)) $("seasonSelect").value = previous;
    updateSeason();
  }

  function updateSeason() {
    const league = $("seasonLeague").value, id = $("seasonSelect").value, position = $("seasonPosition").value;
    season.rows = state.seasons
      .filter((r) => r.league === league && r.seasonId === id && (!position || r.position === position) && state.byId.has(r.playerId))
      .sort((a, b) => a.rank - b.rank)
      .map((row, i) => ({ row, player: state.byId.get(row.playerId), order: i + 1 }));
    renderTable($("seasonTable"), season.rows.slice(0, 25), [
      { label: "Player" },
      { label: "Club", value: (r) => esc(r.row.club) },
      { label: "Position", value: (r) => esc(positionName(r.row.position)) },
      { label: "Age", num: true, value: (r) => decimal(r.row.peakAge, 1) },
      { label: "Signal", num: true, value: (r) => decimal(r.row.peakEwma) },
      { label: "Minutes", num: true, value: (r) => integer.format(r.row.minutes) }
    ]);
    drawSeason();
  }

  function drawSeason() {
    if (!state.data) return;
    const chart = charts.season;
    const { ctx, width, height } = prepareCanvas(chart.canvas);
    chart.points = [];
    if (!season.rows.length) { emptyMessage(ctx, width, height, "No eligible players for these filters."); return; }
    const pad = { left: 56, right: 18, top: 16, bottom: 44 };
    const yDomain = niceDomain(season.rows.map((r) => r.row.peakEwma));
    const { x, y } = drawAxes(ctx, {
      width, height, pad, xDomain: [state.data.meta.minAge, state.ageMax], yDomain,
      xTicks: ageTicks(), yTicks: valueTicks(yDomain),
      xTitle: "AGE AT SEASON PEAK (YEARS)", yTitle: "HIGHEST SIGNAL IN THE SEASON"
    });
    // Grey first, highlights on top.
    season.rows.slice().reverse().forEach((item) => {
      const top = item.order <= 5;
      const px = x(item.row.peakAge), py = y(item.row.peakEwma);
      ctx.globalAlpha = top ? 1 : 0.55;
      ctx.fillStyle = top ? COLOR.accent : COLOR.dot;
      ctx.beginPath(); ctx.arc(px, py, top ? 5 : 3.2, 0, Math.PI * 2); ctx.fill();
      chart.points.push({ x: px, y: py, player: item.player, row: item.row });
    });
    ctx.globalAlpha = 1;
    labelLeaders(ctx, season.rows.slice(0, 5).map((item) => ({ x: x(item.row.peakAge), y: y(item.row.peakEwma), text: `${item.order}. ${item.player.name}` })), width, pad);
    const active = season.rows.find((r) => r.player === state.active);
    if (active) ring(ctx, x(active.row.peakAge), y(active.row.peakEwma));
  }

  // Direct labels, pushed down when they collide.
  function labelLeaders(ctx, labels, width, pad) {
    ctx.font = FONT.label;
    const placed = [];
    labels.sort((a, b) => a.y - b.y).forEach((l) => {
      const w = ctx.measureText(l.text).width;
      const right = l.x + 10 + w < width - pad.right;
      let ly = l.y + 4;
      const lx = right ? l.x + 10 : l.x - 10 - w;
      while (placed.some((p) => Math.abs(p.y - ly) < 15 && lx < p.x + p.w && lx + w > p.x)) ly += 15;
      placed.push({ x: lx, y: ly, w });
      ctx.fillStyle = "rgba(251,248,241,.85)";
      ctx.fillRect(lx - 3, ly - 11, w + 6, 15);
      ctx.fillStyle = COLOR.ink;
      ctx.textAlign = "left";
      ctx.fillText(l.text, lx, ly);
    });
  }


  // 8. Figure 03: individual trajectory
  function selectPlayer(player, scroll) {
    if (!player) return;
    state.active = player;
    $("playerSearch").value = player.name;
    closeSearch();
    document.querySelectorAll("[data-status]").forEach((el) => {
      el.innerHTML = `<a href="#trajectory-section">${esc(player.name)} selected · see the trajectory</a>`;
    });
    renderProfile(player);
    drawDistribution();
    drawSeason();
    drawWatches();
    drawMoment();
    if (scroll) $("trajectory-section").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  function renderProfile(player) {
    const rows = decodeHistory(player);
    const played = rows.filter((r) => r.minutes > 0).length;
    const watch = rows.find((r) => r.watch);
    const allSpells = spells(rows);
    const moves = allSpells.slice(1).map((s, i) => {
      const prev = allSpells[i];
      return `<span class="move"><b>${esc(prev.club)} → ${esc(s.club)}</b> · ${s.league !== prev.league ? esc(leagueName(s.league)) + " · " : ""}age ${decimal(rows[s.start].age, 1)} · ${formatDate(rows[s.start].date)}</span>`;
    });
    const first = formatDate(rows[0].date), last = formatDate(rows[rows.length - 1].date);
    $("profile").innerHTML = `
      <div class="profile-head">
        <div>
          <h3>${esc(player.name)}</h3>
          <p class="profile-meta">${esc(positionName(player.position))} · ${esc(player.club)} · ${esc(leagueName(player.league))}</p>
          <p class="profile-context label">Highest signal: ${esc(player.signalClub)} · age ${decimal(player.signalAge, 1)} · ${formatDate(player.signalDate)}</p>
        </div>
        <div class="signal-score"><strong>${decimal(player.score, 1)}</strong><span class="label">percentile of highest signal</span></div>
      </div>
      <div class="metrics">
        <div class="metric"><strong>${integer.format(player.minutes)}</strong><span class="label">minutes played</span></div>
        <div class="metric"><strong>${integer.format(rows.length)}</strong><span class="label">observed decisions</span></div>
        <div class="metric"><strong>${integer.format(played)}</strong><span class="label">decisions with minutes</span></div>
        <div class="metric"><strong>${watch ? "Age " + decimal(watch.age, 1) : "—"}</strong><span class="label">${watch ? `early watch · ${integer.format(watch.cumulative)} min` : "no early watch"}</span></div>
      </div>
      <p class="profile-note"><strong>Observed decisions only.</strong> The player got minutes in ${integer.format(played)} of ${integer.format(rows.length)} decisions. Injuries and declared absences are left out of the line and do not count as zero.</p>
      <div class="trajectory-head">
        <div>
          <h4>${state.trajectoryMode === "signal" ? "Opportunity signal" : "Cumulative minutes"} · ${first} to ${last}</h4>
          <p>Hover over the chart, or focus it and use the arrow keys, to read each decision.</p>
        </div>
        <div class="view-toggle" role="group" aria-label="Trajectory measure">
          <button type="button" data-mode="signal" aria-pressed="${state.trajectoryMode === "signal"}">Signal</button>
          <button type="button" data-mode="cumulative" aria-pressed="${state.trajectoryMode === "cumulative"}">Cumulative minutes</button>
        </div>
      </div>
      <div class="trajectory" id="trajectoryWrap">
        <svg id="trajectory" tabindex="0" role="img" aria-label="Trajectory of ${esc(player.name)}: ${rows.length} decisions between ${first} and ${last}; highest signal ${decimal(player.peakEwma)} at age ${decimal(player.signalAge, 1)}${watch ? `; early watch at age ${decimal(watch.age, 1)}` : ""}."></svg>
        <div class="tooltip" id="trajectoryTip" role="status"></div>
      </div>
      <div class="moves">${moves.join("") || '<span class="move">A single club in the observed window.</span>'}</div>`;
    $("profile").querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.trajectoryMode = button.dataset.mode;
        renderProfile(player);
      });
    });
    drawTrajectory(rows);
  }

  function drawTrajectory(rows) {
    const svg = $("trajectory"), wrap = $("trajectoryWrap"), tip = $("trajectoryTip");
    if (!svg || !rows.length) return;
    const W = Math.max(320, wrap.clientWidth), H = Math.max(240, wrap.clientHeight);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const cumulative = state.trajectoryMode === "cumulative";
    const pad = { l: 58, r: 20, t: 34, b: 30 }, barZone = 56;
    const plotBottom = H - pad.b - barZone - 12;
    const values = rows.map((r) => (cumulative ? r.cumulative : r.signal));
    let yDomain, yTicks;
    if (cumulative) {
      const max = Math.max(90, ...values);
      const step = [90, 180, 450, 900, 1800, 2700, 4500, 9000].find((s) => max / s <= 5) || 18000;
      yDomain = [0, Math.ceil(max / step) * step];
      yTicks = [];
      for (let v = 0; v <= yDomain[1]; v += step) yTicks.push(v);
    } else {
      yDomain = niceDomain(values, -1, 1);
      yTicks = ticks(yDomain[0], yDomain[1], 6);
    }
    const x = linear([0, Math.max(1, rows.length - 1)], [pad.l, W - pad.r]);
    const y = linear(yDomain, [plotBottom, pad.t]);
    const step = (W - pad.l - pad.r) / Math.max(1, rows.length - 1);
    const mono = 'font-family="DM Mono, monospace"';
    let html = "";

    // Alternating bands per club spell, named when the name fits.
    spells(rows).forEach((s, i) => {
      const x0 = s.start === 0 ? pad.l : x(s.start) - step / 2;
      const x1 = s.end === rows.length - 1 ? W - pad.r : x(s.end) + step / 2;
      if (i % 2) html += `<rect x="${x0}" y="${pad.t - 22}" width="${x1 - x0}" height="${H - pad.b - pad.t + 22}" fill="${COLOR.band}"/>`;
      if (i) html += `<line x1="${x0}" x2="${x0}" y1="${pad.t - 22}" y2="${H - pad.b}" stroke="${COLOR.rule}"/>`;
      const name = s.club.length > 26 ? s.club.slice(0, 25) + "…" : s.club;
      if (x1 - x0 > name.length * 6.4 + 14) html += `<text x="${x0 + 7}" y="${pad.t - 8}" ${mono} font-size="10" fill="${COLOR.muted}">${esc(name.toUpperCase())}</text>`;
    });
    yTicks.forEach((t) => {
      html += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 && !cumulative ? COLOR.zero : COLOR.grid}"/>`;
      html += `<text x="${pad.l - 10}" y="${y(t) + 3}" text-anchor="end" ${mono} font-size="10" fill="${COLOR.muted}">${cumulative ? integer.format(t) : decimal(t, t % 1 ? 1 : 0)}</text>`;
    });
    // Minutes per decision in their own strip, below the line.
    const barBase = H - pad.b;
    const bw = Math.max(1, step * 0.62);
    html += `<text x="${pad.l - 10}" y="${barBase - barZone + 8}" text-anchor="end" ${mono} font-size="9" fill="${COLOR.faint}">90'</text>`;
    html += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${barBase}" y2="${barBase}" stroke="${COLOR.rule}"/>`;
    rows.forEach((r, i) => {
      const h = Math.min(1, r.minutes / 90) * barZone;
      if (h > 0) html += `<rect x="${x(i) - bw / 2}" y="${barBase - h}" width="${bw}" height="${h}" fill="${COLOR.bar}"/>`;
    });
    html += yearTicks(rows, x, H - 9, 10);
    const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join("");
    if (cumulative) html += `<path d="${line}L${x(rows.length - 1)},${plotBottom}L${x(0)},${plotBottom}Z" fill="${COLOR.accent}" opacity=".07"/>`;
    html += `<path d="${line}" fill="none" stroke="${COLOR.accent}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const w = rows.findIndex((r) => r.watch);
    if (w >= 0) {
      html += `<line x1="${x(w)}" x2="${x(w)}" y1="${pad.t}" y2="${barBase}" stroke="${COLOR.ink}" stroke-dasharray="2 4" opacity=".55"/>`;
      html += `<circle cx="${x(w)}" cy="${y(values[w])}" r="6" fill="${COLOR.gold}" stroke="${COLOR.ink}" stroke-width="1.3"/>`;
      html += watchTag(x(w), y(values[w]) + 24, `EARLY WATCH · AGE ${decimal(rows[w].age, 1)}`, W - pad.r, 10);
    }
    const last = rows.length - 1;
    html += `<circle cx="${x(last)}" cy="${y(values[last])}" r="3.5" fill="${COLOR.accent}"/>`;
    html += `<g id="trajCursor" visibility="hidden"><line y1="${pad.t}" y2="${barBase}" stroke="${COLOR.ink}" opacity=".35"/><circle r="4.5" fill="${COLOR.sheet}" stroke="${COLOR.ink}" stroke-width="1.5"/></g>`;
    svg.innerHTML = html;

    // Reading each decision, by pointer or keyboard.
    const cursor = svg.querySelector("#trajCursor");
    let current = last;
    const show = (index, clientX, clientY) => {
      current = Math.max(0, Math.min(last, index));
      const r = rows[current];
      cursor.setAttribute("visibility", "visible");
      cursor.querySelector("line").setAttribute("x1", x(current));
      cursor.querySelector("line").setAttribute("x2", x(current));
      cursor.querySelector("circle").setAttribute("cx", x(current));
      cursor.querySelector("circle").setAttribute("cy", y(values[current]));
      tip.innerHTML = `<b>${formatDate(r.date)} · age ${decimal(r.age, 1)}</b>${esc(r.club)} · ${esc(leagueName(r.league))}<br><span class="mono">${r.minutes > 0 ? `${r.minutes} min this round` : "no minutes this round"} · ${integer.format(r.cumulative)} cumulative<br>signal ${decimal(r.signal)}${r.watch ? " · early watch" : ""}</span>`;
      const rect = svg.getBoundingClientRect();
      placeTooltip(tip, wrap, clientX ?? rect.left + x(current) * (rect.width / W), clientY ?? rect.top + y(values[current]) * (rect.height / H));
    };
    const hide = () => { cursor.setAttribute("visibility", "hidden"); tip.style.display = "none"; };
    svg.onpointermove = (event) => {
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * W;
      show(Math.round((px - pad.l) / step), event.clientX, event.clientY);
    };
    svg.onpointerleave = hide;
    svg.onblur = hide;
    svg.onfocus = () => show(current);
    svg.onkeydown = (event) => {
      const jump = { ArrowLeft: -1, ArrowRight: 1, PageDown: 10, PageUp: -10 }[event.key];
      if (jump) { event.preventDefault(); show(current + jump); }
      if (event.key === "Home") { event.preventDefault(); show(0); }
      if (event.key === "End") { event.preventDefault(); show(last); }
      if (event.key === "Escape") hide();
    };
  }

  // Search by name or club.
  function renderSearch() {
    const query = fold($("playerSearch").value.trim());
    const results = $("searchResults");
    if (query.length < 2) { closeSearch(); return; }
    const matches = state.players
      .filter((p) => p.score != null && fold(p.name + " " + p.club).includes(query))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    results.innerHTML = matches.length
      ? matches.map((p) => `<button class="search-row" type="button" role="option" data-id="${esc(p.id)}"><span><strong>${esc(p.name)}</strong><span>${esc(positionName(p.position))} · ${esc(p.club)} · ${esc(leagueName(p.league))}</span></span><code>p${decimal(p.score, 1)}</code></button>`).join("")
      : '<div class="search-row"><span>No players found.</span></div>';
    results.classList.add("open");
    $("playerSearch").setAttribute("aria-expanded", "true");
    results.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => selectPlayer(state.byId.get(button.dataset.id), false));
    });
  }
  function closeSearch() {
    $("searchResults").classList.remove("open");
    $("playerSearch").setAttribute("aria-expanded", "false");
  }


  // 9. Figure 04: first early watch
  const watch = { rows: [] };
  bindChart("watch", {
    canvas: $("watchCanvas"), wrap: $("watchWrap"), tip: $("watchTip"), radius: 10,
    tooltip: ({ player: p, watch: w }) => `<b>${esc(p.name)}</b>${esc(w.club)} · ${esc(leagueName(w.league))} · ${esc(w.seasonLabel || "season n/a")}<br><span class="mono">watch at ${decimal(w.age, 1)} · ${formatDate(w.date)}<br>${integer.format(w.minutes)} min in ${integer.format(w.rounds)} decisions</span>`
  });

  function populateWatchSeasons() {
    const league = $("watchLeague").value, previous = $("watchSeason").value;
    const seen = new Map();
    state.watches.forEach((w) => {
      if ((league && w.league !== league) || !w.seasonLabel) return;
      const cur = seen.get(w.seasonLabel);
      if (!cur || w.seasonStart > cur) seen.set(w.seasonLabel, w.seasonStart);
    });
    const ordered = [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1]) || b[0].localeCompare(a[0]));
    $("watchSeason").innerHTML = '<option value="">All seasons</option>' + ordered.map(([label]) => `<option value="${esc(label)}">${esc(label)}</option>`).join("");
    if (seen.has(previous)) $("watchSeason").value = previous;
    updateWatches();
  }

  function updateWatches() {
    const league = $("watchLeague").value, label = $("watchSeason").value, position = $("watchPosition").value;
    watch.rows = state.watches
      .map((w) => ({ watch: w, player: state.byId.get(w.playerId) }))
      .filter(({ watch: w, player }) => player && (!league || w.league === league) && (!label || w.seasonLabel === label) && (!position || player.position === position));
    renderTable($("watchTable"), watch.rows.slice().sort((a, b) => a.watch.age - b.watch.age).slice(0, 25), [
      { label: "Player" },
      { label: "Club", value: (r) => esc(r.watch.club) },
      { label: "League", value: (r) => esc(leagueName(r.watch.league)) },
      { label: "Age", num: true, value: (r) => decimal(r.watch.age, 1) },
      { label: "Minutes", num: true, value: (r) => integer.format(r.watch.minutes) },
      { label: "Decisions", num: true, value: (r) => integer.format(r.watch.rounds) }
    ]);
    drawWatches();
  }

  function drawWatches() {
    if (!state.data) return;
    const chart = charts.watch;
    const { ctx, width, height } = prepareCanvas(chart.canvas);
    chart.points = [];
    if (!watch.rows.length) { emptyMessage(ctx, width, height, "No watches for these filters."); return; }
    const pad = { left: 62, right: 18, top: 16, bottom: 44 };
    const maxMinutes = Math.max(90, ...state.watches.map((w) => w.minutes));
    const logMax = Math.log1p(maxMinutes * 1.05);
    const y = (v) => pad.top + (1 - Math.log1p(Math.max(0, v)) / logMax) * (height - pad.top - pad.bottom);
    const yTicks = [0, 10, 30, 90, 180, 360, 720, 1440, 2880, 5760].filter((v) => v <= maxMinutes * 1.05).map((v) => ({ value: v, label: integer.format(v) }));
    const { x } = drawAxes(ctx, {
      width, height, pad, xDomain: [state.data.meta.minAge, state.ageMax], yScale: y,
      xTicks: ageTicks(), yTicks, zeroY: false,
      xTitle: "AGE AT EARLY WATCH (YEARS)", yTitle: "MINUTES BEFORE THE WATCH (LOG)"
    });
    ctx.fillStyle = COLOR.accent;
    ctx.globalAlpha = watch.rows.length > 2000 ? 0.28 : 0.55;
    watch.rows.forEach((r) => {
      const px = x(r.watch.age), py = y(r.watch.minutes);
      ctx.beginPath(); ctx.arc(px, py, 2.3, 0, Math.PI * 2); ctx.fill();
      chart.points.push({ x: px, y: py, player: r.player, watch: r.watch });
    });
    ctx.globalAlpha = 1;
    // Medians of the current filter, as direct annotations.
    const mMin = median(watch.rows.map((r) => r.watch.minutes)), mAge = median(watch.rows.map((r) => r.watch.age));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLOR.ink;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y(mMin)); ctx.lineTo(width - pad.right, y(mMin)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x(mAge), pad.top); ctx.lineTo(x(mAge), height - pad.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = FONT.label;
    const tag = (text, tx, ty, align) => {
      ctx.textAlign = align;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(251,248,241,.9)";
      ctx.fillRect(align === "right" ? tx - w - 4 : tx - 4, ty - 12, w + 8, 16);
      ctx.fillStyle = COLOR.ink;
      ctx.fillText(text, tx, ty);
    };
    tag(`Median: ${integer.format(Math.round(mMin))} min`, width - pad.right - 6, y(mMin) - 6, "right");
    tag(`Median: age ${decimal(mAge, 1)}`, x(mAge) + 6, pad.top + 12, "left");
    const active = watch.rows.find((r) => r.player === state.active);
    if (active) ring(ctx, x(active.watch.age), y(active.watch.minutes));
  }


  // 10. Figure 05: recent movement after the watch
  const moment = { rows: [], all: [] };
  bindChart("moment", {
    canvas: $("momentCanvas"), wrap: $("momentWrap"), tip: $("momentTip"), radius: 12,
    tooltip: ({ player: p }) => `<b>${esc(p.name)}</b>${esc(p.club)} · ${esc(leagueName(p.league))} · age ${decimal(p.ageAtCutoff, 1)}<br><span class="mono">highest signal ${decimal(p.peakEwma)} · percentile ${decimal(p.score, 1)}<br>signal ${decimal(p.previousEwma)} → ${decimal(p.currentEwma)} (${signed(p.ewmaChange)})<br>last 5: ${integer.format(p.recent5Minutes)} of ${integer.format(p.recent5Available)} min</span>`
  });

  function updateMoment() {
    const league = $("momentLeague").value, position = $("momentPosition").value, mode = $("momentState").value;
    moment.all = state.players.filter((p) => p.usagePlotEligible && Number.isFinite(p.ewmaChange) && Number.isFinite(p.peakEwma));
    moment.rows = moment.all
      .filter((p) => p.watchCount > 0 && (!league || p.league === league) && (!position || p.position === position))
      .filter((p) => (mode === "growth" ? p.ewmaChange > 0 : mode === "decline" ? p.ewmaChange < 0 : mode === "unused" ? p.recent5Minutes === 0 : true))
      .sort((a, b) => Math.abs(a.ewmaChange) - Math.abs(b.ewmaChange));
    renderTable($("momentTable"), moment.rows.slice().reverse().slice(0, 25).map((player) => ({ player })), [
      { label: "Player" },
      { label: "Current club", value: (r) => esc(r.player.club) },
      { label: "Age", num: true, value: (r) => decimal(r.player.ageAtCutoff, 1) },
      { label: "Highest signal", num: true, value: (r) => decimal(r.player.peakEwma) },
      { label: "Change", num: true, value: (r) => signed(r.player.ewmaChange) },
      { label: "Min. in last 5", num: true, value: (r) => `${integer.format(r.player.recent5Minutes)} / ${integer.format(r.player.recent5Available)}` }
    ]);
    drawMoment();
  }

  function drawMoment() {
    if (!state.data) return;
    const chart = charts.moment;
    const { ctx, width, height } = prepareCanvas(chart.canvas);
    chart.points = [];
    if (!moment.rows.length) { emptyMessage(ctx, width, height, "No players for these filters."); return; }
    const pad = { left: 56, right: 18, top: 16, bottom: 44 };
    // Scales fixed by the full set, so filters stay comparable.
    const xDomain = niceDomain(moment.all.map((p) => p.peakEwma));
    const yDomain = niceDomain(moment.all.map((p) => p.ewmaChange), -1, 1);
    const { x, y } = drawAxes(ctx, {
      width, height, pad, xDomain, yDomain, zeroX: true,
      xTicks: valueTicks(xDomain), yTicks: valueTicks(yDomain, true),
      xTitle: "HIGHEST CAREER SIGNAL", yTitle: "CHANGE OVER THE LAST 5 DECISIONS"
    });
    ctx.font = FONT.monoBold;
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR.accent;
    ctx.fillText("▲ RISING", pad.left + 10, pad.top + 14);
    ctx.fillStyle = COLOR.red;
    ctx.fillText("▼ FALLING", pad.left + 10, height - pad.bottom - 10);
    moment.rows.forEach((p) => {
      const unused = 1 - Math.max(0, Math.min(1, p.recentUsage || 0));
      const px = x(p.peakEwma), py = y(p.ewmaChange);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.ewmaChange >= 0 ? COLOR.accent : COLOR.red;
      ctx.beginPath(); ctx.arc(px, py, 2 + unused * 3.6, 0, Math.PI * 2); ctx.fill();
      chart.points.push({ x: px, y: py, player: p });
    });
    ctx.globalAlpha = 1;
    const active = moment.rows.includes(state.active) ? state.active : null;
    if (active) ring(ctx, x(active.peakEwma), y(active.ewmaChange));
  }


  // 11. Filters, search and resizing
  $("distHighlight").addEventListener("change", updateDistribution);
  $("distPosition").addEventListener("change", updateDistribution);
  $("seasonLeague").addEventListener("change", populateSeasons);
  $("seasonSelect").addEventListener("change", updateSeason);
  $("seasonPosition").addEventListener("change", updateSeason);
  $("watchLeague").addEventListener("change", populateWatchSeasons);
  $("watchSeason").addEventListener("change", updateWatches);
  $("watchPosition").addEventListener("change", updateWatches);
  $("momentLeague").addEventListener("change", updateMoment);
  $("momentPosition").addEventListener("change", updateMoment);
  $("momentState").addEventListener("change", updateMoment);

  $("playerSearch").addEventListener("input", renderSearch);
  $("playerSearch").addEventListener("keydown", (event) => {
    const first = $("searchResults").querySelector("[data-id]");
    if (event.key === "Enter" && first) { event.preventDefault(); first.click(); }
    if (event.key === "ArrowDown" && first) { event.preventDefault(); first.focus(); }
    if (event.key === "Escape") closeSearch();
  });
  $("searchResults").addEventListener("keydown", (event) => {
    const items = [...$("searchResults").querySelectorAll("[data-id]")];
    const i = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" && i < items.length - 1) { event.preventDefault(); items[i + 1].focus(); }
    if (event.key === "ArrowUp") { event.preventDefault(); (i > 0 ? items[i - 1] : $("playerSearch")).focus(); }
    if (event.key === "Escape") { closeSearch(); $("playerSearch").focus(); }
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".search")) closeSearch(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelectorAll(".plot .tooltip").forEach((tip) => { tip.style.display = "none"; });
  });

  // Redraws each chart only when its own container changes size.
  function observeResize() {
    const redraw = { distWrap: drawDistribution, seasonWrap: drawSeason, watchWrap: drawWatches, momentWrap: drawMoment };
    let frame = null;
    const pending = new Set();
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => pending.add(entry.target.id));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        pending.forEach((id) => redraw[id]?.());
        pending.clear();
      });
    });
    Object.keys(redraw).forEach((id) => observer.observe($(id)));
    // The trajectory is rebuilt on every selection, so observe its stable parent.
    let width = $("profile").clientWidth;
    new ResizeObserver(() => {
      if ($("profile").clientWidth === width || !state.active || !$("trajectoryWrap")) return;
      width = $("profile").clientWidth;
      drawTrajectory(decodeHistory(state.active));
    }).observe($("profile"));
  }

  // The opening illustration needs no data, so it draws immediately.
  drawHero();
})();
