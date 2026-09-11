import { useState, useEffect, useMemo, createContext, useContext } from "react";
import Papa from "papaparse";
import { storage } from "./storage";
import { SEED_TEAMS } from "./seedTeams";

const uid = () => Math.random().toString(36).slice(2, 9);

const C = {
  bg: "#F3F5EF",
  panel: "#FFFFFF",
  panelAlt: "#F6F7F2",
  border: "#E1E5DA",
  text: "#182018",
  sub: "#6E7568",
  primary: "#1B4332",
  accent: "#4C9A2A",
  accentBg: "#E7F2DB",
  violet: "#6C5CE7",
  red: "#D64545",
};

const DEFAULT_POSITIONS = ["Portero", "Lateral derecho", "Lateral izquierdo", "Central", "Mediocentro", "Interior", "Mediapunta", "Extremo derecha", "Extremo izquierda", "Delantero centro"];

const BADGE_COLORS = ["#4C9A2A", "#6C5CE7", "#E08A3C", "#2E9BC7", "#D6588F", "#2AA37A"];
function badgeColor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}
function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
const isKeeper = (p) => (p.positions || []).includes("Portero");

// ---------- UI: confirmaciones y avisos propios (alert/confirm nativos no funcionan en el entorno de artefactos) ----------
const UIContext = createContext(null);
function useUI() { return useContext(UIContext); }

function UIProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null); // { message, resolve }
  const [toast, setToast] = useState(null); // { message, tone }

  function confirmAction(message) {
    return new Promise((resolve) => setConfirmState({ message, resolve }));
  }
  function notify(message, tone = "warn") {
    setToast({ message, tone });
    setTimeout(() => setToast((t) => (t && t.message === message ? null : t)), 4500);
  }
  function resolveConfirm(result) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }

  return (
    <UIContext.Provider value={{ confirm: confirmAction, notify }}>
      {children}
      {confirmState && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,26,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 22, maxWidth: 380, width: "100%", border: `1px solid ${C.border}`, boxShadow: "0 12px 30px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 14.5, color: C.text, marginBottom: 18, lineHeight: 1.4 }}>{confirmState.message}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="lm-btn-outline" onClick={() => resolveConfirm(false)}>Cancelar</button>
              <button className="lm-btn" style={{ background: C.red }} onClick={() => resolveConfirm(true)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 1000, background: toast.tone === "error" ? "#FCEBEB" : "#FFF6DE", border: `1px solid ${toast.tone === "error" ? C.red : "#D8A93A"}`, color: toast.tone === "error" ? C.red : "#8A6416", padding: "10px 18px", borderRadius: 10, fontSize: 13.5, maxWidth: "90%", boxShadow: "0 8px 20px rgba(0,0,0,0.12)" }}>
          {toast.message}
        </div>
      )}
    </UIContext.Provider>
  );
}

// ---------- lógica de torneos (sin cambios funcionales) ----------
function roundRobin(ids, double) {
  let teams = [...ids];
  if (teams.length % 2 !== 0) teams.push(null);
  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  let arr = teams.slice();
  const schedule = [];
  for (let r = 0; r < rounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) roundMatches.push(i % 2 === 0 ? [a, b] : [b, a]);
    }
    schedule.push(roundMatches);
    const last = arr.pop();
    arr.splice(1, 0, last);
  }
  let matches = [];
  schedule.forEach((round, idx) => {
    round.forEach(([home, away]) => {
      matches.push({ id: uid(), phase: "liga", round: idx + 1, homeTeamId: home, awayTeamId: away, homeScore: null, awayScore: null, homeScorers: [], awayScorers: [], homeKeeperId: null, awayKeeperId: null });
    });
  });
  if (double) {
    const secondLeg = matches.map((m) => ({ ...m, id: uid(), round: m.round + rounds, homeTeamId: m.awayTeamId, awayTeamId: m.homeTeamId }));
    matches = matches.concat(secondLeg);
  }
  return matches;
}

function distributeGroups(teamIds, numGroups) {
  const groups = Array.from({ length: numGroups }, (_, i) => ({ name: `Grupo ${String.fromCharCode(65 + i)}`, teamIds: [] }));
  teamIds.forEach((id, idx) => groups[idx % numGroups].teamIds.push(id));
  return groups;
}

function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function generateKnockoutRound1(qualifiers) {
  const size = nextPow2(qualifiers.length);
  const byes = size - qualifiers.length;
  const pairs = [];
  for (let k = 0; k < byes; k++) pairs.push([qualifiers[k], null]);
  for (let k = byes; k < qualifiers.length; k += 2) pairs.push([qualifiers[k], qualifiers[k + 1]]);
  return pairs.map(([h, a]) => ({ id: uid(), phase: "knockout", round: 1, homeTeamId: h, awayTeamId: a, homeScore: null, awayScore: null, homeScorers: [], awayScorers: [], homeKeeperId: null, awayKeeperId: null }));
}

function winnerOf(m) {
  if (m.awayTeamId === null) return m.homeTeamId;
  if (m.homeTeamId === null) return m.awayTeamId;
  if (m.homeScore == null || m.awayScore == null) return null;
  if (m.homeScore === m.awayScore) return null;
  return m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;
}

function buildNextRound(currentRoundMatches, roundNumber) {
  const winners = currentRoundMatches.map(winnerOf);
  if (winners.some((w) => w === null)) return null;
  if (winners.length === 1) return { champion: winners[0] };
  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({ id: uid(), phase: "knockout", round: roundNumber, homeTeamId: winners[i], awayTeamId: winners[i + 1] ?? null, homeScore: null, awayScore: null, homeScorers: [], awayScorers: [], homeKeeperId: null, awayKeeperId: null });
  }
  return { matches };
}

function computeStandings(teamIds, matches, teams) {
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const table = {};
  teamIds.forEach((id) => (table[id] = { teamId: id, name: teamsById[id]?.name || "?", pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 }));
  matches.forEach((m) => {
    if (m.homeScore == null || m.awayScore == null || m.homeTeamId == null || m.awayTeamId == null) return;
    const H = table[m.homeTeamId], A = table[m.awayTeamId];
    if (!H || !A) return;
    H.pj++; A.pj++;
    H.gf += m.homeScore; H.gc += m.awayScore;
    A.gf += m.awayScore; A.gc += m.homeScore;
    if (m.homeScore > m.awayScore) { H.pg++; A.pp++; }
    else if (m.homeScore < m.awayScore) { A.pg++; H.pp++; }
    else { H.pe++; A.pe++; }
  });
  return Object.values(table).map((t) => ({ ...t, pts: t.pg * 3 + t.pe, dg: t.gf - t.gc })).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
}

function computeScorers(matches, playersById) {
  const agg = {};
  matches.forEach((m) => {
    [...(m.homeScorers || []), ...(m.awayScorers || [])].forEach((s) => {
      if (!s.playerId) return;
      agg[s.playerId] = agg[s.playerId] || { playerId: s.playerId, goals: 0, matches: new Set() };
      agg[s.playerId].goals += Number(s.goals) || 0;
      agg[s.playerId].matches.add(m.id);
    });
  });
  return Object.values(agg).map((a) => ({ playerId: a.playerId, goals: a.goals, pj: a.matches.size, media: a.goals / a.matches.size, ...(playersById[a.playerId] || {}) })).sort((a, b) => b.goals - a.goals);
}

function computeKeepers(matches, playersById) {
  const agg = {};
  matches.forEach((m) => {
    if (m.homeScore == null || m.awayScore == null) return;
    if (m.homeKeeperId) { agg[m.homeKeeperId] = agg[m.homeKeeperId] || { playerId: m.homeKeeperId, pj: 0, gc: 0 }; agg[m.homeKeeperId].pj++; agg[m.homeKeeperId].gc += m.awayScore; }
    if (m.awayKeeperId) { agg[m.awayKeeperId] = agg[m.awayKeeperId] || { playerId: m.awayKeeperId, pj: 0, gc: 0 }; agg[m.awayKeeperId].pj++; agg[m.awayKeeperId].gc += m.homeScore; }
  });
  return Object.values(agg).map((a) => ({ ...a, ...(playersById[a.playerId] || {}), media: a.gc / a.pj })).sort((a, b) => a.media - b.media);
}

function migrateTeams(raw) {
  return raw.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, positions: p.positions || (p.position ? [p.position] : []) })) }));
}

// ---------- componente raíz ----------
export default function LigaManagerRoot() {
  return (
    <UIProvider>
      <LigaManager />
    </UIProvider>
  );
}

function LigaManager() {
  const ui = useUI();
  const [teams, setTeams] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [customPositions, setCustomPositions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("equipos");
  const [activeCompId, setActiveCompId] = useState(null);
  const [compTab, setCompTab] = useState("calendario");
  const [csvError, setCsvError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const t = await storage.get("ft-teams");
        if (t) setTeams(migrateTeams(JSON.parse(t.value)));
        else setTeams(migrateTeams(SEED_TEAMS));
      } catch { setTeams(migrateTeams(SEED_TEAMS)); }
      try { const c = await storage.get("ft-competitions"); if (c) setCompetitions(JSON.parse(c.value)); } catch {}
      try { const cp = await storage.get("ft-custom-positions"); if (cp) setCustomPositions(JSON.parse(cp.value)); } catch {}
      setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) storage.set("ft-teams", JSON.stringify(teams)).catch(() => {}); }, [teams, loaded]);
  useEffect(() => { if (loaded) storage.set("ft-competitions", JSON.stringify(competitions)).catch(() => {}); }, [competitions, loaded]);
  useEffect(() => { if (loaded) storage.set("ft-custom-positions", JSON.stringify(customPositions)).catch(() => {}); }, [customPositions, loaded]);

  const playersById = useMemo(() => {
    const o = {};
    teams.forEach((t) => t.players.forEach((p) => (o[p.id] = { name: p.name, positions: p.positions, teamName: t.name })));
    return o;
  }, [teams]);

  const activeComp = competitions.find((c) => c.id === activeCompId) || null;

  function addTeam(name) {
    const n = name.trim();
    if (!n) return;
    if (teams.some((t) => t.name.toLowerCase() === n.toLowerCase())) { ui.notify("Ya existe un equipo con ese nombre.", "error"); return; }
    setTeams((prev) => [...prev, { id: uid(), name: n, players: [] }]);
  }
  async function deleteTeam(id) {
    const t = teams.find((x) => x.id === id);
    const ok = await ui.confirm(`¿Eliminar el equipo "${t?.name}" y toda su plantilla? Esta acción no se puede deshacer.`);
    if (!ok) return;
    setTeams((prev) => prev.filter((x) => x.id !== id));
  }
  function addPlayer(teamId, name, positions) {
    const n = name.trim();
    if (!n) return;
    const team = teams.find((t) => t.id === teamId);
    if (team && team.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) { ui.notify("Ya existe un jugador con ese nombre en este equipo.", "error"); return; }
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, players: [...t.players, { id: uid(), name: n, positions: positions || [] }] } : t)));
  }
  async function removePlayer(teamId, playerId) {
    const t = teams.find((x) => x.id === teamId);
    const p = t?.players.find((x) => x.id === playerId);
    const ok = await ui.confirm(`¿Eliminar a ${p?.name}?`);
    if (!ok) return;
    setTeams((prev) => prev.map((x) => (x.id === teamId ? { ...x, players: x.players.filter((y) => y.id !== playerId) } : x)));
  }
  function editPlayer(teamId, playerId, patch) {
    const team = teams.find((t) => t.id === teamId);
    if (team && patch.name != null) {
      const n = patch.name.trim();
      if (team.players.some((p) => p.id !== playerId && p.name.toLowerCase() === n.toLowerCase())) { ui.notify("Ya existe un jugador con ese nombre en este equipo.", "error"); return; }
    }
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, players: t.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)) } : t)));
  }
  function addCustomPosition(name) {
    const n = name.trim();
    if (!n) return;
    if (DEFAULT_POSITIONS.includes(n) || customPositions.includes(n)) return;
    setCustomPositions((prev) => [...prev, n]);
  }
  async function deleteCustomPosition(name) {
    const inUse = teams.some((t) => t.players.some((p) => (p.positions || []).includes(name)));
    if (inUse) { ui.notify("No se puede eliminar: hay jugadores con esta posición asignada.", "error"); return; }
    const ok = await ui.confirm(`¿Eliminar la posición "${name}"?`);
    if (!ok) return;
    setCustomPositions((prev) => prev.filter((p) => p !== name));
  }

  function handleCsv(file) {
    setCsvError("");
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        try {
          const rows = res.data;
          setTeams((prev) => {
            const byName = Object.fromEntries(prev.map((t) => [t.name.toLowerCase(), { ...t, players: [...t.players] }]));
            rows.forEach((r) => {
              const teamName = (r["Equipo"] || "").trim();
              const playerName = (r["Nombre jugador"] || "").trim();
              const posRaw = (r["Posición"] || r["Posicion"] || "").trim();
              const positions = posRaw ? posRaw.split(/[,/]/).map((s) => s.trim()).filter(Boolean) : [];
              if (!teamName || !playerName) return;
              const key = teamName.toLowerCase();
              if (!byName[key]) byName[key] = { id: uid(), name: teamName, players: [] };
              if (byName[key].players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) return;
              byName[key].players.push({ id: uid(), name: playerName, positions });
            });
            return Object.values(byName);
          });
        } catch { setCsvError("No se pudo leer el CSV. Revisa las columnas: Nombre jugador, Posición, Equipo."); }
      },
      error: () => setCsvError("No se pudo leer el archivo."),
    });
  }

  function createCompetition(form) {
    const base = { id: uid(), name: form.name || "Nueva competición", type: form.type, teamIds: form.teamIds, championId: null };
    if (form.type === "liga") {
      setCompetitions((prev) => [...prev, { ...base, matches: roundRobin(form.teamIds, form.double), stage: "liga" }]);
    } else {
      const groups = distributeGroups(form.teamIds, form.numGroups);
      let matches = [];
      groups.forEach((g) => { roundRobin(g.teamIds, form.double).forEach((m) => matches.push({ ...m, phase: "group", groupName: g.name })); });
      setCompetitions((prev) => [...prev, { ...base, groups, qualifyPerGroup: form.qualifyPerGroup, matches, stage: "grupos" }]);
    }
    setTab("competiciones");
  }
  async function deleteCompetition(id) {
    const c = competitions.find((x) => x.id === id);
    const ok = await ui.confirm(`¿Eliminar la competición "${c?.name}"? Se perderá todo el calendario y los resultados.`);
    if (!ok) return;
    setCompetitions((prev) => prev.filter((x) => x.id !== id));
    if (activeCompId === id) setActiveCompId(null);
  }
  function updateMatch(compId, matchId, patch) { setCompetitions((prev) => prev.map((c) => (c.id !== compId ? c : { ...c, matches: c.matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m)) }))); }
  function generateKnockout(comp) {
    const qualifiersByGroup = comp.groups.map((g) => computeStandings(g.teamIds, comp.matches.filter((m) => m.groupName === g.name), teams).slice(0, comp.qualifyPerGroup).map((s) => s.teamId));
    const maxLen = Math.max(...qualifiersByGroup.map((q) => q.length));
    const seeded = [];
    for (let pos = 0; pos < maxLen; pos++) qualifiersByGroup.forEach((q) => { if (q[pos]) seeded.push(q[pos]); });
    const round1 = generateKnockoutRound1(seeded);
    setCompetitions((prev) => prev.map((c) => (c.id !== comp.id ? c : { ...c, matches: [...c.matches, ...round1], stage: "eliminatorias" })));
  }
  function generateNextRound(comp) {
    const curRound = Math.max(...comp.matches.filter((m) => m.phase === "knockout").map((m) => m.round));
    const curMatches = comp.matches.filter((m) => m.phase === "knockout" && m.round === curRound);
    const res = buildNextRound(curMatches, curRound + 1);
    if (!res) return;
    if (res.champion) setCompetitions((prev) => prev.map((c) => (c.id !== comp.id ? c : { ...c, championId: res.champion })));
    else setCompetitions((prev) => prev.map((c) => (c.id !== comp.id ? c : { ...c, matches: [...c.matches, ...res.matches] })));
  }

  return (
    <div style={{ background: C.bg, minHeight: "100%", color: C.text, fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif" }}>
      <GlobalStyle />
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.panel }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 16 }}>⚽</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Liga Manager</div>
            <div style={{ fontSize: 12, color: C.sub }}>equipos · competiciones · estadísticas</div>
          </div>
        </div>
        <Pills options={[{ k: "equipos", label: "Equipos" }, { k: "competiciones", label: "Competiciones" }]} value={tab} onChange={(k) => { setTab(k); setActiveCompId(null); }} />
      </header>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 60px" }}>
        {tab === "equipos" && (
          <EquiposView
            teams={teams} customPositions={customPositions}
            onAddTeam={addTeam} onDeleteTeam={deleteTeam} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onEditPlayer={editPlayer}
            onAddCustomPosition={addCustomPosition} onDeleteCustomPosition={deleteCustomPosition}
            onCsv={handleCsv} csvError={csvError}
          />
        )}
        {tab === "competiciones" && !activeComp && (
          <CompeticionesListView teams={teams} competitions={competitions} onCreate={createCompetition} onOpen={setActiveCompId} onDelete={deleteCompetition} />
        )}
        {tab === "competiciones" && activeComp && (
          <CompeticionDetalle
            comp={activeComp} teams={teams} playersById={playersById} compTab={compTab} setCompTab={setCompTab}
            onBack={() => setActiveCompId(null)}
            onUpdateMatch={(matchId, patch) => updateMatch(activeComp.id, matchId, patch)}
            onGenerateKnockout={() => generateKnockout(activeComp)}
            onGenerateNextRound={() => generateNextRound(activeComp)}
          />
        )}
      </div>
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      .lm-mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace; font-weight: 700; }
      .lm-card { background:${C.panel}; border:1px solid ${C.border}; border-radius:14px; padding:20px; margin-bottom:16px; }
      .lm-btn { background:${C.primary}; color:#fff; border:none; padding:10px 16px; font-weight:700; cursor:pointer; border-radius:9px; font-size:14px; transition:opacity .15s; }
      .lm-btn:hover { opacity:.88; }
      .lm-btn:disabled { opacity:.35; cursor:not-allowed; }
      .lm-btn-outline { background:#fff; border:1px solid ${C.border}; color:${C.text}; padding:8px 14px; border-radius:9px; cursor:pointer; font-size:13px; font-weight:600; transition:border-color .15s; }
      .lm-btn-outline:hover { border-color:${C.primary}; }
      .lm-input { background:${C.panelAlt}; border:1px solid ${C.border}; color:${C.text}; padding:9px 11px; border-radius:8px; font-size:14px; outline:none; }
      .lm-input:focus { border-color:${C.primary}; }
      .lm-input::placeholder { color:${C.sub}; }
      table.lm-table { width:100%; border-collapse:collapse; font-size:13.5px; }
      table.lm-table th { text-align:left; padding:8px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:${C.sub}; border-bottom:1px solid ${C.border}; font-weight:700; }
      table.lm-table td { padding:9px 10px; border-bottom:1px solid ${C.border}; }
      table.lm-table tr:last-child td { border-bottom:none; }
      table.lm-table tr:hover td { background:${C.panelAlt}; }
      select.lm-input { -webkit-appearance:none; appearance:none; }
      ::-webkit-scrollbar { height:8px; width:8px; }
      ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:8px; }
    `}</style>
  );
}

function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, width: "fit-content" }}>
      {options.map((o) => (
        <div key={o.k} onClick={() => onChange(o.k)} style={{ padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700, background: value === o.k ? C.primary : "transparent", color: value === o.k ? "#fff" : C.sub }}>
          {o.label}
        </div>
      ))}
    </div>
  );
}

function TeamBadge({ name, size = 30 }) {
  const bg = badgeColor(name);
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: bg + "1F", color: bg, border: `1px solid ${bg}55`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.36, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

// ---------- selector múltiple de posiciones ----------
function PositionMultiSelect({ selected, onChange, customPositions, onAddCustom, style }) {
  const [newPos, setNewPos] = useState("");
  const all = [...DEFAULT_POSITIONS, ...customPositions];
  const hasPortero = selected.includes("Portero");

  function toggle(pos) {
    if (pos === "Portero") onChange(hasPortero ? [] : ["Portero"]);
    else if (!hasPortero) onChange(selected.includes(pos) ? selected.filter((p) => p !== pos) : [...selected, pos]);
  }
  function addCustom() {
    const n = newPos.trim();
    if (!n) return;
    onAddCustom(n);
    if (!hasPortero) onChange([...new Set([...selected, n])]);
    setNewPos("");
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, background: C.panelAlt, ...style }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {all.map((pos) => {
          const active = selected.includes(pos);
          const disabled = pos === "Portero" ? (selected.length > 0 && !hasPortero) : hasPortero;
          return (
            <div key={pos} onClick={() => !disabled && toggle(pos)} style={{ padding: "4px 9px", borderRadius: 999, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", border: `1px solid ${active ? C.primary : C.border}`, background: active ? C.accentBg : "#fff", color: disabled ? C.sub : C.text, opacity: disabled ? 0.5 : 1 }}>
              {pos}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input className="lm-input" placeholder="Nueva posición…" value={newPos} onChange={(e) => setNewPos(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "6px 8px" }} />
        <button type="button" className="lm-btn-outline" onClick={addCustom} style={{ padding: "6px 10px", fontSize: 12 }}>Añadir</button>
      </div>
    </div>
  );
}

// ---------- vista equipos ----------
function EquiposView({ teams, customPositions, onAddTeam, onDeleteTeam, onAddPlayer, onRemovePlayer, onEditPlayer, onAddCustomPosition, onDeleteCustomPosition, onCsv, csvError }) {
  const [newTeam, setNewTeam] = useState("");
  const [openTeam, setOpenTeam] = useState(null);
  const [pName, setPName] = useState("");
  const [pPos, setPPos] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [eName, setEName] = useState("");
  const [ePos, setEPos] = useState([]);

  function startEdit(p) { setEditingId(p.id); setEName(p.name); setEPos(p.positions || []); }
  function saveEdit(teamId) { onEditPlayer(teamId, editingId, { name: eName.trim(), positions: ePos }); setEditingId(null); }

  return (
    <div>
      <div className="lm-card">
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input className="lm-input" style={{ flex: 1, minWidth: 200 }} placeholder="Nombre del equipo" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
          <button className="lm-btn" onClick={() => { onAddTeam(newTeam); setNewTeam(""); }}>+ Añadir equipo</button>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 8 }}>
            Cargar jugadores por CSV — columnas <span style={{ color: C.text }}>Nombre jugador, Posición, Equipo</span>. Crea equipos automáticamente si no existen.
          </div>
          <label className="lm-btn-outline" style={{ display: "inline-block" }}>
            Elegir archivo CSV
            <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onCsv(e.target.files[0])} />
          </label>
          {csvError && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{csvError}</div>}
        </div>
      </div>

      {customPositions.length > 0 && (
        <div className="lm-card">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Posiciones personalizadas</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {customPositions.map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 999, padding: "4px 6px 4px 10px", fontSize: 12 }}>
                {p}
                <span onClick={() => onDeleteCustomPosition(p)} style={{ cursor: "pointer", color: C.red, fontWeight: 800, padding: "0 4px" }}>×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {teams.length === 0 && <div style={{ color: C.sub, textAlign: "center", padding: 30 }}>Aún no hay equipos. Añade uno o carga un CSV.</div>}

      {teams.map((t) => (
        <div key={t.id} className="lm-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <TeamBadge name={t.name} size={38} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: C.sub }}>{t.players.length} jugadores</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="lm-btn-outline" onClick={() => setOpenTeam(openTeam === t.id ? null : t.id)}>{openTeam === t.id ? "Cerrar" : "Ver plantilla"}</button>
              <button className="lm-btn-outline" onClick={() => onDeleteTeam(t.id)} style={{ color: C.red }}>Eliminar</button>
            </div>
          </div>
          {openTeam === t.id && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <table className="lm-table">
                <thead><tr><th>Jugador</th><th>Posiciones</th><th></th></tr></thead>
                <tbody>
                  {t.players.map((p) => (
                    <tr key={p.id}>
                      {editingId === p.id ? (
                        <>
                          <td><input className="lm-input" value={eName} onChange={(e) => setEName(e.target.value)} /></td>
                          <td><PositionMultiSelect selected={ePos} onChange={setEPos} customPositions={customPositions} onAddCustom={onAddCustomPosition} /></td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                            <button className="lm-btn-outline" onClick={() => saveEdit(t.id)} style={{ marginRight: 6 }}>Guardar</button>
                            <button className="lm-btn-outline" onClick={() => setEditingId(null)}>Cancelar</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{p.name}</td>
                          <td>{(p.positions || []).join(", ") || <span style={{ color: C.sub }}>—</span>}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <button className="lm-btn-outline" onClick={() => startEdit(p)} style={{ marginRight: 6 }}>Editar</button>
                            <button className="lm-btn-outline" onClick={() => onRemovePlayer(t.id, p.id)} style={{ color: C.red }}>Quitar</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <input className="lm-input" placeholder="Nombre jugador" value={pName} onChange={(e) => setPName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <PositionMultiSelect selected={pPos} onChange={setPPos} customPositions={customPositions} onAddCustom={onAddCustomPosition} style={{ minWidth: 260 }} />
                <button className="lm-btn" onClick={() => { onAddPlayer(t.id, pName, pPos); setPName(""); setPPos([]); }}>Añadir</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- lista/creación de competiciones ----------
function CompeticionesListView({ teams, competitions, onCreate, onOpen, onDelete }) {
  const [form, setForm] = useState({ name: "", type: "liga", teamIds: [], double: false, numGroups: 2, qualifyPerGroup: 2 });
  const toggleTeam = (id) => setForm((f) => ({ ...f, teamIds: f.teamIds.includes(id) ? f.teamIds.filter((x) => x !== id) : [...f.teamIds, id] }));

  return (
    <div>
      <div className="lm-card">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Nueva competición</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <input className="lm-input" placeholder="Nombre de la competición" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          <select className="lm-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="liga">Liga (todos contra todos)</option>
            <option value="torneo">Torneo (liguilla + playoff)</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub }}><input type="checkbox" checked={form.double} onChange={(e) => setForm({ ...form, double: e.target.checked })} /> Ida y vuelta</label>
        </div>
        {form.type === "torneo" && (
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 13, color: C.sub }}>
            <label>Nº de grupos <input className="lm-input" type="number" min={1} value={form.numGroups} onChange={(e) => setForm({ ...form, numGroups: Number(e.target.value) })} style={{ width: 60, marginLeft: 8 }} /></label>
            <label>Clasifican por grupo <input className="lm-input" type="number" min={1} value={form.qualifyPerGroup} onChange={(e) => setForm({ ...form, qualifyPerGroup: Number(e.target.value) })} style={{ width: 60, marginLeft: 8 }} /></label>
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 8 }}>Equipos participantes</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {teams.map((t) => {
              const active = form.teamIds.includes(t.id);
              return (
                <label key={t.id} style={{ border: `1px solid ${active ? C.primary : C.border}`, borderRadius: 8, padding: "6px 10px", display: "flex", gap: 6, alignItems: "center", background: active ? C.accentBg : "transparent", cursor: "pointer", fontSize: 13 }}>
                  <input type="checkbox" checked={active} onChange={() => toggleTeam(t.id)} /> {t.name}
                </label>
              );
            })}
          </div>
        </div>
        <button className="lm-btn" disabled={form.teamIds.length < 2} onClick={() => onCreate(form)}>Crear competición y generar calendario</button>
      </div>

      {competitions.map((c) => (
        <div key={c.id} className="lm-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: C.sub }}>{c.type === "liga" ? "Liga" : "Torneo"} · {c.teamIds.length} equipos</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="lm-btn" onClick={() => onOpen(c.id)}>Abrir</button>
            <button className="lm-btn-outline" onClick={() => onDelete(c.id)} style={{ color: C.red }}>Eliminar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- detalle de competición ----------
function CompeticionDetalle({ comp, teams, playersById, compTab, setCompTab, onBack, onUpdateMatch, onGenerateKnockout, onGenerateNextRound }) {
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const groupMatches = comp.matches.filter((m) => m.phase === "group");
  const ligaMatches = comp.matches.filter((m) => m.phase === "liga");
  const knockoutMatches = comp.matches.filter((m) => m.phase === "knockout");
  const allGroupDone = comp.type === "torneo" && groupMatches.length > 0 && groupMatches.every((m) => m.homeScore != null && m.awayScore != null);
  const curKORound = knockoutMatches.length ? Math.max(...knockoutMatches.map((m) => m.round)) : 0;
  const curKOMatches = knockoutMatches.filter((m) => m.round === curKORound);
  const curKORoundDone = curKOMatches.length > 0 && curKOMatches.every((m) => winnerOf(m) != null);
  const standingsGlobalMatches = comp.type === "liga" ? ligaMatches : groupMatches;

  return (
    <div>
      <button className="lm-btn-outline" style={{ marginBottom: 16 }} onClick={onBack}>← Competiciones</button>
      <div className="lm-card">
        <div style={{ fontWeight: 800, fontSize: 19 }}>{comp.name}</div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{comp.type === "liga" ? "Liga · todos contra todos" : `Torneo · ${comp.groups?.length} grupos · fase actual: ${comp.stage}`}</div>
        {comp.championId && <div style={{ marginTop: 10, fontWeight: 800, color: C.accent, fontSize: 15 }}>🏆 Campeón: {teamsById[comp.championId]?.name}</div>}
      </div>

      <Pills
        options={[{ k: "calendario", label: "Calendario" }, { k: "clasificacion", label: "Clasificación" }, { k: "goleadores", label: "Goleadores" }, { k: "porteros", label: "Porteros" }]}
        value={compTab} onChange={setCompTab}
      />
      <div style={{ height: 16 }} />

      {compTab === "calendario" && (
        <div>
          {comp.type === "torneo" && (
            <>
              {comp.groups.map((g) => (
                <div key={g.name} className="lm-card">
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>{g.name}</div>
                  {groupMatches.filter((m) => m.groupName === g.name).sort((a, b) => a.round - b.round).map((m) => (
                    <MatchRow key={m.id} m={m} teamsById={teamsById} onUpdate={(p) => onUpdateMatch(m.id, p)} />
                  ))}
                </div>
              ))}
              {allGroupDone && comp.stage === "grupos" && <button className="lm-btn" onClick={onGenerateKnockout}>Generar eliminatorias</button>}
              {knockoutMatches.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {Array.from(new Set(knockoutMatches.map((m) => m.round))).sort((a, b) => a - b).map((r) => (
                    <div key={r} className="lm-card">
                      <div style={{ fontSize: 12, fontWeight: 800, color: C.violet, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Ronda {r}</div>
                      {knockoutMatches.filter((m) => m.round === r).map((m) => (
                        <MatchRow key={m.id} m={m} teamsById={teamsById} onUpdate={(p) => onUpdateMatch(m.id, p)} knockout />
                      ))}
                    </div>
                  ))}
                  {curKORoundDone && !comp.championId && <button className="lm-btn" onClick={onGenerateNextRound}>Generar siguiente ronda</button>}
                </div>
              )}
            </>
          )}
          {comp.type === "liga" && Array.from(new Set(ligaMatches.map((m) => m.round))).sort((a, b) => a - b).map((r) => (
            <div key={r} className="lm-card">
              <div style={{ fontSize: 12, fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Jornada {r}</div>
              {ligaMatches.filter((m) => m.round === r).map((m) => (
                <MatchRow key={m.id} m={m} teamsById={teamsById} onUpdate={(p) => onUpdateMatch(m.id, p)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {compTab === "clasificacion" && (
        comp.type === "torneo" ? comp.groups.map((g) => (
          <div key={g.name} className="lm-card">
            <div style={{ fontSize: 12, fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>{g.name}</div>
            <StandingsTable rows={computeStandings(g.teamIds, groupMatches.filter((m) => m.groupName === g.name), teams)} />
          </div>
        )) : <div className="lm-card"><StandingsTable rows={computeStandings(comp.teamIds, standingsGlobalMatches, teams)} /></div>
      )}

      {compTab === "goleadores" && (
        <div className="lm-card">
          <table className="lm-table">
            <thead><tr><th>#</th><th>Jugador</th><th>Equipo</th><th>PJ</th><th style={{ textAlign: "right" }}>Media/partido</th><th style={{ textAlign: "right" }}>Goles</th></tr></thead>
            <tbody>
              {computeScorers(comp.matches, playersById).map((s, i) => (
                <tr key={s.playerId}><td>{i + 1}</td><td>{s.name}</td><td style={{ color: C.sub }}>{s.teamName}</td><td>{s.pj}</td><td className="lm-mono" style={{ textAlign: "right" }}>{s.media.toFixed(2)}</td><td className="lm-mono" style={{ textAlign: "right", color: C.accent }}>{s.goals}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compTab === "porteros" && (
        <div className="lm-card">
          <table className="lm-table">
            <thead><tr><th>#</th><th>Portero</th><th>Equipo</th><th>PJ</th><th>Encajados</th><th style={{ textAlign: "right" }}>Media/partido</th></tr></thead>
            <tbody>
              {computeKeepers(comp.matches, playersById).map((k, i) => (
                <tr key={k.playerId}><td>{i + 1}</td><td>{k.name}</td><td style={{ color: C.sub }}>{k.teamName}</td><td>{k.pj}</td><td>{k.gc}</td><td className="lm-mono" style={{ textAlign: "right", color: C.accent }}>{k.media.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StandingsTable({ rows }) {
  return (
    <table className="lm-table">
      <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th style={{ textAlign: "right" }}>Pts</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.teamId}>
            <td>{i + 1}</td>
            <td style={{ display: "flex", alignItems: "center", gap: 8 }}><TeamBadge name={r.name} size={22} />{r.name}</td>
            <td>{r.pj}</td><td>{r.pg}</td><td>{r.pe}</td><td>{r.pp}</td><td>{r.gf}</td><td>{r.gc}</td><td>{r.dg}</td>
            <td className="lm-mono" style={{ textAlign: "right", color: C.accent }}>{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- fila de partido con edición de resultado ----------
function MatchRow({ m, teamsById, onUpdate, knockout }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const [hs, setHs] = useState(m.homeScore ?? 0);
  const [as, setAs] = useState(m.awayScore ?? 0);
  const [hScorers, setHScorers] = useState(m.homeScorers?.length ? m.homeScorers : [{ playerId: "", goals: 1 }]);
  const [aScorers, setAScorers] = useState(m.awayScorers?.length ? m.awayScorers : [{ playerId: "", goals: 1 }]);
  const [hKeeper, setHKeeper] = useState(m.homeKeeperId || "");
  const [aKeeper, setAKeeper] = useState(m.awayKeeperId || "");

  if (m.awayTeamId === null || m.homeTeamId === null) {
    const t = teamsById[m.homeTeamId] || teamsById[m.awayTeamId];
    return <div style={{ padding: "8px 0", fontSize: 13, color: C.sub }}>{t?.name} avanza por BYE</div>;
  }
  const homeTeam = teamsById[m.homeTeamId], awayTeam = teamsById[m.awayTeamId];
  const played = m.homeScore != null;

  const sumH = hScorers.filter((s) => s.playerId).reduce((a, s) => a + (Number(s.goals) || 0), 0);
  const sumA = aScorers.filter((s) => s.playerId).reduce((a, s) => a + (Number(s.goals) || 0), 0);
  const H = Number(hs) || 0, A = Number(as) || 0;
  const overH = sumH > H, overA = sumA > A;
  const underH = sumH < H, underA = sumA < A;
  const zeroGoalScorer = [...hScorers, ...aScorers].some((s) => s.playerId && (Number(s.goals) || 0) < 1);

  function save() {
    if (knockout && H === A) { ui.notify("En eliminatoria no puede haber empate. Indica el resultado final (p.ej. tras penaltis).", "error"); return; }
    if (zeroGoalScorer) { ui.notify("Cada goleador debe tener al menos 1 gol. Elimínalo si no anotó.", "error"); return; }
    if (overH || overA) { ui.notify("Los goles de los goleadores superan el resultado del partido. Corrígelo antes de guardar.", "error"); return; }
    onUpdate({ homeScore: H, awayScore: A, homeScorers: hScorers.filter((s) => s.playerId), awayScorers: aScorers.filter((s) => s.playerId), homeKeeperId: hKeeper || null, awayKeeperId: aKeeper || null });
    setOpen(false);
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", fontSize: 13.5, fontWeight: 600 }}>{homeTeam?.name}<TeamBadge name={homeTeam?.name} size={24} /></div>
        <div className="lm-mono" style={{ minWidth: 56, textAlign: "center", padding: "4px 10px", borderRadius: 7, background: played ? C.panelAlt : "transparent", border: `1px solid ${played ? C.border : "transparent"}`, fontSize: 14, color: C.primary }}>
          {played ? `${m.homeScore} - ${m.awayScore}` : "vs"}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600 }}><TeamBadge name={awayTeam?.name} size={24} />{awayTeam?.name}</div>
        <button className="lm-btn-outline" onClick={() => setOpen(!open)}>{open ? "Cerrar" : played ? "Editar" : "Registrar"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12, background: C.panelAlt, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", justifyContent: "center" }}>
            <input className="lm-input lm-mono" type="number" min={0} style={{ width: 60, textAlign: "center" }} value={hs} onChange={(e) => setHs(e.target.value)} />
            <span style={{ color: C.sub }}>—</span>
            <input className="lm-input lm-mono" type="number" min={0} style={{ width: 60, textAlign: "center" }} value={as} onChange={(e) => setAs(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <TeamMatchInputs label={homeTeam?.name} team={homeTeam} scorers={hScorers} setScorers={setHScorers} keeper={hKeeper} setKeeper={setHKeeper} sum={sumH} target={H} over={overH} under={underH} />
            <TeamMatchInputs label={awayTeam?.name} team={awayTeam} scorers={aScorers} setScorers={setAScorers} keeper={aKeeper} setKeeper={setAKeeper} sum={sumA} target={A} over={overA} under={underA} />
          </div>
          <button className="lm-btn" style={{ marginTop: 14 }} onClick={save}>Guardar resultado</button>
        </div>
      )}
    </div>
  );
}

function TeamMatchInputs({ label, team, scorers, setScorers, keeper, setKeeper, sum, target, over, under }) {
  if (!team) return null;
  const keepers = team.players.filter(isKeeper);
  const outfield = team.players.filter((p) => !isKeeper(p));
  const defaultKeeper = keepers[0];
  useEffect(() => { if (!keeper && defaultKeeper) setKeeper(defaultKeeper.id); }, []); // eslint-disable-line

  return (
    <div style={{ minWidth: 230, flex: 1 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: C.text }}>{label}</div>
      <div style={{ fontSize: 11, color: C.sub, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Portero</div>
      <select className="lm-input" style={{ width: "100%", marginBottom: 10 }} value={keeper} onChange={(e) => setKeeper(e.target.value)}>
        <option value="">— sin especificar —</option>
        {keepers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {keepers.length === 0 && <div style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>No hay jugadores marcados como Portero en este equipo.</div>}

      <div style={{ fontSize: 11, color: C.sub, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Goleadores</div>
      {scorers.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <select className="lm-input" style={{ flex: 1 }} value={s.playerId} onChange={(e) => setScorers(scorers.map((x, j) => (j === i ? { ...x, playerId: e.target.value } : x)))}>
            <option value="">— jugador —</option>
            {outfield.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="lm-input" type="number" min={1} style={{ width: 55 }} value={s.goals} onChange={(e) => setScorers(scorers.map((x, j) => (j === i ? { ...x, goals: e.target.value } : x)))} />
        </div>
      ))}
      <button className="lm-btn-outline" onClick={() => setScorers([...scorers, { playerId: "", goals: 1 }])}>+ Goleador</button>
      {target != null && (
        <div style={{ fontSize: 12, marginTop: 8, color: over ? C.red : under ? "#B8860B" : C.sub }}>
          {over && `Los goleadores suman ${sum}, más que el resultado (${target}).`}
          {!over && under && `Aviso: los goleadores suman ${sum} de ${target} goles.`}
          {!over && !under && `Goles asignados: ${sum}/${target}.`}
        </div>
      )}
    </div>
  );
}
