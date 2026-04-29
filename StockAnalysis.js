// ==UserScript==
// @name         Morning 10-Point Hunter PRO FINAL
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  NSE Scanner | Top Pick | Draggable | Clean Close | ATM ITM OTM
// @match        *://www.nseindia.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

/* =====================================================
   ⚙️ CONFIG
===================================================== */
const CONFIG = {
    refreshMs: 300000,
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
let hunterTimer = null;

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
   ⏰ TIME FILTER
===================================================== */
function inTradeWindow() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= 555 && mins <= 660; // 9:15 to 11:00
}

/* =====================================================
   📊 HELPERS
===================================================== */
function activeMinutes(symbol) {
    if (!firstSeenMap[symbol]) return 0;
    return Math.floor((Date.now() - firstSeenMap[symbol]) / 60000);
}

function strikeStep(price) {
    if (price > 10000) return 100;
    if (price > 5000) return 50;
    if (price > 2000) return 20;
    if (price > 1000) return 10;
    return 5;
}

function nearestStrike(price) {
    const step = strikeStep(price);
    return Math.round(price / step) * step;
}

function optionStrikes(price, isCE) {
    const step = strikeStep(price);
    const atm = nearestStrike(price);

    if (isCE) {
        return {
            atm: `${atm} CE`,
            itm: `${atm - step} CE`,
            otm: `${atm + step} CE`
        };
    } else {
        return {
            atm: `${atm} PE`,
            itm: `${atm + step} PE`,
            otm: `${atm - step} PE`
        };
    }
}

/* =====================================================
   📈 SCORE
===================================================== */
function score(item, isGainer) {
    let s = 0;

    const prev = prevChangeMap[item.symbol] || item.perChange;
    const prevPrice = prevPriceMap[item.symbol] || item.ltp;
    const count = historyMap[item.symbol] || 0;
    const mins = activeMinutes(item.symbol);

    const pc = Math.abs(item.perChange);

    if (pc > 6) s += 5;
    else if (pc > 5) s += 4;
    else if (pc > 4) s += 3;
    else if (pc > 3) s += 2;
    else s += 1;

    if (isGainer && item.perChange > prev) s += 5;
    if (!isGainer && item.perChange < prev) s += 5;

    if (isGainer && item.ltp > prevPrice) s += 4;
    if (!isGainer && item.ltp < prevPrice) s += 4;

    if (count >= 3) s += 3;
    else if (count >= 2) s += 2;

    if (mins >= 5 && mins <= 30) s += 2;

    return s;
}

function getStatus(score, mins) {
    if (mins > 60) return "LATE";
    if (score >= 18) return "READY";
    if (score >= 13) return "WATCH";
    if (score >= 8) return "WEAK";
    return "SKIP";
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
function rowColor(st) {
    if (st === "READY") return "#123d12";
    if (st === "WATCH") return "#5a4700";
    if (st === "WEAK") return "#333";
    if (st === "LATE") return "#4a1414";
    return "#222";
}

function createUI() {
    if (document.getElementById("hunterPanel")) return;

    const panel = document.createElement("div");
    panel.id = "hunterPanel";

    panel.style = `
        position:fixed;
        top:20px;
        right:20px;
        width:min(96vw,1450px);
        height:min(90vh,900px);
        background:#111;
        color:#fff;
        z-index:999999;
        border-radius:14px;
        resize:both;
        overflow:hidden;
        box-shadow:0 0 20px rgba(0,0,0,.5);
        font-family:Arial;
    `;

    panel.innerHTML = `
        <div id="hunterHead" style="
            cursor:move;
            padding:10px;
            background:#1b1b1b;
            display:flex;
            justify-content:space-between;
            align-items:center;
        ">
            <b>🔥 Morning Hunter PRO FINAL</b>

            <div style="display:flex;gap:8px;">
                <label style="font-size:12px;">
                    <input type="checkbox" id="timeFilter" checked>
                    Time Filter
                </label>

                <button id="rf">🔄</button>
                <button id="cl">✖</button>
            </div>
        </div>

        <div id="hunterBody" style="
            height:calc(100% - 50px);
            overflow:auto;
            padding:10px;
        ">Loading...</div>
    `;

    document.body.appendChild(panel);

    document.getElementById("rf").onclick = runHunter;
    document.getElementById("cl").onclick = destroyHunter;

    makeDraggable(panel, document.getElementById("hunterHead"));
}

/* =====================================================
   🖱️ DRAG
===================================================== */
function makeDraggable(panel, head) {
    let isDown = false, x = 0, y = 0;

    head.onmousedown = function(e) {
        isDown = true;
        x = e.clientX - panel.offsetLeft;
        y = e.clientY - panel.offsetTop;
    };

    document.onmouseup = () => isDown = false;

    document.onmousemove = function(e) {
        if (!isDown) return;
        panel.style.left = (e.clientX - x) + "px";
        panel.style.top = (e.clientY - y) + "px";
        panel.style.right = "auto";
    };
}

/* =====================================================
   ❌ DESTROY
===================================================== */
function destroyHunter() {
    clearInterval(hunterTimer);

    historyMap = {};
    firstSeenMap = {};
    prevChangeMap = {};
    prevPriceMap = {};

    document.onmousemove = null;
    document.onmouseup = null;

    document.getElementById("hunterPanel")?.remove();

    console.clear();
}

/* =====================================================
   📋 TABLE
===================================================== */
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
        <th>Status</th>
        <th>ATM</th>
        <th>ITM</th>
        <th>OTM</th>
        <th>Chart</th>
    </tr>`;

    rows.forEach((x, i) => {
        const link = `https://in.tradingview.com/chart/?symbol=NSE:${x.symbol}`;

        html += `
        <tr style="background:${rowColor(x.status)}">
            <td>${i+1}</td>
            <td>${x.symbol}</td>
            <td>₹${x.price}</td>
            <td>${x.perChange}%</td>
            <td>${x.score}</td>
            <td>${x.status}</td>
            <td>${x.atm}</td>
            <td>${x.itm}</td>
            <td>${x.otm}</td>
            <td><a href="${link}" target="_blank" style="color:#38bdf8;">📈</a></td>
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
            body.innerHTML = `<div style="padding:20px;color:#ffcc66;">Scanner Active 9:15 AM - 11:00 AM</div>`;
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
            const st = getStatus(sc, activeMinutes(x.symbol));
            const op = optionStrikes(x.ltp, true);

            ce.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                status: st,
                ...op
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
            const st = getStatus(sc, activeMinutes(x.symbol));
            const op = optionStrikes(x.ltp, false);

            pe.push({
                symbol: x.symbol,
                price: x.ltp,
                perChange: x.perChange,
                score: sc,
                status: st,
                ...op
            });

            prevChangeMap[x.symbol] = x.perChange;
            prevPriceMap[x.symbol] = x.ltp;
        });

        ce.sort((a,b)=>b.score-a.score);
        pe.sort((a,b)=>b.score-a.score);

        const topCE = ce[0];
        const topPE = pe[0];

        body.innerHTML = `
            <div style="margin-bottom:10px;color:#aaa;">
                Updated: ${new Date().toLocaleTimeString()} |
                Auto Refresh: 5 Min
            </div>

            <div style="
                background:#1c1c1c;
                padding:12px;
                border-radius:10px;
                margin-bottom:12px;
                font-weight:bold;
                line-height:1.8;
            ">
                🏆 TOP CE PICK:
                ${topCE ? topCE.symbol + " | Score " + topCE.score + " | " + topCE.atm : "None"}

                <br>

                🏆 TOP PE PICK:
                ${topPE ? topPE.symbol + " | Score " + topPE.score + " | " + topPE.atm : "None"}
            </div>

            ${table("🟢 CE Fast Movers", ce.slice(0, CONFIG.topCount))}
            <br>
            ${table("🔴 PE Fast Movers", pe.slice(0, CONFIG.topCount))}
        `;

    } catch (err) {
        console.error(err);
        document.getElementById("hunterBody").innerHTML = "Error loading data.";
    }
}

/* =====================================================
   ▶ START
===================================================== */
runHunter();
hunterTimer = setInterval(runHunter, CONFIG.refreshMs);

})();
