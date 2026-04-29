// ==UserScript==
// @name         Morning 10-Point Hunter PRO
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  NSE Morning Option Hunter | Manual Time Filter | Refresh | TradingView Links
// @match        *://www.nseindia.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

/* =====================================================
    ⚙️ SETTINGS
===================================================== */
const CONFIG = {
    refreshMs: 300000,      // 5 min
    minPrice: 950,
    gainerPct: 2.7,
    loserPct: -2.7,
    topCount: 8
};

/* =====================================================
    🧠 MEMORY
===================================================== */
let historyMap = {};
let firstSeenMap = {};
let prevChangeMap = {};
let prevPriceMap = {};
let todayKey = new Date().toDateString();

/* =====================================================
    🔄 RESET DAILY
===================================================== */
function resetDaily() {
    const now = new Date().toDateString();
    if (now !== todayKey) {
        historyMap = {};
        firstSeenMap = {};
        prevChangeMap = {};
        prevPriceMap = {};
        todayKey = now;
    }
}

/* =====================================================
    ⏰ TIME FILTER (9:15 - 11:00)
===================================================== */
function inTradeWindow() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const start = 9 * 60 + 15;
    const end = 11 * 60;
    return mins >= start && mins <= end;
}

/* =====================================================
    🕒 ACTIVE TIME
===================================================== */
function activeMinutes(symbol) {
    if (!firstSeenMap[symbol]) return 0;
    return Math.floor((Date.now() - firstSeenMap[symbol]) / 60000);
}

function formatTime(symbol) {
    const mins = activeMinutes(symbol);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/* =====================================================
    📊 SCORE (15 MAX)
===================================================== */
function score(item, isGainer) {
    let s = 0;
    const prev = prevChangeMap[item.symbol] || item.perChange;
    const prevPrice = prevPriceMap[item.symbol] || item.ltp;
    const count = historyMap[item.symbol] || 0;
    const mins = activeMinutes(item.symbol);

    if (Math.abs(item.perChange) > 5) s += 4;
    else if (Math.abs(item.perChange) > 4) s += 3;
    else if (Math.abs(item.perChange) > 3) s += 2;
    else s += 1;

    if (isGainer && item.perChange > prev) s += 4;
    if (!isGainer && item.perChange < prev) s += 4;

    if (isGainer && item.ltp > prevPrice) s += 3;
    if (!isGainer && item.ltp < prevPrice) s += 3;

    if (count >= 3) s += 2;
    else if (count >= 2) s += 1;

    if (mins >= 5 && mins <= 30) s += 2;
    return s;
}

function getStatus(s, mins) {
    if (mins > 60) return "LATE";
    if (s >= 11) return "READY";
    if (s >= 8) return "WATCH";
    if (s >= 5) return "WEAK";
    return "SKIP";
}

/* =====================================================
    🎯 OPTION PLAN
===================================================== */
function plan(item, isGainer) {
    const ltp = Number(item.ltp);
    return {
        type: isGainer ? "CE" : "PE",
        trigger: isGainer ? `Above ${ltp}` : `Below ${ltp}`,
        sl: isGainer ? (ltp - 6).toFixed(1) : (ltp + 6).toFixed(1),
        target: "+10"
    };
}

/* =====================================================
    📡 NSE API
===================================================== */
async function fetchData(type) {
    const url = type === "g"
        ? "https://www.nseindia.com/api/live-analysis-variations?index=gainers"
        : "https://www.nseindia.com/api/live-analysis-variations?index=loosers";

    const res = await fetch(url, {
        headers: {
            accept: "application/json",
            referer: "https://www.nseindia.com/"
        },
        credentials: "include"
    });
    const data = await res.json();
    return data.FOSec?.data || [];
}

/* =====================================================
    🎨 UI
===================================================== */
function createUI() {
    if (document.getElementById("hunterPanel")) return;

    const panel = document.createElement("div");
    panel.id = "hunterPanel";
    panel.style = `
        position:fixed;
        top:20px;
        right:20px;
        width:1150px;
        background:#111;
        color:#fff;
        z-index:999999;
        border-radius:12px;
        padding:12px;
        font-family:Arial;
        max-height:90vh;
        overflow:auto;
        box-shadow:0 0 20px rgba(0,0,0,.45);
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <h2>🔥 Morning 10-Point Hunter PRO</h2>
            <div style="display:flex;align-items:center;gap:10px;">
                <label style="font-size:13px;">
                    <input type="checkbox" id="timeFilter" checked>
                    Use 9:15-11 Filter
                </label>
                <button id="rf">🔄</button>
                <button id="cl">✖</button>
            </div>
        </div>
        <div id="hunterBody">Loading...</div>
    `;

    document.body.appendChild(panel);
    document.getElementById("rf").onclick = runHunter;
    document.getElementById("cl").onclick = () => panel.remove();
}

function rowColor(status) {
    if (status === "READY") return "#123d12";
    if (status === "WATCH") return "#5a4700";
    if (status === "WEAK") return "#333";
    if (status === "LATE") return "#4a1414";
    return "#222";
}

function table(title, rows) {
    let html = `
    <h3>${title}</h3>
    <table width="100%" style="font-size:12px;border-collapse:collapse;">
    <tr>
        <th>#</th>
        <th>Stock</th>
        <th>Price</th>
        <th>%</th>
        <th>Score</th>
        <th>Stay</th>
        <th>Type</th>
        <th>Trigger</th>
        <th>SL</th>
        <th>Target</th>
        <th>Status</th>
        <th>Chart</th>
    </tr>`;

    rows.forEach((x, i) => {
        // TradingView Dynamic Link
        const chartLink = `https://in.tradingview.com/chart/?symbol=NSE:${x.symbol}`;

        html += `
        <tr style="background:${rowColor(x.status)}">
            <td>${i + 1}</td>
            <td>${x.symbol}</td>
            <td>₹${x.price}</td>
            <td>${x.perChange}%</td>
            <td>${x.score}/15</td>
            <td>${x.time}</td>
            <td>${x.type}</td>
            <td>${x.trigger}</td>
            <td>${x.sl}</td>
            <td>${x.target}</td>
            <td>${x.status}</td>
            <td>
                <a href="${chartLink}" target="_blank" style="color:#38bdf8;text-decoration:none;font-weight:bold;">
                   📈 View
                </a>
            </td>
        </tr>`;
    });

    html += "</table>";
    return html;
}

/* =====================================================
    🚀 MAIN
===================================================== */
async function runHunter() {
    try {
        resetDaily();
        createUI();

        const body = document.getElementById("hunterBody");
        const useFilter = document.getElementById("timeFilter")?.checked;

        if (useFilter && !inTradeWindow()) {
            body.innerHTML = `
                <div style="padding:20px;color:#ffcc66;">
                    Time Filter Active.<br>
                    Scanner works between 9:15 AM - 11:00 AM<br><br>
                    Uncheck box to scan anytime.
                </div>
            `;
            return;
        }

        const [gainers, losers] = await Promise.all([
            fetchData("g"),
            fetchData("l")
        ]);

        let ce = [];
        let pe = [];

        gainers
        .filter(x => x.ltp > CONFIG.minPrice && x.perChange > CONFIG.gainerPct)
        .forEach(x => {
            if (!firstSeenMap[x.symbol]) firstSeenMap[x.symbol] = Date.now();
            historyMap[x.symbol] = (historyMap[x.symbol] || 0) + 1;
            const sc = score(x, true);
            const mins = activeMinutes(x.symbol);

            ce.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                time: formatTime(x.symbol),
                status: getStatus(sc, mins),
                ...plan(x, true)
            });

            prevChangeMap[x.symbol] = x.perChange;
            prevPriceMap[x.symbol] = x.ltp;
        });

        losers
        .filter(x => x.ltp > CONFIG.minPrice && x.perChange < CONFIG.loserPct)
        .forEach(x => {
            if (!firstSeenMap[x.symbol]) firstSeenMap[x.symbol] = Date.now();
            historyMap[x.symbol] = (historyMap[x.symbol] || 0) + 1;
            const sc = score(x, false);
            const mins = activeMinutes(x.symbol);

            pe.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                time: formatTime(x.symbol),
                status: getStatus(sc, mins),
                ...plan(x, false)
            });

            prevChangeMap[x.symbol] = x.perChange;
            prevPriceMap[x.symbol] = x.ltp;
        });

        ce.sort((a,b)=>b.score-a.score);
        pe.sort((a,b)=>b.score-a.score);

        body.innerHTML = `
            <div style="margin-bottom:10px;color:#aaa;">
                Updated: ${new Date().toLocaleTimeString()} |
                Auto Refresh: 5 Min |
                Strategy: Exit +10 Points
            </div>
            ${ce.length > 0 ? table("🟢 CE Fast Movers", ce.slice(0, CONFIG.topCount)) : "<p>No CE candidates found.</p>"}
            ${pe.length > 0 ? table("🔴 PE Fast Movers", pe.slice(0, CONFIG.topCount)) : "<p>No PE candidates found.</p>"}
        `;

    } catch (e) {
        console.error(e);
        const body = document.getElementById("hunterBody");
        if (body) body.innerHTML = "Error loading data.";
    }
}

/* =====================================================
    ▶ START
===================================================== */
runHunter();
setInterval(runHunter, CONFIG.refreshMs);

})();
// ==UserScript==
// @name         Morning 10-Point Hunter PRO
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  NSE Morning Option Hunter | Manual Time Filter | Refresh | Close
// @match        *://www.nseindia.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

/* =====================================================
   ⚙️ SETTINGS
===================================================== */
const CONFIG = {
    refreshMs: 300000,      // 5 min
    minPrice: 950,
    gainerPct: 2.7,
    loserPct: -2.7,
    topCount: 8
};

/* =====================================================
   🧠 MEMORY
===================================================== */
let historyMap = {};
let firstSeenMap = {};
let prevChangeMap = {};
let prevPriceMap = {};
let todayKey = new Date().toDateString();

/* =====================================================
   🔄 RESET DAILY
===================================================== */
function resetDaily() {
    const now = new Date().toDateString();

    if (now !== todayKey) {
        historyMap = {};
        firstSeenMap = {};
        prevChangeMap = {};
        prevPriceMap = {};
        todayKey = now;
    }
}

/* =====================================================
   ⏰ TIME FILTER (9:15 - 11:00)
===================================================== */
function inTradeWindow() {

    const now = new Date();

    const mins = now.getHours() * 60 + now.getMinutes();

    const start = 9 * 60 + 15;
    const end = 11 * 60;

    return mins >= start && mins <= end;
}

/* =====================================================
   🕒 ACTIVE TIME
===================================================== */
function activeMinutes(symbol) {
    if (!firstSeenMap[symbol]) return 0;

    return Math.floor((Date.now() - firstSeenMap[symbol]) / 60000);
}

function formatTime(symbol) {

    const mins = activeMinutes(symbol);

    const h = Math.floor(mins / 60);
    const m = mins % 60;

    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/* =====================================================
   📊 SCORE (15 MAX)
===================================================== */
function score(item, isGainer) {

    let s = 0;

    const prev = prevChangeMap[item.symbol] || item.perChange;
    const prevPrice = prevPriceMap[item.symbol] || item.ltp;
    const count = historyMap[item.symbol] || 0;
    const mins = activeMinutes(item.symbol);

    // % strength
    if (Math.abs(item.perChange) > 5) s += 4;
    else if (Math.abs(item.perChange) > 4) s += 3;
    else if (Math.abs(item.perChange) > 3) s += 2;
    else s += 1;

    // momentum
    if (isGainer && item.perChange > prev) s += 4;
    if (!isGainer && item.perChange < prev) s += 4;

    // price trend
    if (isGainer && item.ltp > prevPrice) s += 3;
    if (!isGainer && item.ltp < prevPrice) s += 3;

    // repeat appearance
    if (count >= 3) s += 2;
    else if (count >= 2) s += 1;

    // sweet zone
    if (mins >= 5 && mins <= 30) s += 2;

    return s;
}

function getStatus(s, mins) {

    if (mins > 60) return "LATE";

    if (s >= 11) return "READY";
    if (s >= 8) return "WATCH";
    if (s >= 5) return "WEAK";

    return "SKIP";
}

/* =====================================================
   🎯 OPTION PLAN
===================================================== */
function plan(item, isGainer) {

    const ltp = Number(item.ltp);

    return {
        type: isGainer ? "CE" : "PE",
        trigger: isGainer ? `Above ${ltp}` : `Below ${ltp}`,
        sl: isGainer ? (ltp - 6).toFixed(1) : (ltp + 6).toFixed(1),
        target: "+10"
    };
}

/* =====================================================
   📡 NSE API
===================================================== */
async function fetchData(type) {

    const url = type === "g"
        ? "https://www.nseindia.com/api/live-analysis-variations?index=gainers"
        : "https://www.nseindia.com/api/live-analysis-variations?index=loosers";

    const res = await fetch(url, {
        headers: {
            accept: "application/json",
            referer: "https://www.nseindia.com/"
        },
        credentials: "include"
    });

    const data = await res.json();

    return data.FOSec?.data || [];
}

/* =====================================================
   🎨 UI
===================================================== */
function createUI() {

    if (document.getElementById("hunterPanel")) return;

    const panel = document.createElement("div");
    panel.id = "hunterPanel";

    panel.style = `
        position:fixed;
        top:20px;
        right:20px;
        width:1120px;
        background:#111;
        color:#fff;
        z-index:999999;
        border-radius:12px;
        padding:12px;
        font-family:Arial;
        max-height:90vh;
        overflow:auto;
        box-shadow:0 0 20px rgba(0,0,0,.45);
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <h2>🔥 Morning 10-Point Hunter PRO</h2>

            <div style="display:flex;align-items:center;gap:10px;">

                <label style="font-size:13px;">
                    <input type="checkbox" id="timeFilter" checked>
                    Use 9:15-11 Filter
                </label>

                <button id="rf">🔄</button>
                <button id="cl">✖</button>
            </div>
        </div>

        <div id="hunterBody">Loading...</div>
    `;

    document.body.appendChild(panel);

    document.getElementById("rf").onclick = runHunter;
    document.getElementById("cl").onclick = () => panel.remove();
}

function rowColor(status) {

    if (status === "READY") return "#123d12";
    if (status === "WATCH") return "#5a4700";
    if (status === "WEAK") return "#333";
    if (status === "LATE") return "#4a1414";

    return "#222";
}

function table(title, rows) {

    let html = `
    <h3>${title}</h3>

    <table width="100%" style="font-size:12px;border-collapse:collapse;">
    <tr>
        <th>#</th>
        <th>Stock</th>
        <th>Price</th>
        <th>%</th>
        <th>Score</th>
        <th>Stay</th>
        <th>Type</th>
        <th>Trigger</th>
        <th>SL</th>
        <th>Target</th>
        <th>Status</th>
    </tr>`;

    rows.forEach((x, i) => {

        html += `
        <tr style="background:${rowColor(x.status)}">
            <td>${i + 1}</td>
            <td>${x.symbol}</td>
            <td>₹${x.price}</td>
            <td>${x.perChange}%</td>
            <td>${x.score}/15</td>
            <td>${x.time}</td>
            <td>${x.type}</td>
            <td>${x.trigger}</td>
            <td>${x.sl}</td>
            <td>${x.target}</td>
            <td>${x.status}</td>
        </tr>`;
    });

    html += "</table>";

    return html;
}

/* =====================================================
   🚀 MAIN
===================================================== */
async function runHunter() {

    try {

        resetDaily();
        createUI();

        const body = document.getElementById("hunterBody");
        const useFilter = document.getElementById("timeFilter")?.checked;

        if (useFilter && !inTradeWindow()) {

            body.innerHTML = `
                <div style="padding:20px;color:#ffcc66;">
                    Time Filter Active.<br>
                    Scanner works between 9:15 AM - 11:00 AM<br><br>
                    Uncheck box to scan anytime.
                </div>
            `;
            return;
        }

        const [gainers, losers] = await Promise.all([
            fetchData("g"),
            fetchData("l")
        ]);

        let ce = [];
        let pe = [];

        gainers
        .filter(x => x.ltp > CONFIG.minPrice && x.perChange > CONFIG.gainerPct)
        .forEach(x => {

            if (!firstSeenMap[x.symbol]) firstSeenMap[x.symbol] = Date.now();

            historyMap[x.symbol] = (historyMap[x.symbol] || 0) + 1;

            const sc = score(x, true);
            const mins = activeMinutes(x.symbol);

            ce.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                time: formatTime(x.symbol),
                status: getStatus(sc, mins),
                ...plan(x, true)
            });

            prevChangeMap[x.symbol] = x.perChange;
            prevPriceMap[x.symbol] = x.ltp;
        });

        losers
        .filter(x => x.ltp > CONFIG.minPrice && x.perChange < CONFIG.loserPct)
        .forEach(x => {

            if (!firstSeenMap[x.symbol]) firstSeenMap[x.symbol] = Date.now();

            historyMap[x.symbol] = (historyMap[x.symbol] || 0) + 1;

            const sc = score(x, false);
            const mins = activeMinutes(x.symbol);

            pe.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                time: formatTime(x.symbol),
                status: getStatus(sc, mins),
                ...plan(x, false)
            });

            prevChangeMap[x.symbol] = x.perChange;
            prevPriceMap[x.symbol] = x.ltp;
        });

        ce.sort((a,b)=>b.score-a.score);
        pe.sort((a,b)=>b.score-a.score);

        body.innerHTML = `
            <div style="margin-bottom:10px;color:#aaa;">
                Updated: ${new Date().toLocaleTimeString()} |
                Auto Refresh: 5 Min |
                Strategy: Exit +10 Points
            </div>

            ${table("🟢 CE Fast Movers", ce.slice(0, CONFIG.topCount))}
            ${table("🔴 PE Fast Movers", pe.slice(0, CONFIG.topCount))}
        `;

    } catch (e) {
        console.error(e);

        const body = document.getElementById("hunterBody");

        if (body) body.innerHTML = "Error loading data.";
    }
}

/* =====================================================
   ▶ START
===================================================== */
runHunter();
setInterval(runHunter, CONFIG.refreshMs);

})();
