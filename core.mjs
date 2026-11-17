// Pure match transitions. Physical eligibility and all dice are decided at the table.
export const SIDES = ["terran", "zerg"];
export const PHASES = ["movement", "assault", "combat", "scoring", "cleanup"];
export const SETUP = [
  {title: "Lay out the battlefield", checks: ["36 × 36 inch boundary and full opposed Entry Edges marked", "Ten pieces placed; actual footprints, Queen routes and Zergling staging checked", "32 mm objectives 1, 5, 2 at (7,18), (18,18), (29,18) inches; all Activated, unowned"]},
  {title: "Prepare both armies", checks: ["Both 670-mineral lists checked; A/B units and Marine specialists identified", "Only purchased upgrades marked; Queen has no upgrades", "All units start off-table in Reserves; cards begin Ready"]},
  {title: "Set out the play kit", checks: ["Eight arrow/crosshair activation markers, damage/status aids and five Creep Tumors ready", "Inch measures, attack/save dice and a distinct Surge die ready", "Cards or official digital references available; token legend agreed"]},
  {title: "Agree the mission and first player", checks: ["Frontlines Skirmish: five rounds, Pool 3, +1 later; final-round Supply unlimited", "Custom deployment and table agreements reviewed; unresolved cases stay marked UNCLEAR", "Roll-Off resolved: roll 2d6, reroll ties; winner assigns the First Player Marker below"]},
];
export const CLEANUP = ["End-of-round effects resolved before expiring buffs", "Transient markers removed; damage, objective ownership and STAY IN PLAY pieces retained", "Exhausted cards refreshed and next-round First Player Marker assigned"];

const clone = value => structuredClone(value);
const other = side => side === "terran" ? "zerg" : "terran";
const require = (condition, message) => { if (!condition) throw new Error(message); };
function side(value) { require(SIDES.includes(value), "Choose Terran or Zerg."); return value; }
function integer(value, min, max) { require(Number.isInteger(value) && value >= min && value <= max, `Use a whole number from ${min} to ${max}.`); return value; }

export function initial(pack) {
  return {schema: 1, version: pack.version, stage: "setup", setupStep: 0, checks: {},
    round: 1, phase: "movement", marker: "terran", actor: null, passed: {terran: false, zerg: false},
    initiativeLock: null, nextMarker: null,
    units: pack.factions.flatMap(f => f.units.map(u => ({id: u.id, side: u.side, supply: u.supply,
      status: "reserve", engaged: false, activated: false, disengaged: false, waived: false, canShoot: u.canShoot}))),
    ready: {terran: [true, true], zerg: [true, true]},
    owners: {"1": null, "5": null, "2": null}, draftOwners: {"1": null, "5": null, "2": null},
    losses: {terran: 0, zerg: 0}, score: {terran: 0, zerg: 0}, rounds: [],
    labels: {terran: "Terran", zerg: "Zerg"}, ends: "Terran enters at A; Zerg enters at B",
    notes: "", result: null, log: []};
}

export function pool(state) { return state.round === 5 ? Infinity : state.round + 2; }
export function onTableSupply(state, player) { return state.units.filter(u => u.side === player && u.status === "field").reduce((n,u) => n + u.supply, 0); }
export function available(state, player) { return pool(state) - onTableSupply(state, player); }
export function eligible(state, unit) {
  if (unit.activated || unit.status === "destroyed") return false;
  if (state.phase === "movement") return true;
  if (state.phase === "assault") return unit.status === "field";
  return state.phase === "combat" && unit.status === "field" && unit.engaged;
}
export function canFinish(state) { return SIDES.every(s => state.passed[s]); }
export function previewScore(state) {
  const losses = clone(state.losses);
  if (state.round === 5) state.units.filter(u => u.status === "reserve").forEach(u => { losses[u.side] += u.supply; });
  const points = {terran: losses.zerg, zerg: losses.terran};
  const objectives = {terran: 0, zerg: 0};
  if (state.round > 1) for (const key of ["1", "5", "2"]) {
    const owner = state.draftOwners[key];
    if (owner) objectives[owner] += 1 + (state.owners[key] && state.owners[key] !== owner ? 2 : 0);
  }
  return {losses, objectives, points: {terran: points.terran + objectives.terran, zerg: points.zerg + objectives.zerg}};
}

function resetPhase(s, phase) {
  s.phase = phase; s.actor = null; s.passed = {terran: false, zerg: false}; s.initiativeLock = null;
  s.units.forEach(u => { u.activated = false; });
}
export function reduce(state, event) {
  const s = clone(state);
  const unit = event.unit ? s.units.find(u => u.id === event.unit) : null;
  const note = message => { s.log.push(message); if (s.log.length > 250) s.log.shift(); };
  if (event.type === "CHECK") {
    require(["setup", "playing"].includes(s.stage), "This match is complete.");
    s.checks[String(event.key)] = Boolean(event.value);
  } else if (event.type === "LABEL") {
    s.labels[side(event.side)] = String(event.value).trim().slice(0,40) || event.side;
  } else if (event.type === "ENDS") {
    s.ends = String(event.value).slice(0,120);
  } else if (event.type === "NOTES") {
    s.notes = String(event.value).slice(0,6000);
  } else if (event.type === "MARKER") {
    s.marker = side(event.side);
    if (s.stage === "playing") s.initiativeLock = event.lock ? s.marker : null;
    note(`First Player Marker: ${s.marker}${s.initiativeLock ? " (card exception: locked this phase)" : ""}.`);
  } else if (event.type === "SETUP_BACK") {
    require(s.stage === "setup" && s.setupStep > 0, "No earlier setup step."); s.setupStep--;
  } else if (event.type === "SETUP_NEXT") {
    require(s.stage === "setup", "Setup has already ended.");
    require(SETUP[s.setupStep].checks.every((_,i) => s.checks[`setup-${s.setupStep}-${i}`]), "Complete this setup checklist first.");
    if (s.setupStep === SETUP.length - 1) { s.stage = "playing"; note("Match started. Round 1: Pool 3; all units in Reserves."); }
    else s.setupStep++;
  } else if (event.type === "STARTER") {
    require(s.stage === "playing" && ["movement", "assault", "combat"].includes(s.phase) && s.actor === null, "The phase has already started.");
    s.actor = side(event.side); note(`Round ${s.round}, ${s.phase}: ${s.actor} acts first (marker holder's choice).`);
  } else if (event.type === "ACT") {
    require(s.stage === "playing" && s.actor, "Choose who acts first.");
    require(unit && unit.side === s.actor && !s.passed[unit.side] && eligible(s,unit), "That unit cannot activate now.");
    const action = event.action;
    if (s.phase === "movement") {
      if (unit.status === "reserve") {
        require(action === "Deploy", "Reserve units must Deploy, not Hold or use ordinary abilities.");
        require(unit.supply <= available(s,unit.side), "Not enough Available Supply to deploy this unit.");
        unit.status = "field";
      } else require((unit.engaged ? ["Disengage", "Hold"] : ["Move", "Hold"]).includes(action), "Choose a legal Movement action.");
      if (action === "Disengage") { unit.engaged = false; unit.disengaged = true; unit.waived = Boolean(event.waive); }
    } else if (s.phase === "assault") {
      require(["Ranged Attack", "Charge", "Run", "Hold"].includes(action), "Choose an Assault action.");
      require(action !== "Ranged Attack" || unit.canShoot, "This selected unit has no ranged weapon.");
      require(!unit.engaged || !["Charge", "Run"].includes(action), "An engaged unit cannot Charge or make a normal Run.");
      require(!unit.disengaged || unit.waived || !["Ranged Attack", "Charge"].includes(action), "Disengage prevents shooting/charging unless a verified exception applies.");
    } else require(s.phase === "combat" && action === "Fight", "Choose a Combat activation.");
    unit.activated = true; note(`${s.phase}: ${unit.id} completed ${action}.`);
    if (!s.passed[other(unit.side)]) s.actor = other(unit.side);
  } else if (event.type === "PASS") {
    require(s.stage === "playing" && s.actor && !s.passed[s.actor], "No active player to pass.");
    const player = s.actor;
    if (s.phase === "combat") require(!s.units.some(u => u.side === player && eligible(s,u)), "Engaged eligible units must fight before passing.");
    require(["movement", "assault", "combat"].includes(s.phase), "Passing is only for activation phases.");
    if (!SIDES.some(p => s.passed[p]) && s.phase !== "combat" && !s.initiativeLock) s.marker = player;
    s.passed[player] = true; note(`${player} passed in ${s.phase}; no more activations for that player this phase.`);
    if (!s.passed[other(player)]) s.actor = other(player);
  } else if (event.type === "NEXT_PHASE") {
    require(s.stage === "playing" && canFinish(s), "Both players must finish this phase first.");
    const next = {movement: "assault", assault: "combat", combat: "scoring"}[s.phase];
    require(next, "Use the scoring or cleanup checklist.");
    resetPhase(s,next);
    if (next === "scoring") s.draftOwners = clone(s.owners);
    note(`Round ${s.round}: ${next}.`);
  } else if (event.type === "ENGAGED") {
    require(s.stage === "playing" && unit && unit.status === "field", "Only on-table units can be engaged.");
    unit.engaged = Boolean(event.value); note(`${unit.id}: engagement updated by player.`);
  } else if (event.type === "WAIVER") {
    require(s.stage === "playing" && unit && unit.disengaged, "This unit has not Disengaged this round.");
    unit.waived = Boolean(event.value); note(`${unit.id}: Disengage penalty exception ${unit.waived ? "confirmed" : "removed"} by player.`);
  } else if (event.type === "SUPPLY" || event.type === "DESTROY") {
    require(s.stage === "playing" && !["cleanup"].includes(s.phase) && unit && unit.status === "field", "Select an on-table unit before scoring is committed.");
    const value = event.type === "DESTROY" ? 0 : integer(event.value,0,1);
    s.losses[unit.side] = Math.max(0,s.losses[unit.side] + unit.supply - value);
    unit.supply = value;
    if (event.type === "DESTROY") { unit.status = "destroyed"; unit.engaged = false; }
    note(`${unit.id}: Supply ${value}${event.type === "DESTROY" ? "; Destroyed" : ""}. Supply-loss tally adjusted.`);
  } else if (event.type === "CARD") {
    require(s.stage === "playing", "Start the match first.");
    const player = side(event.side); integer(event.index,0,1);
    s.ready[player][event.index] = !s.ready[player][event.index];
    note(`${player} resource card ${event.index + 1}: ${s.ready[player][event.index] ? "Ready" : "Exhausted"}.`);
  } else if (event.type === "LOSS") {
    require(s.stage === "playing" && s.phase !== "cleanup", "This round's scores are already committed.");
    s.losses[side(event.side)] = integer(event.value,0,50);
  } else if (event.type === "OWNER") {
    require(s.stage === "playing" && s.phase === "scoring", "Determine control during Scoring.");
    require(["1", "5", "2"].includes(event.marker), "Unknown objective.");
    require(event.side === null || SIDES.includes(event.side), "Unknown owner.");
    // Sticky control: a marker already controlled cannot become unowned.
    require(event.side !== null || s.owners[event.marker] === null, "An owned marker stays owned; a tie does not make it neutral.");
    s.draftOwners[event.marker] = event.side;
  } else if (event.type === "SCORE") {
    require(s.stage === "playing" && s.phase === "scoring", "Scores can only be committed once in Scoring.");
    require(s.checks[`score-${s.round}-control`] && s.checks[`score-${s.round}-losses`], "Check control and Supply losses first.");
    const scored = previewScore(s);
    SIDES.forEach(p => { s.score[p] += scored.points[p]; });
    s.owners = clone(s.draftOwners);
    s.rounds.push({round: s.round, ...scored, totals: clone(s.score), owners: clone(s.owners)});
    note(`Round ${s.round} scored simultaneously: Terran +${scored.points.terran}, Zerg +${scored.points.zerg}.`);
    if (s.round === 5) s.units.filter(u => u.status === "reserve").forEach(u => { u.status = "destroyed"; u.supply = 0; });
    if (Math.abs(s.score.terran - s.score.zerg) >= 8 || s.round === 5) {
      s.stage = "conclusion";
      s.result = {winner: s.score.terran === s.score.zerg ? "draw" : s.score.terran > s.score.zerg ? "terran" : "zerg",
        reason: Math.abs(s.score.terran - s.score.zerg) >= 8 ? "Frontlines: lead of 8+ VP" : "Five rounds completed"};
    } else {
      s.phase = "cleanup"; s.actor = null;
      s.nextMarker = s.score.terran === s.score.zerg ? null : s.score.terran < s.score.zerg ? "terran" : "zerg";
    }
  } else if (event.type === "NEXT_MARKER") {
    require(s.stage === "playing" && s.phase === "cleanup", "Choose next-round initiative in Cleanup.");
    const expected = s.score.terran === s.score.zerg ? null : s.score.terran < s.score.zerg ? "terran" : "zerg";
    require(!expected || expected === event.side, "The player with fewer VP receives the marker; roll off only on a tie.");
    s.nextMarker = side(event.side);
  } else if (event.type === "NEXT_ROUND") {
    require(s.stage === "playing" && s.phase === "cleanup" && s.round < 5, "Finish Scoring before starting another round.");
    require(CLEANUP.every((_,i) => s.checks[`cleanup-${s.round}-${i}`]) && s.nextMarker, "Complete cleanup and assign next-round initiative.");
    s.round++; s.marker = s.nextMarker; s.nextMarker = null; s.losses = {terran: 0, zerg: 0};
    s.ready = {terran: [true,true], zerg: [true,true]}; resetPhase(s,"movement");
    s.units.forEach(u => { u.disengaged = false; u.waived = false; });
    note(`Round ${s.round} begins. Supply Pool ${pool(s) === Infinity ? "unlimited" : pool(s)}.`);
  } else if (event.type === "END") {
    require(s.stage === "playing" && ["terran", "zerg", "draw"].includes(event.winner), "Choose the agreed result.");
    require(String(event.reason || "").trim(), "Record why the match is ending, including any temporary ruling.");
    s.stage = "conclusion"; s.result = {winner: event.winner, reason: String(event.reason).slice(0,600)};
    note(`Manual conclusion: ${s.result.reason}`);
  } else throw new Error("Unknown match action.");
  return s;
}

export function validate(state, pack) {
  require(state && typeof state === "object" && state.schema === 1 && state.version === pack.version, "Unsupported match/reference version.");
  const expected = initial(pack);
  require(["setup","playing","conclusion"].includes(state.stage) && PHASES.includes(state.phase), "Invalid match stage.");
  integer(state.round,1,5); integer(state.setupStep,0,3); side(state.marker);
  require(state.actor === null || SIDES.includes(state.actor), "Invalid active player.");
  require(state.nextMarker === null || SIDES.includes(state.nextMarker), "Invalid next player.");
  require(state.initiativeLock === null || SIDES.includes(state.initiativeLock), "Invalid phase lock.");
  require(Array.isArray(state.units) && state.units.length === expected.units.length, "Invalid unit list.");
  state.units.forEach((u,i) => {
    require(u.id === expected.units[i].id && u.side === expected.units[i].side, "Unit identity mismatch.");
    require(u.canShoot === expected.units[i].canShoot, "Unit weapon eligibility mismatch.");
    integer(u.supply,0,1); require(["reserve","field","destroyed"].includes(u.status), "Invalid unit status.");
    require(typeof u.engaged === "boolean" && typeof u.activated === "boolean", "Invalid activation state.");
    require(typeof u.disengaged === "boolean" && typeof u.waived === "boolean", "Invalid Disengage state.");
    require(u.status !== "destroyed" || u.supply === 0, "Destroyed units cannot retain Supply.");
    require(u.status === "field" || !u.engaged, "Off-table units cannot be engaged.");
  });
  SIDES.forEach(p => {
    integer(state.score?.[p],0,10000); integer(state.losses?.[p],0,50);
    require(typeof state.passed?.[p] === "boolean", "Invalid pass state.");
    require(Array.isArray(state.ready?.[p]) && state.ready[p].length === 2 && state.ready[p].every(v => typeof v === "boolean"), "Invalid resource cards.");
    require(typeof state.labels?.[p] === "string" && state.labels[p].length <= 40, "Invalid player name.");
  });
  for (const owners of [state.owners, state.draftOwners]) for (const key of ["1","5","2"]) require(owners && (owners[key] === null || SIDES.includes(owners[key])), "Invalid objective ownership.");
  require(state.checks && typeof state.checks === "object" && !Array.isArray(state.checks) && Object.keys(state.checks).length < 100 && Object.values(state.checks).every(v => typeof v === "boolean"), "Invalid checklist.");
  require(typeof state.notes === "string" && state.notes.length <= 6000 && typeof state.ends === "string" && state.ends.length <= 120, "Invalid match notes.");
  require(Array.isArray(state.rounds) && state.rounds.length <= 5 && Array.isArray(state.log) && state.log.length <= 250 && state.log.every(v => typeof v === "string" && v.length <= 800), "Invalid match history.");
  let totals = {terran:0,zerg:0};
  state.rounds.forEach((r,i) => {
    require(r && r.round === i+1 && r.round <= state.round, "Invalid round history order.");
    SIDES.forEach(p => {
      integer(r.points?.[p],0,100); integer(r.totals?.[p],0,10000);
      integer(r.losses?.[p],0,50); integer(r.objectives?.[p],0,9);
      require(r.totals[p] === totals[p] + r.points[p], "Round totals do not match the score history.");
    });
    for(const key of ["1","5","2"]) require(r.owners && (r.owners[key] === null || SIDES.includes(r.owners[key])), "Invalid historical objective owner.");
    totals = r.totals;
  });
  require(SIDES.every(p => state.score[p] === totals[p]), "Current score does not match recorded rounds.");
  const completedRounds = state.phase === "cleanup" ? state.round : state.round-1;
  require(state.stage === "conclusion" ? [state.round-1,state.round].includes(state.rounds.length) : state.stage === "setup" ? state.rounds.length === 0 && state.round === 1 : state.rounds.length === completedRounds, "Round and phase do not match score history.");
  require(state.stage !== "conclusion" || (state.result && ["terran","zerg","draw"].includes(state.result.winner) && typeof state.result.reason === "string" && state.result.reason.length <= 600), "Invalid result.");
  return clone(state);
}
