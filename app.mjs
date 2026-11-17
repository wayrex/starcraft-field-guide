import {SIDES, SETUP, CLEANUP, initial, reduce, validate, pool, available, onTableSupply, eligible, canFinish, previewScore} from "./core.mjs";

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const KEY = "starcraft-field-guide:match:v1";
const ARCHIVE = "starcraft-field-guide:archive:v1";
const PHASE_NAMES = {movement:"Movement",assault:"Assault",combat:"Combat",scoring:"Scoring & cleanup",cleanup:"Scoring & cleanup"};
const LINK = "https://starcraft-tmg.com/downloads";
let pack, state, history = [], view = "guide", rawRecovery = null, storageOk = true, search = "";
let opened = new Set();

function announce(message) { $("#notice").textContent = message; }
function store() {
  if (rawRecovery) return;
  try { localStorage.setItem(KEY, JSON.stringify({schema:1, state, history, savedAt:new Date().toISOString()})); }
  catch { storageOk = false; announce("Browser storage is unavailable or full. Progress remains in this tab; export a backup before closing it."); }
}
function dispatch(event) {
  try {
    const next = reduce(state,event);
    history.push(state); if (history.length > 100) history.shift();
    state = next; store(); render();
    if (storageOk) announce(event.type === "SCORE" ? "Both scores committed once. Undo restores the entire scoring step." : "Progress saved on this device.");
  } catch (error) { announce(error.message); }
}
function confirmAction(title,message) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title; $("#confirm-message").textContent = message;
  return new Promise(resolve => { dialog.addEventListener("close",() => resolve(dialog.returnValue === "confirm"),{once:true}); dialog.showModal(); });
}
function download(data,name,type="application/json") {
  const url = URL.createObjectURL(new Blob([typeof data === "string" ? data : JSON.stringify(data,null,2)],{type}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function exportMatch() { download(rawRecovery || {schema:1,state,history,savedAt:new Date().toISOString()},`starcraft-round-${state.round}-backup.json`); }
function archive() {
  try {
    const previous = JSON.parse(localStorage.getItem(ARCHIVE) || "[]");
    previous.unshift({state,savedAt:new Date().toISOString()});
    localStorage.setItem(ARCHIVE,JSON.stringify(previous.slice(0,10)));
  } catch {
    storageOk=false;
    download({schema:1,state,history},"starcraft-before-reset-backup.json");
    announce("Browser archive unavailable; the current match was exported before replacement.");
    return true;
  }
  return true;
}
function check(key,text) { return `<li><label><input id="check-${escape(key)}" type="checkbox" data-check="${escape(key)}" ${state.checks[key] ? "checked" : ""}> <span>${escape(text)}</span></label></li>`; }
function referenceLink(id,label="Read the rules") { return `<button class="reference-link" data-reference="${id}">${escape(label)}</button>`; }
function source(text) { return `<p class="source">${escape(text)} · ${referenceLink("sources","Official sources")}</p>`; }
function name(player) { return escape(state.labels[player]); }
function unitDefinition(id) { return pack.factions.flatMap(f => f.units).find(u => u.id === id); }
function scorebar() {
  return `<div class="statusbar"><span class="eyebrow" style="margin:0">${state.stage === "setup" ? "Preparation" : state.stage === "conclusion" ? "Match complete" : `Round ${state.round} / 5`}</span>
    <strong>${state.stage === "playing" ? PHASE_NAMES[state.phase] : "Frontlines Skirmish"}</strong><span class="spacer"></span>
    <span class="pill terran">${name("terran")} ${state.score.terran} VP</span><span class="pill zerg">${name("zerg")} ${state.score.zerg} VP</span>
    <button data-action="undo" ${history.length ? "" : "disabled"}>Undo</button></div>`;
}
function sidebar() {
  return `<aside class="sidebar"><section class="card"><p class="eyebrow">At a glance</p>
    ${SIDES.map(p => `<div class="score-row"><span class="pill ${p}">${name(p)}</span><span class="score-num">${state.score[p]}</span></div>
      <p class="small muted">On-table Supply ${onTableSupply(state,p)} · Available ${available(state,p) === Infinity ? "unlimited" : available(state,p)}</p>`).join("")}
    <p class="small"><strong>Supply Pool: ${pool(state) === Infinity ? "unlimited" : pool(state)}</strong><br>Supply is each unit's current model-count bracket. It governs deployment capacity and objectives.</p>
    <p class="small"><strong>Marker holder: ${name(state.marker)}</strong><br>Chooses who acts first in each phase. ${state.initiativeLock ? "Card exception: locked this phase." : ""}</p>
    <p class="small muted">${escape(state.ends)}</p></section>
    <section class="card"><p class="eyebrow">Resource cards</p><p class="small muted">Exhaust a Ready card to pay/use it. Its other abilities then become unavailable until refresh. Exact ability windows stay on the cards.</p>
    ${pack.factions.map(f => `<h3 class="${f.id}">${escape(f.name)} · ${f.resource}</h3><p class="small muted">${f.resource === "CP" ? "CP: Command Points" : "BM: Biomass"}</p>${f.cards.map((card,i) => `<div class="resource"><span>${escape(card)}<small class="muted"> · 1 ${f.resource}</small></span><button id="card-${f.id}-${i}" data-card="${f.id}" data-index="${i}" class="${state.ready[f.id][i] ? "" : "spent"}" ${state.stage === "playing" ? "" : "disabled"}>${state.ready[f.id][i] ? "Ready" : "Exhausted"}</button></div>`).join("")}`).join("")}
    <p class="small muted">Accelerating Creep supplies no BM; it does not create Tumors.</p></section>
    <section class="card"><p class="eyebrow">Your reference kit</p><div class="toolbar">${referenceLink("glossary","Definitions")}${referenceLink("rulings","Table agreements")}${referenceLink("questions","UNCLEAR")}</div>
    <p class="small"><a href="https://sc.starcraft-tmg.com/" target="_blank" rel="noopener noreferrer">Official Command Center ↗</a><br><a href="${LINK}" target="_blank" rel="noopener noreferrer">Official cards & rulebook ↗</a></p><button data-action="export">Export match backup</button></section></aside>`;
}
function setup() {
  const step = SETUP[state.setupStep];
  return `<section class="card hero"><p class="eyebrow">Preparation ${state.setupStep + 1} / ${SETUP.length}</p><h1>${step.title}</h1><p class="muted">Prepare together, track independently. This page changes only your device's progress.</p><p class="small">Frontlines Skirmish is a five-round objective mission: score enemy Supply losses from round 1 and objectives from round 2; an 8+ VP lead ends the game immediately.</p>
    <div class="phase-strip">${SETUP.map((s,i) => `<span class="${i === state.setupStep ? "current" : ""}">${i+1}. ${["Map","Armies","Kit","Mission"][i]}</span>`).join("")}</div>
    ${state.setupStep === 0 ? `<div class="map-wrap"><a href="./map.svg" target="_blank" rel="noopener" aria-label="Open map full size"><img class="map" src="./map.svg" alt="36 by 36 inch cargo-yard map with ten terrain pieces and objectives 1, 5 and 2 on the midline."></a><p class="small muted">Tap the map to open it full size.</p></div><details><summary>Placement coordinates in inches</summary><div class="table-wrap">${pack.mapHtml}</div></details><p class="small">Terrain symbols reserve schematic space; try the real pieces and largest bases. GRASS permits movement and is removed when crossed by a Ground leader or when a model ends on it.</p>` : ""}
    ${state.setupStep === 1 ? pack.factions.map(f => `<details open><summary>${escape(f.name)} · 670 minerals</summary><div class="reference-body">${f.html}</div></details>`).join("") : ""}
    ${state.setupStep === 2 ? `<div class="callout info">Use inches for battlefield distances and mm for specified bases/markers. Keep one die distinct for Surge: matching hits bypass Armour; the die does not add hits.</div><p>Cards may be printed or opened in the official Command Center. Offline caching here does not download the publisher's PDFs.</p>` : ""}
    ${state.setupStep === 3 ? `<div class="field-grid">${SIDES.map(p => `<label class="label-field">${p === "terran" ? "Terran" : "Zerg"} player name<input id="label-${p}" data-label="${p}" maxlength="40" value="${name(p)}"></label>`).join("")}</div><label class="label-field">Table ends<select data-ends><option ${state.ends.startsWith("Terran") ? "selected" : ""}>Terran enters at A; Zerg enters at B</option><option ${state.ends.startsWith("Zerg") ? "selected" : ""}>Zerg enters at A; Terran enters at B</option></select></label><label class="label-field">First Player Marker after Roll-Off<select data-marker>${SIDES.map(p => `<option value="${p}" ${state.marker === p ? "selected" : ""}>${name(p)}</option>`).join("")}</select></label>` : ""}
    <ul class="checklist">${step.checks.map((text,i) => check(`setup-${state.setupStep}-${i}`,text)).join("")}</ul>
    <div class="actions end"><button data-action="setup-back" ${state.setupStep ? "" : "disabled"}>Previous setup step</button><button class="primary" data-action="setup-next">${state.setupStep === 3 ? "Begin round 1" : "Continue preparation"}</button></div>
    ${source(state.setupStep === 0 ? "Custom learning layout; RB pp. 43, 54, 73, 78" : "RB pp. 53-58, 73-81; selected cards; Frontlines Skirmish")}</section>`;
}

const INSTRUCTIONS = {
  movement: [
    "Start the round: resolve effects labelled Start of the Round, with the First Player Marker holder going first. Units gain STATIONARY, meaning they have not moved this round; remove it if any of their models moves, is moved or is PLACED (repositioned by a rule).",
    "Check reinforcement capacity: each player has a separate Supply Pool, the limit used when bringing units onto the table. Available Supply is that pool minus the current Supply of their on-table units. Reserve units do not use this capacity. In round 1, the pool is 3 and each selected unit costs 1 Supply to deploy.",
    "Choose the first player: whoever holds the First Player Marker decides which player takes the first activation. Click that player's starts button below. Holding the marker does not require you to go first.",
    "Choose one unit and its action: the acting player selects a unit that has not activated this phase. Use Deploy for a Reserve unit, Move for an unengaged on-table unit, Disengage to leave an enemy engagement, or Hold to stay in place. The action descriptions below explain each choice.",
    "Complete that activation at the table: carry out the action and resolve any permitted abilities or enemy reactions at the times their rules specify. An activation is the unit's whole turn, including those effects. Select its action in the ledger, then click Finish activation and place its physical activation marker.",
    "Alternate players: the other player now chooses one of their eligible units and repeats steps 4-5. Each unit may activate once in this phase. If one player has passed, the other may keep activating units without alternating.",
    "Finish the phase: click your player's passes button when you will take no more activations, including when no eligible units remain. Passing ends your participation in Movement; mark your remaining units, but they have not activated or performed Hold. The first player to pass takes the First Player Marker for Assault unless a card overrides this. After both players pass, click Continue to Assault."
  ],
  assault: ["The marker holder chooses who starts; then alternate eligible on-table units.", "Use Ranged Attack, Charge, Run or Hold. Ranged targets, range, LoS and weapon batches are checked physically using the cards.", "Charge declares targets before Speed + d6; follow a legal route and resolve IMPACT after success. IMPACT generates Damage-1 hits without Surge.", "A unit that Disengaged normally cannot shoot or charge; verify Tactical Mass or a card exception before marking a waiver.", "Resolve permitted abilities/reactions before finishing each activation. First to pass takes the marker for Combat unless a card exception applies."],
  combat: ["Mark which units are still engaged: eligible Ground models Within 1 inch, subject to terrain/elevation rules. This app cannot infer physical engagement.", "The marker holder chooses who starts. Activate each eligible engaged unit once; a unit freed from engagement before acting does not receive another action.", "Close Ranks is optional movement up to 3 inches closer, preserving contacts and engagements. Then resolve Fighting/Supporting models' attacks and remove that unit's physical activation marker.", "Pass only when no eligible engaged unit remains for that player. Passing in Combat does not transfer the marker under our table agreement.", "If no units are engaged, both players may pass and proceed directly to Scoring."],
};
function phaseStrip() { return `<div class="phase-strip">${["movement","assault","combat","scoring"].map(p => `<span class="${(state.phase === "cleanup" ? "scoring" : state.phase) === p ? "current" : ""}">${PHASE_NAMES[p]}</span>`).join("")}</div>`; }
function unitCards() {
  return SIDES.map(p => `<section><h2><span class="pill ${p}">${name(p)}</span> ${state.passed[p] ? "Finished this phase" : ""}</h2>${state.units.filter(u => u.side === p).map(u => {
    const def = unitDefinition(u.id);
    let actions = state.phase === "movement" ? (u.status === "reserve" ? ["Deploy"] : u.engaged ? ["Disengage","Hold"] : ["Move","Hold"]) : state.phase === "combat" ? ["Fight"] : ["Ranged Attack","Charge","Run","Hold"].filter(a => (a !== "Ranged Attack" || u.canShoot) && (!u.engaged || !["Charge","Run"].includes(a)) && (!u.disengaged || u.waived || !["Ranged Attack","Charge"].includes(a)));
    const canAct = state.actor === p && !state.passed[p] && eligible(state,u);
    return `<article class="unit ${p} ${u.activated ? "done" : ""}"><h3>${escape(def.name)}<span class="pill">${u.status === "reserve" ? "Reserves" : u.status === "destroyed" ? "Destroyed" : u.activated ? "Activation complete" : "On table"}</span></h3><div class="unit-meta">${def.models} models at start · ${escape(def.base)} bases · ${escape(def.upgrades)}</div>
    ${u.status === "reserve" && def.upgrades.includes("Burrow Ambush") ? `<p class="small">Burrow Ambush: optional PLACE (18) from Entry Edge; every model more than 10 inches from enemies. This Movement activation then ends. It does not grant BURROWED.</p>` : ""}
    ${u.disengaged ? `<label class="toggle"><input type="checkbox" data-waiver="${u.id}" ${u.waived ? "checked" : ""}> Disengage penalty waived by verified Tactical Mass/card exception</label><p class="small muted">Tactical Mass: at Disengage declaration, own Supply strictly exceeded the combined Supply of engaged enemies. A card waiver follows its exact text.</p>` : ""}
    <div class="controls"><label>Current Supply <select data-supply="${u.id}" ${u.status === "field" ? "" : "disabled"}><option value="0" ${u.supply === 0 ? "selected" : ""}>0</option><option value="1" ${u.supply === 1 ? "selected" : ""}>1</option></select></label>
    <label><input type="checkbox" data-engaged="${u.id}" ${u.engaged ? "checked" : ""} ${u.status === "field" ? "" : "disabled"}> Engaged</label>
    <button data-destroy="${u.id}" class="danger" ${u.status === "field" ? "" : "disabled"}>Destroyed</button></div>
    ${u.status !== "destroyed" ? `<div class="controls"><label class="small" for="action-${u.id}">Action</label><select id="action-${u.id}" ${canAct ? "" : "disabled"}>${actions.map(a => `<option>${a}</option>`).join("")}</select><button class="${canAct ? "primary" : ""}" data-activate="${u.id}" ${canAct ? "" : "disabled"}>Finish activation</button></div>` : ""}</article>`;
  }).join("")}</section>`).join("");
}
function activationPhase() {
  return `<section class="card hero"><p class="eyebrow">Round ${state.round} · ${PHASE_NAMES[state.phase]}</p><h1>${state.phase === "movement" ? "Deploy and move your units." : state.phase === "assault" ? "Choose the next action." : "Resolve the engagements."}</h1>${phaseStrip()}
  ${state.phase === "movement" ? `<p>Do steps 1-3 once at the start of this phase. Then repeat steps 4-6 for unit activations until both players have passed, as described in step 7.</p>` : ""}<ol class="step-list">${INSTRUCTIONS[state.phase].map(t => `<li>${escape(t)}</li>`).join("")}</ol>
  ${state.phase === "movement" ? `<div class="table-wrap"><table><caption>Movement action choices</caption><thead><tr><th>Action</th><th>What to do at the table</th></tr></thead><tbody>
  <tr><th>Deploy</th><td>Bring a unit from Reserves onto the battlefield from your Entry Edge, within its Speed allowance. Its Supply must fit your Available Supply; check the legal entry position and formation before placing it.</td></tr>
  <tr><th>Move</th><td>For an unengaged unit already on the table, move its leader up to the Speed shown on its card along a legal path, then place its followers in a legal formation around the leader.</td></tr>
  <tr><th>Disengage</th><td>Move an engaged unit clear of enemy Engagement Range, the distance at which Ground models are in close combat. It normally cannot shoot or charge in Assault afterward; confirm a rules exception before waiving that restriction.</td></tr>
  <tr><th>Hold</th><td>Keep the unit in place. This uses its action and counts as an activation; resolve any allowed abilities at their specified times. It does not end your other units' participation in Movement.</td></tr>
  </tbody></table></div>` : ""}
  <div class="actions">${referenceLink(state.phase === "movement" ? "movement" : "combat","Exact action & attack procedures")}${referenceLink("abilities","Ability timing")}</div>
  ${state.actor === null ? `<div class="callout info"><strong>${name(state.marker)} chooses who starts this phase.</strong><div class="actions">${SIDES.map(p => `<button data-starter="${p}">${name(p)} starts</button>`).join("")}</div></div>` : `<div class="callout info"><strong>${canFinish(state) ? "Both players finished." : `${name(state.actor)} acts next.`}</strong><p class="small">Finish activation only after the physical action and permitted abilities/reactions. Changing Supply adjusts the round's Supply-loss tally; a casualty is not automatically 1 VP.</p><div class="actions"><button data-action="pass" ${canFinish(state) ? "disabled" : ""}>${name(state.actor)} passes</button><button class="primary" data-action="next-phase" ${canFinish(state) ? "" : "disabled"}>Continue to ${state.phase === "movement" ? "Assault" : state.phase === "assault" ? "Combat" : "Scoring"}</button></div></div>`}
  <details><summary>Card exception: correct/lock initiative</summary><p class="small">Use only when a card explicitly changes the First Player Marker. A phase lock prevents normal pass transfer until the next phase; record exact cost/frequency on the card (for example Terran Tenacity is once per game).</p><div class="actions">${SIDES.map(p => `<button data-initiative="${p}">${name(p)} holds marker</button><button data-initiative="${p}" data-lock="true">${name(p)} · lock this phase</button>`).join("")}</div></details>
  ${source("RB pp. 55-68, 79-81; FAQ pp. 3-7; table agreements U02/U03/U09")}</section><section class="card"><p class="eyebrow">Activation ledger</p>${unitCards()}</section>`;
}
function scoring() {
  const preview = previewScore(state);
  return `<section class="card hero"><p class="eyebrow">Round ${state.round} · Scoring & cleanup</p><h1>Determine control. Score together.</h1>${phaseStrip()}
  <ol class="step-list"><li>Compare contesting Current Supply at each objective. A model must be Within 3 inches, have LoS and be on the same elevation. No Flying/BURROWED; ties keep the previous owner.</li><li>Enter the resulting owner below. Ownership stays after leaving; it does not reset to neutral.</li><li>Check Supply lost this round. From round 2, each controlled marker gives 1 VP, plus 2 when taken from the opponent this round.</li><li>Commit both scores simultaneously, then check the immediate 8+ VP lead condition and final-round ending.</li></ol>
  ${state.round === 1 ? `<div class="callout">Round 1 establishes ownership but awards no objective VP. Supply-loss VP still counts.</div>` : ""}
  ${state.round === 5 ? `<div class="callout">Final round: undeployed Reserves count as Destroyed at the start of Scoring. Their remaining Supply is included automatically below.</div>` : ""}
  <div class="two-col">${SIDES.map(p => `<label class="label-field">${name(p)} Supply lost this round<input id="loss-${p}" data-loss="${p}" type="number" min="0" max="50" value="${state.losses[p]}"><small class="muted">Own losses give VP to the opponent. Adjust if a rule/correction requires it.</small></label>`).join("")}</div>
  <div class="table-wrap"><table><thead><tr><th>Objective</th><th>Previous owner</th><th>Owner after control check</th></tr></thead><tbody>${["1","5","2"].map(key => `<tr><td>Marker ${key}</td><td>${state.owners[key] ? name(state.owners[key]) : "Unowned"}</td><td><select id="owner-${key}" data-owner="${key}" aria-label="Marker ${key} owner"><option value="" ${state.draftOwners[key] === null ? "selected" : ""} ${state.owners[key] !== null ? "disabled" : ""}>Unowned</option>${SIDES.map(p => `<option value="${p}" ${state.draftOwners[key] === p ? "selected" : ""}>${name(p)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
  <div class="callout info"><strong>Pending award</strong><p>${name("terran")}: +${preview.points.terran} VP · ${name("zerg")}: +${preview.points.zerg} VP</p><p class="small">Includes ${preview.objectives.terran} / ${preview.objectives.zerg} objective VP. Nothing is added to the totals until you commit.</p></div>
  <ul class="checklist">${check(`score-${state.round}-control`,"Objective eligibility, Supply comparisons and sticky ownership checked")}${check(`score-${state.round}-losses`,"Supply-loss tally checked; final-round Reserves included when applicable")}</ul>
  <button class="primary" data-action="score">Commit both scores</button> ${referenceLink("scoring","Scoring & victory rules")}${source("RB pp. 69-72; Frontlines Skirmish, Terran card sheets PDF p. 12")}</section>`;
}
function cleanup() {
  return `<section class="card hero"><p class="eyebrow">Round ${state.round} · Scoring & cleanup</p><h1>Reset the table for the next round.</h1><p>Scores are already committed. Finish end effects before removing expiring buffs. The current First Player Marker stays through these effects under our table agreement.</p>
  <p class="small">STAY IN PLAY means a piece survives normal cleanup until its specified removal condition applies.</p><ul class="checklist">${CLEANUP.map((t,i) => check(`cleanup-${state.round}-${i}`,t)).join("")}</ul>
  <label class="label-field">Next-round First Player Marker<select data-next-marker><option value="">Choose after tied-score Roll-Off</option>${SIDES.map(p => `<option value="${p}" ${state.nextMarker === p ? "selected" : ""}>${name(p)}</option>`).join("")}</select></label>
  <p class="small">Fewer VP receives the marker; if tied, roll 2d6 and reroll ties. The holder chooses who acts first; it is not a compulsory first activation.</p><button class="primary" data-action="next-round">Begin round ${state.round+1}</button>${source("RB pp. 72, 79-81; table agreement U09")}</section>`;
}
function conclusion() {
  return `<section class="card hero"><p class="eyebrow">Match concluded · round ${state.round}</p><h1>${state.result.winner === "draw" ? "A drawn battle." : `${name(state.result.winner)} wins.`}</h1><p class="muted">${escape(state.result.reason)}</p><div class="result">${state.score.terran} — ${state.score.zerg}</div><p>${name("terran")} / ${name("zerg")}</p><label class="label-field">After-action notes<textarea id="notes" data-notes placeholder="Decisive lanes, actual terrain adjustments, difficult routes and temporary rulings…">${escape(state.notes)}</textarea></label><div class="actions"><button class="primary" data-action="export">Export match & notes</button><button data-action="new">Start a rematch</button><button data-view="record">Review round history</button></div><p class="small muted">A rematch archives this record on this device. Swap factions/table ends before attributing one result to balance.</p></section>`;
}
function manualEnding() { return `<details class="card"><summary>End early or record an agreed result</summary><p class="small">Full elimination includes enemy units in Reserves. The winner procedure remains UNCLEAR (U12); agree/record the ruling rather than having this page invent one. No automatic +10 VP or winner is applied here.</p><label class="label-field">Agreed result<select id="end-winner"><option value="terran">${name("terran")} wins</option><option value="zerg">${name("zerg")} wins</option><option value="draw">Draw / no winner</option></select></label><label class="label-field">Reason / temporary ruling<input id="end-reason" maxlength="600" placeholder="Record the agreement or why play stopped"></label><button data-action="end" class="danger">Record conclusion</button> ${referenceLink("questions","Read unresolved questions")}</details>`; }
function record() {
  let archives=[];
  try {
    const stored=JSON.parse(localStorage.getItem(ARCHIVE)||"[]");
    if(Array.isArray(stored)) archives=stored.map((entry,index)=>({entry,index})).filter(({entry})=>entry && typeof entry==="object" && typeof entry.savedAt==="string" && entry.state);
  } catch { /* current record remains usable */ }
  return `<section class="card hero"><p class="eyebrow">Match record</p><h1>Your battle, on this device.</h1><p class="muted">Other devices keep separate progress. Export/import can transfer a backup manually; there is no live synchronization.</p><div class="toolbar"><button data-action="export" class="primary">Export backup</button><button data-action="import">Import backup</button><button data-action="new">New match</button><button data-action="print">Print record</button></div>
  <p class="small">${escape(state.ends)} · reference ${escape(state.version)} · ${state.result ? escape(state.result.reason) : "In progress"}</p><div class="table-wrap"><table><thead><tr><th>Round</th><th>Terran award</th><th>Zerg award</th><th>Totals T / Z</th></tr></thead><tbody>${state.rounds.length ? state.rounds.map(r => `<tr><td>${escape(r.round)}</td><td>${escape(r.points?.terran)}</td><td>${escape(r.points?.zerg)}</td><td>${escape(r.totals?.terran)} / ${escape(r.totals?.zerg)}</td></tr>`).join("") : `<tr><td colspan="4">No round scored yet.</td></tr>`}</tbody></table></div>
  <label class="label-field">Notes and temporary rulings<textarea id="notes" data-notes>${escape(state.notes)}</textarea></label><details open><summary>Action log</summary><ol class="log">${state.log.map(line => `<li>${escape(line)}</li>`).join("") || "<li>No actions yet.</li>"}</ol></details>
  ${archives.length ? `<details><summary>Previous matches on this device (${archives.length}; latest 10 retained)</summary>${archives.map(({entry,index}) => `<div class="resource"><span>${escape(entry.savedAt.slice(0,10))} · round ${escape(entry.state?.round)} · ${escape(entry.state?.score?.terran)} / ${escape(entry.state?.score?.zerg)}</span><button data-archive="${index}">Restore</button></div>`).join("")}</details>` : ""}</section>`;
}
function references() { return `<section class="card hero"><p class="eyebrow">Quick reference</p><h1>Look it up. Keep your place.</h1><p>Opening reference sections never advances a phase or changes the score. Every named rule has a brief explanation; sources use printed rulebook pages, with PDF page numbers two higher.</p><div class="reference-tools"><input id="search" type="search" placeholder="Search: charge, cover, Supply, HIDDEN…" aria-label="Search references" value="${escape(search)}"><button data-view="guide">Return to current step</button></div><p class="small muted">Reference reviewed ${escape(pack.reviewed)}. Official FAQ/errata &gt; full rulebook &gt; older teaching material. Table agreements and UNCLEAR entries are labelled separately.</p></section>${pack.topics.map(t => `<details id="topic-${t.id}" data-topic="${t.id}" class="reference-detail" ${opened.has(`topic-${t.id}`) ? "open" : ""}><summary>${escape(t.title)}</summary><div class="reference-body">${t.html}</div></details>`).join("")}`; }

function render() {
  const focused = document.activeElement?.id;
  document.querySelectorAll("details[id][open]").forEach(d => opened.add(d.id));
  document.querySelectorAll(".tabs button").forEach(b => { b.classList.toggle("active",b.dataset.view===view); b.setAttribute("aria-current",b.dataset.view===view ? "page" : "false"); });
  if (rawRecovery) {
    $("#app").innerHTML = `<main id="main" class="card hero"><h1>Saved match needs attention.</h1><p>The stored match is invalid or uses a different reference snapshot. It has been preserved, not overwritten.</p><div class="actions"><button data-action="export">Export original backup</button><button data-action="new">Start a new match</button><button data-action="import">Import compatible backup</button></div></main>`;
    return;
  }
  const main = view === "reference" ? references() : view === "record" ? record() : state.stage === "setup" ? setup() : state.stage === "conclusion" ? conclusion() : state.phase === "scoring" ? scoring() : state.phase === "cleanup" ? cleanup() : activationPhase();
  $("#app").innerHTML = scorebar() + `<div class="grid"><main id="main">${main}${view === "guide" && state.stage === "playing" ? manualEnding() : ""}</main>${sidebar()}</div>`;
  if (focused) document.getElementById(focused)?.focus({preventScroll:true});
  filterReferences();
}
function filterReferences() {
  document.querySelectorAll("[data-topic]").forEach(element => { element.hidden = !element.textContent.toLowerCase().includes(search.toLowerCase()); if (search && !element.hidden) element.open = true; });
}
document.addEventListener("toggle",event => { if (event.target.id?.startsWith("topic-")) { if (event.target.open) opened.add(event.target.id); else opened.delete(event.target.id); } },true);
document.addEventListener("input",event => { if (event.target.id === "search") { search=event.target.value; filterReferences(); } });
document.addEventListener("change",event => {
  const e=event.target;
  if (e.dataset.check) dispatch({type:"CHECK",key:e.dataset.check,value:e.checked});
  else if (e.dataset.label) dispatch({type:"LABEL",side:e.dataset.label,value:e.value});
  else if (e.hasAttribute("data-ends")) dispatch({type:"ENDS",value:e.value});
  else if (e.hasAttribute("data-marker")) dispatch({type:"MARKER",side:e.value});
  else if (e.dataset.supply) dispatch({type:"SUPPLY",unit:e.dataset.supply,value:Number(e.value)});
  else if (e.dataset.engaged) dispatch({type:"ENGAGED",unit:e.dataset.engaged,value:e.checked});
  else if (e.dataset.waiver) dispatch({type:"WAIVER",unit:e.dataset.waiver,value:e.checked});
  else if (e.dataset.loss) dispatch({type:"LOSS",side:e.dataset.loss,value:Number(e.value)});
  else if (e.dataset.owner) dispatch({type:"OWNER",marker:e.dataset.owner,side:e.value||null});
  else if (e.hasAttribute("data-next-marker")) dispatch({type:"NEXT_MARKER",side:e.value});
  else if (e.hasAttribute("data-notes")) dispatch({type:"NOTES",value:e.value});
});
document.addEventListener("click",async event => {
  const b=event.target.closest("button,a"); if (!b) return;
  if (b.dataset.view) { view=b.dataset.view; render(); return; }
  if (b.dataset.reference || (b.tagName === "A" && b.getAttribute("href") === "#reference")) {
    event.preventDefault(); view="reference"; search=""; if(b.dataset.reference) opened.add(`topic-${b.dataset.reference}`); render();
    document.getElementById(`topic-${b.dataset.reference}`)?.scrollIntoView({behavior:"smooth",block:"start"}); return;
  }
  if (b.dataset.starter) return dispatch({type:"STARTER",side:b.dataset.starter});
  if (b.dataset.initiative) return dispatch({type:"MARKER",side:b.dataset.initiative,lock:Boolean(b.dataset.lock)});
  if (b.dataset.card) return dispatch({type:"CARD",side:b.dataset.card,index:Number(b.dataset.index)});
  if (b.dataset.activate) return dispatch({type:"ACT",unit:b.dataset.activate,action:document.getElementById(`action-${b.dataset.activate}`).value});
  if (b.dataset.destroy) { if(await confirmAction("Mark unit Destroyed?","This removes its remaining Supply and updates this round's loss tally. Use Undo to correct a mistake.")) dispatch({type:"DESTROY",unit:b.dataset.destroy}); return; }
  if (b.dataset.archive !== undefined) {
    try { const entries=JSON.parse(localStorage.getItem(ARCHIVE)||"[]"); const restored=validate(entries[Number(b.dataset.archive)].state,pack);
      if(await confirmAction("Restore previous match?","The current match will be archived first.")) { if(!archive())return; state=restored;history=[];view="guide";store();render(); }
    } catch(error){announce(error.message);} return;
  }
  const action=b.dataset.action;
  if(action==="undo") { if(history.length){state=history.pop();store();render();announce("Last match change undone.");} }
  else if(action==="setup-back") dispatch({type:"SETUP_BACK"});
  else if(action==="setup-next") dispatch({type:"SETUP_NEXT"});
  else if(action==="pass") { if(await confirmAction("Finish this player's phase?","Passing ends further activations for this player in this phase. It is not a Hold action.")) dispatch({type:"PASS"}); }
  else if(action==="next-phase") dispatch({type:"NEXT_PHASE"});
  else if(action==="score") { if(await confirmAction("Commit both scores?","Award both players' pending points together, once. This may conclude the match.")) dispatch({type:"SCORE"}); }
  else if(action==="next-round") dispatch({type:"NEXT_ROUND"});
  else if(action==="export") exportMatch();
  else if(action==="import") $("#import-file").click();
  else if(action==="print") window.print();
  else if(action==="end") { const winner=$("#end-winner").value,reason=$("#end-reason").value; if(await confirmAction("Conclude the match?","Record an agreed result and preserve the current scores. No unresolved rule is decided automatically."))dispatch({type:"END",winner,reason}); }
  else if(action==="new") {
    if(await confirmAction("Start a new match?","Export a backup first if needed. The current valid match is archived on this device; reset starts fresh checklists and scores.")) {
      if(!rawRecovery && !archive())return;
      if(rawRecovery){ download(rawRecovery,"starcraft-recovery-original.json"); }
      state=initial(pack);history=[];rawRecovery=null;view="guide";store();render();announce("New match started; all preparation checks reset.");
    }
  }
});
$("#import-file").addEventListener("change",async event => {
  const file=event.target.files[0]; if(!file)return;
  try {
    if(file.size>2_000_000)throw new Error("Backup is too large (maximum 2 MB).");
    const incoming=JSON.parse(await file.text());
    if(incoming.schema!==1 || !Array.isArray(incoming.history) || incoming.history.length>100)throw new Error("Invalid backup format.");
    const restored=validate(incoming.state,pack),undo=incoming.history.map(s=>validate(s,pack));
    if(await confirmAction("Import this backup?","Replace the current progress after archiving it. This affects only this device.")) {
      if(!rawRecovery && !archive())return;
      state=restored;history=undo;rawRecovery=null;view="guide";store();render();announce("Backup imported and validated.");
    }
  } catch(error){announce(`Import rejected: ${error.message}`);}
  event.target.value="";
});

async function boot() {
  const response=await fetch("./guide.json"); if(!response.ok)throw new Error("Reference pack could not load.");
  pack=await response.json(); state=initial(pack);
  let raw;
  try { raw=localStorage.getItem(KEY); if(raw){ const saved=JSON.parse(raw); state=validate(saved.state,pack);
    if(saved.schema!==1 || !Array.isArray(saved.history) || saved.history.length>100)throw new Error("Invalid saved undo history.");
    history=saved.history.map(s=>validate(s,pack)); }
  } catch(error){ if(raw)rawRecovery=raw;else{storageOk=false;announce("Browser storage is unavailable. Export backups before closing this tab.");} }
  $("#version").textContent=`Reference ${pack.version} · rules reviewed ${pack.reviewed}`;
  render();
  if("serviceWorker" in navigator) {
    try {
      const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./"});
      navigator.serviceWorker.ready.then(()=>{$("#offline").textContent="Offline guide cached · publisher PDFs are separate downloads";});
      if(registration.waiting) $("#offline").textContent="Guide update waiting · export before closing/reopening all guide tabs";
    } catch { $("#offline").textContent="Offline caching unavailable · keep this tab open or use the printed guide"; }
  } else $("#offline").textContent="Offline caching unsupported in this browser";
}
boot().catch(error=>{ $("#app").textContent=`Could not start: ${error.message} Serve the built site over HTTP/HTTPS, not file://.`; });
