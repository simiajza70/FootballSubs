import { useState, useEffect, useRef, useCallback, Component } from "react";

// ---- Constants ----

const POSITIONS = [
  { id: "GK",  label: "GK",  x: 50, y: 88 },
  { id: "LB",  label: "LB",  x: 18, y: 70 },
  { id: "CB1", label: "CB",  x: 37, y: 70 },
  { id: "CB2", label: "CB",  x: 63, y: 70 },
  { id: "RB",  label: "RB",  x: 82, y: 70 },
  { id: "LM",  label: "LM",  x: 15, y: 50 },
  { id: "CM1", label: "CM",  x: 35, y: 50 },
  { id: "CM2", label: "CM",  x: 65, y: 50 },
  { id: "RM",  label: "RM",  x: 85, y: 50 },
  { id: "LW",  label: "LW",  x: 22, y: 28 },
  { id: "ST",  label: "ST",  x: 50, y: 22 },
  { id: "RW",  label: "RW",  x: 78, y: 28 },
];

// Categorize each position by line, for prioritized auto-restore (defence -> midfield -> attack)
// and for the player-position-rating UI (grouped by label, e.g. CB1/CB2 share "CB").
const POSITION_LINE = { GK:"gk", LB:"def", CB:"def", RB:"def", LM:"mid", CM:"mid", RM:"mid", LW:"fwd", ST:"fwd", RW:"fwd" };
// The unique position labels used for the player rating sliders (10 categories)
const POSITION_LABELS = ["GK","LB","CB","RB","LM","CM","RM","LW","ST","RW"];

const SEED_PLAYERS = [
  { name: "Alex Morgan",  jersey_number: 1,  default_position: "GK"  },
  { name: "Jordan Smith", jersey_number: 5,  default_position: "DEF" },
  { name: "Sam Lee",      jersey_number: 7,  default_position: "MID" },
  { name: "Chris Park",   jersey_number: 10, default_position: "FWD" },
  { name: "Taylor Reyes", jersey_number: 11, default_position: "MID" },
  { name: "Casey White",  jersey_number: 14, default_position: "DEF" },
  { name: "Robin James",  jersey_number: 17, default_position: "FWD" },
  { name: "Drew Ellis",   jersey_number: 9,  default_position: "MID" },
];

const DRAW_COLORS = ["#ffffff","#ef4444","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899","#000000"];
const DRAW_SIZES  = [2, 4, 8, 14];
const TOOLS       = ["pen","line","arrow","rect","circle","text","eraser"];
const TOOL_LABELS = { pen:"Pen", line:"Line", arrow:"Arrow", rect:"Rect", circle:"Circle", text:"Text", eraser:"Erase" };

// ---- Storage helpers ----

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// Two keys are GLOBAL (shared across all teams): the list of cached teams, and which
// one is currently active. Every other "st_*" key is namespaced per-team so multiple
// teams' data can be cached on the same device without clobbering each other.
const GLOBAL_LS_KEYS = ["st_teams_registry", "st_active_team"];
// All per-team keys that need to be namespaced/migrated.
const PER_TEAM_LS_KEYS = ["st_team","st_players","st_matches","st_stints","st_events","st_positions","st_removedPositions","st_halfLength","st_halves","st_planSubs","st_pitchSetup"];

function nsKey(key) {
  if (GLOBAL_LS_KEYS.indexOf(key) !== -1) return key;
  var activeTeam = null;
  try { activeTeam = localStorage.getItem("st_active_team"); } catch(e) {}
  return activeTeam ? key + "__" + activeTeam : key;
}

const LS = {
  get: (key, fb) => { try { const v = localStorage.getItem(nsKey(key)); return v ? JSON.parse(v) : (fb !== undefined ? fb : null); } catch(e) { return fb !== undefined ? fb : null; } },
  set: (key, val) => { try { localStorage.setItem(nsKey(key), JSON.stringify(val)); } catch(e) {} },
};

// One-time migration: if this device has old single-team data (unnamespaced "st_*"
// keys) but no team registry yet, move that data under a new team id and set up the
// registry so it appears as the first cached team. Runs once at module load, before
// any component state is initialized from localStorage.
function migrateToMultiTeam() {
  try {
    if (localStorage.getItem("st_teams_registry")) return; // already migrated
    var legacyTeamRaw = localStorage.getItem("st_team");
    var teamId, teamObj;
    if (legacyTeamRaw) {
      teamObj = JSON.parse(legacyTeamRaw);
      teamId = teamObj.id || uid();
      teamObj.id = teamId;
    } else {
      teamId = uid();
      teamObj = { id: teamId, name: "My Team", season: String(new Date().getFullYear()), coach_name: "", created_at: new Date().toISOString() };
    }
    PER_TEAM_LS_KEYS.forEach(function(k){
      var v = localStorage.getItem(k);
      if (v !== null) localStorage.setItem(k + "__" + teamId, v);
    });
    localStorage.setItem("st_team__" + teamId, JSON.stringify(teamObj));
    localStorage.setItem("st_teams_registry", JSON.stringify([{ id: teamId, name: teamObj.name }]));
    localStorage.setItem("st_active_team", teamId);
  } catch(e) {}
}
migrateToMultiTeam();

function initStorage() {
  if (!LS.get("st_team")) {
    LS.set("st_team", { id: uid(), name: "My Team", season: String(new Date().getFullYear()), coach_name: "", created_at: new Date().toISOString() });
  }
  if (!LS.get("st_players")) {
    const team = LS.get("st_team");
    LS.set("st_players", SEED_PLAYERS.map(p => ({ id: uid(), team_id: team.id, active: true, ...p })));
  }
  if (!LS.get("st_matches")) LS.set("st_matches", []);
  if (!LS.get("st_stints"))  LS.set("st_stints",  []);
  if (!LS.get("st_events"))  LS.set("st_events",  []);
}

// ---- Utility ----

// Standard base64 (btoa/atob) uses '+', '/', and '=' padding, which can cause
// issues when a code ends up inside a URL fragment shared via messaging apps
// (some link-preview parsers mishandle these characters, e.g. treating '+' as
// a space or '=' as a delimiter, which can truncate or corrupt the link).
// base64url replaces '+' -> '-', '/' -> '_', and strips '=' padding, which is
// safe in URLs and widely supported when decoding (padding can be reconstructed).
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(str) {
  var s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
// Decode a share code that might be base64url (current format) or standard
// base64 (older shared links still in circulation) -- try base64url first,
// fall back to plain atob if that fails.
function decodeShareCode(code) {
  try { return base64UrlDecode(code); } catch(e) {}
  return atob(code);
}

function fmtTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2,"0");
  const s = String(secs % 60).padStart(2,"0");
  return m + ":" + s;
}

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-AU", { day:"numeric", month:"short", year:"numeric" });
}

function querySeasonTotals(seasonFilter) {
  const matches = LS.get("st_matches",[]);
  const stints  = LS.get("st_stints",[]);
  const players = LS.get("st_players",[]);
  const ids     = new Set(matches.filter(m => !seasonFilter || (m.match_date && m.match_date.startsWith(seasonFilter))).map(m => m.id));
  const totals  = {};
  stints.filter(s => ids.has(s.match_id)).forEach(s => {
    if (!totals[s.player_id]) totals[s.player_id] = { total: 0, byPos: {} };
    totals[s.player_id].total += s.total_seconds;
    totals[s.player_id].byPos[s.position_id] = (totals[s.player_id].byPos[s.position_id] || 0) + s.total_seconds;
  });
  return players.map(p => ({ ...p, ...(totals[p.id] || { total: 0, byPos: {} }) }));
}

// ---- Shared styles ----

const S = {
  btn:  { padding:"5px 9px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#94a3b8", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"inherit" },
  inp:  { padding:"7px 9px", borderRadius:8, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:12, fontFamily:"inherit" },
  th:   { padding:"7px 9px", textAlign:"left", color:"#94a3b8", fontWeight:600, fontSize:10, textTransform:"uppercase", borderBottom:"1px solid #334155", whiteSpace:"nowrap" },
  td:   { padding:"6px 9px", color:"#f1f5f9", borderBottom:"1px solid #1e293b", fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" },
  grn:  { background:"#1D9E75", color:"white", border:"none" },
  red:  { background:"#ef4444", color:"white", border:"none" },
  wbtn: { padding:"5px 10px", borderRadius:6, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
};

// ---- Pitch drawing helpers (used by whiteboard canvas) ----

function drawPitchBg(ctx, w, h) {
  // Scale factors: pitch is 68m wide x 105m tall
  var sx = w / 68, sy = h / 105;
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(0, 0, w, h);
  // Stripes
  for (var i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
    ctx.fillRect(0, i * 10.5 * sy, w, 10.5 * sy);
  }
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  // Border
  ctx.strokeRect(1*sx, 1*sy, 66*sx, 103*sy);
  // Halfway line
  ctx.beginPath(); ctx.moveTo(1*sx, 52.5*sy); ctx.lineTo(67*sx, 52.5*sy); ctx.stroke();
  // Centre circle (r=9.15m)
  ctx.beginPath(); ctx.arc(34*sx, 52.5*sy, 9.15*sx, 0, Math.PI*2); ctx.stroke();
  // Centre spot
  ctx.beginPath(); ctx.arc(34*sx, 52.5*sy, 0.4*sx, 0, Math.PI*2); ctx.fillStyle="rgba(255,255,255,0.75)"; ctx.fill();
  // Penalty spots
  ctx.beginPath(); ctx.arc(34*sx, 11*sy, 0.4*sx, 0, Math.PI*2); ctx.fillStyle="rgba(255,255,255,0.6)"; ctx.fill();
  ctx.beginPath(); ctx.arc(34*sx, 94*sy, 0.4*sx, 0, Math.PI*2); ctx.fillStyle="rgba(255,255,255,0.6)"; ctx.fill();
  // Penalty areas
  ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 0.8;
  ctx.strokeRect(13.84*sx, 1*sy, 40.32*sx, 16.5*sy);
  ctx.strokeRect(13.84*sx, 87.5*sy, 40.32*sx, 16.5*sy);
  // Goal areas
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 0.7;
  ctx.strokeRect(24.84*sx, 1*sy, 18.32*sx, 5.5*sy);
  ctx.strokeRect(24.84*sx, 98.5*sy, 18.32*sx, 5.5*sy);
  // Goals
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.8;
  ctx.strokeRect(30.34*sx, 0, 7.32*sx, 1*sy);
  ctx.strokeRect(30.34*sx, 104*sy, 7.32*sx, 1*sy);
  // Penalty arcs - full circle centred on spot, clipped to outside penalty area
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 0.7;
  // Top arc: spot at y=11, penalty area bottom edge at y=17.5 - clip to y > 17.5
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 17.5*sy, w, h); ctx.clip();
  ctx.beginPath(); ctx.arc(34*sx, 11*sy, 9.15*sx, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  // Bottom arc: spot at y=94, penalty area top edge at y=87.5 - clip to y < 87.5
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, 87.5*sy); ctx.clip();
  ctx.beginPath(); ctx.arc(34*sx, 94*sy, 9.15*sx, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  // Corner arcs
  ctx.beginPath(); ctx.arc(1*sx, 1*sy, 2*Math.min(sx,sy), 0, Math.PI*0.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(67*sx, 1*sy, 2*Math.min(sx,sy), Math.PI*0.5, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(1*sx, 104*sy, 2*Math.min(sx,sy), Math.PI*1.5, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(67*sx, 104*sy, 2*Math.min(sx,sy), Math.PI, Math.PI*1.5); ctx.stroke();
  ctx.restore();
}

function drawPlayerTokens(ctx, w, h, pitchPlayers, positions) {
  if (!pitchPlayers || !pitchPlayers.length) return;
  pitchPlayers.forEach(function(p) {
    var pos = positions.find(function(lp) { return lp.id === p.posId; });
    if (!pos) return;
    var cx = (pos.x / 100) * w;
    var cy = (pos.y / 100) * h;
    var r  = Math.max(16, Math.min(w, h) * 0.038);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = "#1D9E75";
    ctx.fill();
    ctx.strokeStyle = "#0F6E56";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + Math.round(r*0.85) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.num), cx, cy);
    var fn = p.name.split(" ")[0];
    var lh = Math.round(r * 0.65);
    ctx.font = "600 " + lh + "px sans-serif";
    var lw2 = ctx.measureText(fn).width + 8;
    var lx = cx - lw2/2;
    var ly = cy + r + 3;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.beginPath();
    ctx.rect(lx, ly, lw2, lh + 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(fn, cx, ly + 2);
  });
}

// ---- PitchMenu (floating context menu on the pitch) ----

function PitchMenu(props) {
  var x = props.x, y = props.y, items = props.items, onClose = props.onClose;
  var flipX = x > 65, flipY = y > 60;
  return (
    <div>
      <div onClick={onClose} style={{ position:"absolute", inset:0, zIndex:30 }} />
      <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", left:x+"%", top:y+"%", transform:"translate("+(flipX?"-110%":"8px")+","+(flipY?"calc(-100% - 44px)":"8px")+")", zIndex:40, background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:6, minWidth:155, boxShadow:"0 8px 32px rgba(0,0,0,0.65)" }}>
        {items.map(function(item, i) {
          if (item.divider) return <div key={i} style={{ fontSize:9, color:"#475569", padding:"4px 8px 2px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{item.label}</div>;
          return (
            <button key={i} onClick={function(e){e.stopPropagation();item.onClick();}} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", borderRadius:6, border:"none", background:"transparent", color:item.danger?"#f87171":"#cbd5e1", fontSize:12, fontWeight:500, cursor:"pointer", marginBottom:1, fontFamily:"inherit" }}
              onMouseEnter={function(e){e.currentTarget.style.background="#1e293b";}}
              onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Whiteboard component ----

function Whiteboard(props) {
  var matchSecs = props.matchSecs, running = props.running, score = props.score;
  var pitchPlayers = props.pitchPlayers, livePositions = props.livePositions, onClose = props.onClose;

  var bgRef    = useRef(null);
  var drawRef  = useRef(null);
  var wrapRef  = useRef(null);
  var drawingRef   = useRef(false);
  var startPtRef   = useRef({ x:0, y:0 });
  var snapshotRef  = useRef(null);
  var dragRef2     = useRef(null);

  var _tool  = useState("pen");    var tool  = _tool[0], setTool  = _tool[1];
  var _color = useState("#ffffff");var color = _color[0],setColor = _color[1];
  var _size  = useState(4);        var size  = _size[0], setSize  = _size[1];
  var _hist  = useState([]);       var hist  = _hist[0], setHist  = _hist[1];
  var _textInput = useState(null); var textInput = _textInput[0], setTextInput = _textInput[1];
  var _textVal   = useState("");   var textVal   = _textVal[0],   setTextVal   = _textVal[1];
  var _showPl = useState(true);    var showPl = _showPl[0], setShowPl = _showPl[1];

  function getCtx()  { return drawRef.current ? drawRef.current.getContext("2d") : null; }

  function redrawBg() {
    var c = bgRef.current; if (!c) return;
    var ctx = c.getContext("2d");
    drawPitchBg(ctx, c.width, c.height);
    if (showPl) drawPlayerTokens(ctx, c.width, c.height, pitchPlayers, livePositions);
  }

  useEffect(function() {
    var bg = bgRef.current, dr = drawRef.current; if (!bg || !dr) return;
    // Size canvas to the aspect-ratio constrained div (bg's own parent)
    var p = bg.parentElement;
    var W = p.clientWidth, H = p.clientHeight;
    bg.width = W; bg.height = H; dr.width = W; dr.height = H;
    drawPitchBg(bg.getContext("2d"), W, H);
    if (showPl) drawPlayerTokens(bg.getContext("2d"), W, H, pitchPlayers, livePositions);
    var dctx = dr.getContext("2d"); dctx.clearRect(0,0,W,H);
    setHist([dctx.getImageData(0,0,W,H)]);
  }, []);

  useEffect(function() { redrawBg(); }, [showPl, pitchPlayers, livePositions]);

  function ptFrom(e) {
    var c = drawRef.current; if (!c) return {x:0,y:0};
    var r = c.getBoundingClientRect();
    var src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  function saveSnap() {
    var ctx = getCtx(); if (!ctx) return;
    var c = drawRef.current;
    snapshotRef.current = ctx.getImageData(0,0,c.width,c.height);
  }

  function pushHist() {
    var ctx = getCtx(); if (!ctx) return;
    var c = drawRef.current;
    setHist(function(h) { return h.slice(-19).concat([ctx.getImageData(0,0,c.width,c.height)]); });
  }

  function undo() {
    if (hist.length < 2) return;
    getCtx().putImageData(hist[hist.length-2], 0, 0);
    setHist(function(h) { return h.slice(0,-1); });
  }

  function clearDraw() {
    var ctx = getCtx(); if (!ctx) return;
    var c = drawRef.current; ctx.clearRect(0,0,c.width,c.height); pushHist();
  }

  function applyStyle(ctx) {
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = size * 5;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.fillStyle   = color;
      ctx.lineWidth   = size;
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
  }

  function drawArrow(ctx, x1, y1, x2, y2) {
    var angle = Math.atan2(y2-y1, x2-x1);
    var len = 14 + size*1.5;
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-len*Math.cos(angle-Math.PI/6), y2-len*Math.sin(angle-Math.PI/6));
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-len*Math.cos(angle+Math.PI/6), y2-len*Math.sin(angle+Math.PI/6));
    ctx.stroke();
  }

  function drawShape(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    if (tool === "line") { ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
    else if (tool === "arrow") { ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); drawArrow(ctx,x1,y1,x2,y2); }
    else if (tool === "rect") { ctx.strokeRect(x1,y1,x2-x1,y2-y1); }
    else if (tool === "circle") { var rx=(x2-x1)/2,ry=(y2-y1)/2; ctx.ellipse(x1+rx,y1+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2); ctx.stroke(); }
  }

  var onDown = useCallback(function(e) {
    e.preventDefault();
    var pt = ptFrom(e);
    if (tool === "text") { setTextInput(pt); setTextVal(""); return; }
    drawingRef.current = true; startPtRef.current = pt; saveSnap();
    if (tool === "pen" || tool === "eraser") {
      var ctx = getCtx(); if (!ctx) return;
      applyStyle(ctx); ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
    }
  }, [tool, color, size]);

  var onMove = useCallback(function(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    var ctx = getCtx(); if (!ctx) return;
    var pt = ptFrom(e);
    applyStyle(ctx);
    if (tool === "pen" || tool === "eraser") { ctx.lineTo(pt.x, pt.y); ctx.stroke(); }
    else { if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0); drawShape(ctx, startPtRef.current.x, startPtRef.current.y, pt.x, pt.y); }
  }, [tool, color, size]);

  var onUp = useCallback(function(e) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    var ctx = getCtx(); if (!ctx) return;
    var pt = ptFrom(e);
    applyStyle(ctx);
    if (tool !== "pen" && tool !== "eraser") { if (snapshotRef.current) ctx.putImageData(snapshotRef.current,0,0); drawShape(ctx,startPtRef.current.x,startPtRef.current.y,pt.x,pt.y); }
    ctx.globalCompositeOperation = "source-over";
    pushHist();
  }, [tool, color, size]);

  function commitText() {
    if (!textVal.trim() || !textInput) { setTextInput(null); return; }
    var ctx = getCtx(); if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "bold " + (12+size*3) + "px sans-serif";
    ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
    ctx.fillText(textVal, textInput.x, textInput.y);
    pushHist(); setTextInput(null); setTextVal("");
  }

  return (
    <div style={{ position:"fixed", top:54, left:0, right:0, bottom:0, zIndex:100, display:"flex", flexDirection:"column", background:"#0f172a" }}>
      <div style={{ background:"#1e293b", borderBottom:"1px solid #334155", padding:"6px 10px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", flexShrink:0 }}>

        <div style={{ display:"flex", alignItems:"center", gap:6, background:"#0f172a", borderRadius:7, padding:"3px 8px", border:"1px solid #334155" }}>
          <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:"#1D9E75", fontVariantNumeric:"tabular-nums" }}>{fmtTime(matchSecs)}</span>
          <span style={{ fontSize:10, color:"#64748b" }}>{score.home}-{score.away}</span>
          <span style={{ fontSize:9, color:running?"#34d399":"#64748b" }}>{running?"LIVE":"PAUSED"}</span>
        </div>

        <div style={{ width:1, height:20, background:"#334155" }} />

        <button onClick={function(){setShowPl(function(v){return !v;});}} style={{ ...S.wbtn, border:showPl?"1.5px solid #1D9E75":"1px solid #334155", color:showPl?"#34d399":"#64748b" }}>
          {showPl ? "Players ON" : "Players OFF"}
        </button>

        <div style={{ width:1, height:20, background:"#334155" }} />

        <div style={{ display:"flex", gap:3 }}>
          {TOOLS.map(function(t) {
            return (
              <button key={t} onClick={function(){setTool(t);}} style={{ padding:"4px 7px", borderRadius:5, border:tool===t?"1.5px solid #a78bfa":"1px solid #334155", background:tool===t?"rgba(167,139,250,0.15)":"transparent", color:tool===t?"#a78bfa":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                {TOOL_LABELS[t]}
              </button>
            );
          })}
        </div>

        <div style={{ width:1, height:20, background:"#334155" }} />

        <div style={{ display:"flex", gap:3 }}>
          {DRAW_SIZES.map(function(sz) {
            return (
              <button key={sz} onClick={function(){setSize(sz);}} style={{ width:26, height:26, borderRadius:5, border:size===sz?"1.5px solid #94a3b8":"1px solid #334155", background:size===sz?"#334155":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ width:Math.min(sz*2.2,16), height:Math.min(sz*2.2,16), borderRadius:"50%", background:"#94a3b8" }} />
              </button>
            );
          })}
        </div>

        <div style={{ width:1, height:20, background:"#334155" }} />

        <div style={{ display:"flex", gap:3 }}>
          {DRAW_COLORS.map(function(c) {
            return (
              <button key={c} onClick={function(){setColor(c);}} style={{ width:20, height:20, borderRadius:"50%", background:c, border:color===c?"2.5px solid white":"1.5px solid rgba(255,255,255,0.2)", cursor:"pointer", boxShadow:color===c?"0 0 0 2px #a78bfa":"none" }} />
            );
          })}
        </div>

        <div style={{ width:1, height:20, background:"#334155" }} />

        <button onClick={undo} style={S.wbtn}>Undo</button>
        <button onClick={clearDraw} style={{ ...S.wbtn, color:"#f87171" }}>Clear</button>

        <div style={{ flex:1 }} />

        <button onClick={onClose} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
          Close Board
        </button>
      </div>

      <div ref={wrapRef} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:"#0f172a", overflow:"hidden", touchAction:"none" }}>
        {/* Constrain to 68:105 football pitch ratio */}
        <div style={{ position:"relative", aspectRatio:"68/105", maxHeight:"100%", maxWidth:"100%", width:"auto", height:"100%" }}>
          <canvas ref={bgRef}   style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }} />
          <canvas ref={drawRef} style={{ position:"absolute", inset:0, width:"100%", height:"100%", cursor:tool==="eraser"?"cell":tool==="text"?"text":"crosshair" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
          />
        {textInput && (
          <div style={{ position:"absolute", left:textInput.x, top:textInput.y-20, zIndex:10 }}>
            <input autoFocus value={textVal}
              onChange={function(e){setTextVal(e.target.value);}}
              onKeyDown={function(e){if(e.key==="Enter")commitText();if(e.key==="Escape")setTextInput(null);}}
              onBlur={commitText}
              style={{ background:"rgba(0,0,0,0.75)", border:"1px solid #a78bfa", borderRadius:4, color:color, fontSize:12+size*3, fontWeight:700, padding:"2px 6px", outline:"none", fontFamily:"inherit", minWidth:80 }}
            />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ---- Main App ----

function SubTrackerApp() {
  useEffect(function() { initStorage(); }, []);

  // Auto-load from URL hash on first mount (shared link)
  var _hashLoaded = useState(false); var hashLoaded = _hashLoaded[0], setHashLoaded = _hashLoaded[1];
  useEffect(function() {
    if (hashLoaded) return;
    setHashLoaded(true);
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    var code = hash.slice(1);
    try {
      var data = JSON.parse(decodeShareCode(code));
      var payload;
      if (data.pl) {
        // Compact format - expand it
        payload = {
          v: data.v,
          team: data.t ? { name:data.t.n, season:data.t.s, coach_name:data.t.c, id:uid(), created_at:new Date().toISOString() } : null,
          players: (data.pl||[]).map(function(pl){ return { id:pl.i, name:pl.n, jersey_number:pl.j, default_position:pl.p, active:true, team_id:"" }; }),
          positions: (data.ps||[]).map(function(pos){ return { id:pos.i, label:pos.l, x:pos.x, y:pos.y }; }),
          planSubs: (data.su||[]).map(function(s){ return { id:s.i, minute:s.m, playerOffId:s.o, playerOnId:s.n, done:false }; }),
          pitchSetup: data.se || {},
        };
      } else {
        payload = data;
      }
      if (!payload.v || !payload.players) return;
      // Clean the hash from the URL FIRST -- if importSharedPayload reloads the
      // page (switching/creating a team), we don't want the hash still present
      // to re-trigger this import in a loop.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      var result = importSharedPayload(payload, { hl: data.hl, ha: data.ha });
      if (result.mode === "current") {
        setTab("match");
      }
    } catch(e) { /* invalid hash - ignore */ }
  }, []);

  var _tab = useState(function(){ return (LS.get("st_players", []).length > 0) ? "plan" : "match"; }); var tab = _tab[0], setTab = _tab[1];

  // Game settings
  var _hl = useState(function(){ return LS.get("st_halfLength") || 45; }); var halfLength = _hl[0], setHalfLength = _hl[1];
  var _halves = useState(function(){ return LS.get("st_halves") || 2; }); var halves = _halves[0], setHalves = _halves[1];
  useEffect(function(){ LS.set("st_halfLength", halfLength); }, [halfLength]);
  useEffect(function(){ LS.set("st_halves", halves); }, [halves]);

  var matchLength = halfLength * halves; // total minutes

  // Planned substitutions: { id, minute, playerOffId, playerOnId, done }
  // Persisted per-team so the plan survives reloads/team switches.
  var _planSubs = useState(function(){ return LS.get("st_planSubs", []); }); var planSubs = _planSubs[0], setPlanSubs = _planSubs[1];
  // Form state for the plan subs tab
  var _psMin  = useState(""); var psMin  = _psMin[0],  setPsMin  = _psMin[1];
  var _psOff  = useState(""); var psOff  = _psOff[0],  setPsOff  = _psOff[1];
  var _psOn   = useState(""); var psOn   = _psOn[0],   setPsOn   = _psOn[1];
  // "sub" = normal substitution (off pitch <-> on from bench), "swap" = two
  // on-pitch players trade positions (e.g. GK <-> a defender at half-time)
  var _psMode = useState("sub"); var psMode = _psMode[0], setPsMode = _psMode[1];
  // Which planned sub is being re-assigned (conflict resolution)
  var _conflictPick = useState(null); var conflictPick = _conflictPick[0], setConflictPick = _conflictPick[1];
  // Timeline scrubber minute for the plan tab pitch diagram
  var _tlMin = useState(0); var tlMin = _tlMin[0], setTlMin = _tlMin[1];
  // Note: player availability ("unavailable") is tracked via a single shared
  // state declared below (var _una / unavailable / setUnavailable / toggleUnavailable),
  // used by both the Plan tab and Match tab so marking someone unavailable on
  // either page is reflected on both.
  // Auto plan UI open/closed
  var _apOpen = useState(false); var autoPlanOpen = _apOpen[0], setAutoPlanOpen = _apOpen[1];
  // Auto plan options
  var _apPS  = useState(7);     var apPlayerSize    = _apPS[0],  setApPlayerSize    = _apPS[1];
  var _apPSC = useState("");    var apPlayerSizeCustom = _apPSC[0], setApPlayerSizeCustom = _apPSC[1];
  var _apGK  = useState("never");  var apGkChange   = _apGK[0],  setApGkChange      = _apGK[1];
  var _apGKP = useState("");    var apGkPick        = _apGKP[0], setApGkPick        = _apGKP[1];
  var _apGKO = useState(false); var apGkOutfield    = _apGKO[0], setApGkOutfield    = _apGKO[1];
  var _apPos = useState("equal");  var apPositions  = _apPos[0], setApPositions     = _apPos[1];
  var _apCW  = useState(0);     var apChangeWindows = _apCW[0],  setApChangeWindows = _apCW[1];
  var _apCWC = useState("");    var apChangeWindowsCustom = _apCWC[0], setApChangeWindowsCustom = _apCWC[1];
  var _apWT  = useState("any-free"); var apWindowTime    = _apWT[0],  setApWindowTime    = _apWT[1];
  var _apWTX = useState(15);    var apWindowTimeX   = _apWTX[0], setApWindowTimeX   = _apWTX[1];
  var _apWTS = useState([]);    var apWindowTimes   = _apWTS[0], setApWindowTimes   = _apWTS[1]; // specified times array
  var _apMS  = useState(0);     var apMaxSubsPerWindow = _apMS[0], setApMaxSubsPerWindow = _apMS[1];
  var _apMSC = useState("");    var apMaxSubsCustom = _apMSC[0], setApMaxSubsCustom = _apMSC[1];
  var _apCBO = useState(true);  var apCanComeBack   = _apCBO[0], setApCanComeBack   = _apCBO[1];
  var _apFP  = useState("time"); var apFocus        = _apFP[0],  setApFocus         = _apFP[1];
  // Swap player modal for plan tab
  var _swapModal = useState(null); var swapModal = _swapModal[0], setSwapModal = _swapModal[1];
  // Generic info popup (shown when tapping a "?" help icon) - { title, body }
  var _infoPopup = useState(null); var infoPopup = _infoPopup[0], setInfoPopup = _infoPopup[1];
  // Edit modal for a single planned sub - { subId, minute, playerOffId, playerOnId }
  var _editSub = useState(null); var editSubModal = _editSub[0], setEditSubModal = _editSub[1];

  var _team = useState(function() { return LS.get("st_team", { id:uid(), name:"My Team", season:String(new Date().getFullYear()), coach_name:"", created_at:new Date().toISOString() }); });
  var team = _team[0], setTeamState = _team[1];

  // ---- Multi-team support: registry of all cached teams + switcher UI state ----
  var _teamsReg = useState(function(){ return LS.get("st_teams_registry", []); });
  var teamsRegistry = _teamsReg[0], setTeamsRegistry = _teamsReg[1];
  var activeTeamId = (function(){ try { return localStorage.getItem("st_active_team"); } catch(e){ return null; } })();
  var _teamSwitch = useState(false); var teamSwitcherOpen = _teamSwitch[0], setTeamSwitcherOpen = _teamSwitch[1];
  var _newTeamName = useState(""); var newTeamName = _newTeamName[0], setNewTeamName = _newTeamName[1];

  // Switch the active team and reload, so every piece of state re-initializes
  // from that team's namespaced localStorage data.
  function switchToTeam(id) {
    if (id === activeTeamId) { setTeamSwitcherOpen(false); return; }
    try { localStorage.setItem("st_active_team", id); } catch(e) {}
    window.location.reload();
  }

  // Create a brand-new (empty) team, add it to the registry, and switch to it.
  function createNewTeam(name) {
    var trimmed = (name || "").trim() || "New Team";
    var newId = uid();
    var reg = LS.get("st_teams_registry", []).concat([{ id:newId, name:trimmed }]);
    LS.set("st_teams_registry", reg);
    try {
      localStorage.setItem("st_team__" + newId, JSON.stringify({ id:newId, name:trimmed, season:String(new Date().getFullYear()), coach_name:"", created_at:new Date().toISOString() }));
      // Start with an empty roster (no seed players) for a fresh team
      localStorage.setItem("st_players__" + newId, JSON.stringify([]));
      localStorage.setItem("st_matches__" + newId, JSON.stringify([]));
      localStorage.setItem("st_stints__" + newId, JSON.stringify([]));
      localStorage.setItem("st_events__" + newId, JSON.stringify([]));
      localStorage.setItem("st_active_team", newId);
    } catch(e) {}
    window.location.reload();
  }

  // Delete a cached team's data entirely. Falls back to another cached team, or
  // creates a fresh default team if none remain.
  function deleteTeam(id) {
    var reg = LS.get("st_teams_registry", []).filter(function(t){ return t.id !== id; });
    LS.set("st_teams_registry", reg);
    PER_TEAM_LS_KEYS.forEach(function(k){
      try { localStorage.removeItem(k + "__" + id); } catch(e) {}
    });
    if (reg.length === 0) { createNewTeam("My Team"); return; }
    if (id === activeTeamId) {
      try { localStorage.setItem("st_active_team", reg[0].id); } catch(e) {}
    }
    window.location.reload();
  }

  var _dbPl = useState(function() { return LS.get("st_players", []); });
  var dbPlayers = _dbPl[0], setDbPlayers = _dbPl[1];

  var _pos = useState(function() { return LS.get("st_positions") || POSITIONS.map(function(p){return Object.assign({},p);}); });
  var positions = _pos[0], setPositions = _pos[1];
  var _removedPos = useState(function() { return LS.get("st_removedPositions") || []; });
  var removedPositions = _removedPos[0], setRemovedPositions = _removedPos[1];

  var _secs = useState(0);  var matchSecs = _secs[0], setMatchSecs = _secs[1];
  var _run  = useState(false); var running = _run[0], setRunning = _run[1];
  // Half tracking: currentHalf (1 or 2), halfStartSec (the matchSecs offset when this half began)
  var _curHalf  = useState(1); var currentHalf  = _curHalf[0],  setCurrentHalf  = _curHalf[1];
  var _halfStart= useState(0); var halfStartSec  = _halfStart[0], setHalfStartSec = _halfStart[1];
  // Whether halftime was taken (controls "Start second half" label)
  var _atHT     = useState(false); var atHalftime  = _atHT[0],    setAtHalftime   = _atHT[1];
  var _score= useState({home:0,away:0}); var score = _score[0], setScore = _score[1];
  var _opp  = useState(""); var opponent = _opp[0], setOpponent = _opp[1];
  var _ven  = useState(""); var venue    = _ven[0], setVenue    = _ven[1];
  var _saved= useState(false); var matchSaved = _saved[0], setMatchSaved = _saved[1];

  var _ps = useState(function() {
    var savedSetup = LS.get("st_pitchSetup", {}) || {};
    return LS.get("st_players",[]).reduce(function(acc,p) { acc[p.id]={pitchPos:savedSetup[p.id]||null,pitchSecs:0,positionTimes:{},stints:[]}; return acc; }, {});
  });
  var pitchState = _ps[0], setPitchState = _ps[1];

  var _events = useState([]); var events = _events[0], setEvents = _events[1];
  var _goalEvts = useState([]); var goalEvents = _goalEvts[0], setGoalEvents = _goalEvts[1];
  // Modal for entering goal scorer details { team: 'home'|'away', minute, second }
  var _gsm = useState(null); var goalScorerModal = _gsm[0], setGoalScorerModal = _gsm[1];
  var _gsp = useState(""); var goalScorerPlayer = _gsp[0], setGoalScorerPlayer = _gsp[1];
  var _gsn = useState(""); var goalScorerNum    = _gsn[0], setGoalScorerNum    = _gsn[1];
  var _pm = useState(null);  var pitchMenu = _pm[0], setPitchMenu = _pm[1];
  var _sm = useState(null);  var sideMenu  = _sm[0], setSideMenu  = _sm[1];
  var _dh = useState(null);  var dropHi    = _dh[0], setDropHi    = _dh[1];
  var _pe = useState(null);  var posEdit   = _pe[0], setPosEdit   = _pe[1];
  var _wb = useState(false); var showWB    = _wb[0], setShowWB    = _wb[1];
  // Set of player IDs marked unavailable during match (injured / no-show)
  var _una = useState(function(){ return new Set(); }); var unavailable = _una[0], setUnavailable = _una[1];
  // Collapsible sections in bench panel
  var _sopl = useState(true); var showOnPitchList = _sopl[0], setShowOnPitchList = _sopl[1];
  var _spsl = useState(true); var showPlanSubsList = _spsl[0], setShowPlanSubsList = _spsl[1];

  function toggleUnavailable(pid) {
    setUnavailable(function(prev) {
      var next = new Set(prev);
      if (next.has(pid)) { next.delete(pid); } else { next.add(pid); }
      return next;
    });
  }

  var _hist = useState(function(){ return LS.get("st_matches",[]); }); var histMatches = _hist[0], setHistMatches = _hist[1];
  var _sf   = useState(function(){ return String(new Date().getFullYear()); }); var seasonFilter = _sf[0], setSeasonFilter = _sf[1];

  var _nn = useState(""); var newNum = _nn[0], setNewNum = _nn[1];
  var _nna= useState(""); var newName= _nna[0],setNewName= _nna[1];
  var _np = useState("MID"); var newPos= _np[0], setNewPos = _np[1];
  // Which player's position-rating editor is expanded in the Roster tab
  var _editPlayer = useState(null); var editingPlayerId = _editPlayer[0], setEditingPlayerId = _editPlayer[1];

  var _tn = useState(function(){ return (LS.get("st_team",{})||{}).name||"My Team"; }); var teamName = _tn[0], setTeamName = _tn[1];
  var _ts = useState(function(){ return (LS.get("st_team",{})||{}).season||String(new Date().getFullYear()); }); var teamSeason = _ts[0], setTeamSeason = _ts[1];
  var _cn = useState(function(){ return (LS.get("st_team",{})||{}).coach_name||""; }); var coachName = _cn[0], setCoachName = _cn[1];
  // Share/import code
  var _sc = useState(""); var shareCode = _sc[0], setShareCode = _sc[1];
  var _su = useState(""); var shareUrl  = _su[0], setShareUrl  = _su[1];
  var _cm = useState(""); var copyMsg   = _cm[0], setCopyMsg   = _cm[1];
  var _ic = useState(""); var importCode = _ic[0], setImportCode = _ic[1];
  var _im = useState(""); var importMsg  = _im[0], setImportMsg  = _im[1];

  var pitchRef      = useRef(null);
  var intRef        = useRef(null);
  var touchGhostRef = useRef(null);
  var touchIdRef    = useRef(null);
  var touchSrcRef   = useRef(null);
  var dragIdRef     = useRef(null);
  var dragSrcRef    = useRef(null);
  var posEditRef    = useRef(null); posEditRef.current = posEdit;
  var posEditDragRef= useRef(null);
  var nextIdRef     = useRef(dbPlayers.length + 1);

  var isSetup = matchSecs === 0 && !running;

  useEffect(function() { LS.set("st_players", dbPlayers); }, [dbPlayers]);
  useEffect(function() { LS.set("st_team", team); }, [team]);
  useEffect(function() { LS.set("st_positions", positions); }, [positions]);
  useEffect(function() { LS.set("st_removedPositions", removedPositions); }, [removedPositions]);
  useEffect(function() { LS.set("st_planSubs", planSubs); }, [planSubs]);
  // Persist just the lineup (pid -> posId), not the live per-second tracking data,
  // so the starting setup survives reloads/team switches without spamming storage.
  useEffect(function() {
    var setup = Object.keys(pitchState).reduce(function(acc, pid) {
      if (pitchState[pid] && pitchState[pid].pitchPos) acc[pid] = pitchState[pid].pitchPos;
      return acc;
    }, {});
    LS.set("st_pitchSetup", setup);
  }, [pitchState]);

  // Keep the team-switcher registry's name in sync with this team, and make sure
  // the active team always has an entry (self-heal for older/odd states).
  useEffect(function(){
    setTeamsRegistry(function(prev){
      var found = false;
      var next = prev.map(function(t){
        if (t.id === team.id) { found = true; return (t.name === team.name) ? t : Object.assign({}, t, { name: team.name }); }
        return t;
      });
      if (!found) next = next.concat([{ id: team.id, name: team.name }]);
      if (next.length === prev.length && next.every(function(t,i){ return prev[i] && prev[i].id===t.id && prev[i].name===t.name; })) return prev;
      LS.set("st_teams_registry", next);
      return next;
    });
  }, [team.id, team.name]);

  // Tick
  useEffect(function() {
    if (running) {
      intRef.current = setInterval(function() {
        setMatchSecs(function(s) {
          return s + 1;
        });
        setPitchState(function(prev) {
          var next = Object.assign({}, prev);
          Object.keys(next).forEach(function(pid) {
            var ps = next[pid];
            if (!ps.pitchPos) return;
            var posId = ps.pitchPos;
            var newPT = Object.assign({}, ps.positionTimes);
            newPT[posId] = (newPT[posId]||0) + 1;
            next[pid] = Object.assign({}, ps, { pitchSecs: ps.pitchSecs+1, positionTimes: newPT });
          });
          return next;
        });
      }, 1000);
    } else { clearInterval(intRef.current); }
    return function() { clearInterval(intRef.current); };
  }, [running]);

  var addEvent = useCallback(function(playerId, eventType, notes, extra) {
    setEvents(function(prev){ return prev.concat([Object.assign({ id:uid(), player_id:playerId, event_type:eventType, match_second:matchSecs, notes:notes||"" }, extra||{})]); });
  }, [matchSecs]);

  function closeStint(pid, endSec, ps) {
    if (!ps.pitchPos) return ps;
    var stints = ps.stints.slice();
    var last = stints[stints.length-1];
    if (last && last.end_second === null) {
      // Close the currently-open stint
      stints[stints.length-1] = Object.assign({}, last, { end_second:endSec, total_seconds:endSec-last.start_second });
      return Object.assign({}, ps, { stints:stints });
    }
    if (!last) {
      // Starting player who has never had a stint recorded yet (e.g. the match
      // just began and no sub has happened for them before) -- synthesize their
      // first stint, running from kickoff (second 0) to now, so they show up as
      // a "previous player" ghost on the pitch once subbed off.
      stints.push({ id:uid(), match_id:null, player_id:pid, position_id:ps.pitchPos, start_second:0, end_second:endSec, total_seconds:endSec });
      return Object.assign({}, ps, { stints:stints });
    }
    // last.end_second !== null -- already closed, nothing to do
    return ps;
  }

  function openStint(pid, posId, startSec, ps) {
    var stint = { id:uid(), match_id:null, player_id:pid, position_id:posId, start_second:startSec, end_second:null, total_seconds:0 };
    return Object.assign({}, ps, { pitchPos:posId, stints:ps.stints.concat([stint]) });
  }

  var placeOnPitch = useCallback(function(pid, posId) {
    setPitchState(function(prev) {
      var next = Object.assign({}, prev);
      Object.keys(next).forEach(function(id) {
        if (next[id].pitchPos === posId && id !== String(pid)) {
          next[id] = closeStint(id, matchSecs, next[id]);
          next[id] = Object.assign({}, next[id], { pitchPos:null });
        }
      });
      next[pid] = closeStint(pid, matchSecs, next[pid]);
      next[pid] = openStint(pid, posId, matchSecs, next[pid]);
      return next;
    });
    setPitchMenu(null); setSideMenu(null);
  }, [matchSecs]);

  var sendToBench = useCallback(function(pid) {
    setPitchState(function(prev) {
      var next = Object.assign({}, prev);
      next[pid] = closeStint(pid, matchSecs, next[pid]);
      next[pid] = Object.assign({}, next[pid], { pitchPos:null });
      return next;
    });
    setPitchMenu(null); setSideMenu(null);
  }, [matchSecs]);

  // Get a player's rating (0-10) for a given position label, defaulting to 5
  function ratingFor(player, label) {
    if (!label || !player) return 5;
    if (player.position_ratings && typeof player.position_ratings[label] === "number") {
      return player.position_ratings[label];
    }
    return 5;
  }
  // Set a player's rating for a given position label
  function setRating(pid, label, value) {
    setDbPlayers(function(prev){
      return prev.map(function(p){
        if (p.id !== pid) return p;
        var ratings = Object.assign({}, p.position_ratings || {});
        ratings[label] = value;
        return Object.assign({}, p, { position_ratings: ratings });
      });
    });
  }
  // Look up the position label (e.g. "CB") for a given position id (e.g. "CB1")
  function posLabelFor(posId) {
    if (!posId) return null;
    var pp = positions.find(function(x){return x.id===posId;}) || POSITIONS.find(function(x){return x.id===posId;});
    return pp ? pp.label : null;
  }


  // near other positions in the same line. Generates a unique id.
  function addCustomPosition(label) {
    var line = POSITION_LINE[label] || "mid";
    var sameLine = positions.filter(function(p){ return (POSITION_LINE[p.label]||"") === line; });
    var avgY = sameLine.length > 0 ? (sameLine.reduce(function(s,p){return s+p.y;},0) / sameLine.length) : 50;
    var existingIds = positions.concat(removedPositions).map(function(p){return p.id;});
    var n = 1, newId = "EXTRA_"+label+n;
    while (existingIds.indexOf(newId) !== -1) { n++; newId = "EXTRA_"+label+n; }
    // Spread new slots horizontally so they don't stack exactly on top of an existing one
    var x = 15 + ((sameLine.length * 17) % 70);
    setPositions(function(prev){ return prev.concat([{ id:newId, label:label, x:x, y:avgY }]); });
  }

  var swapPlayers = useCallback(function(benchId, pitchId) {
    var bench = dbPlayers.find(function(p){return p.id===benchId;});
    var pitch = dbPlayers.find(function(p){return p.id===pitchId;});
    setPitchState(function(prev) {
      var next = Object.assign({}, prev);
      var posId = next[pitchId].pitchPos;
      next[pitchId] = closeStint(pitchId, matchSecs, next[pitchId]);
      next[pitchId] = Object.assign({}, next[pitchId], { pitchPos:null });
      next[benchId] = closeStint(benchId, matchSecs, next[benchId]);
      next[benchId] = openStint(benchId, posId, matchSecs, next[benchId]);
      return next;
    });
    if (bench && pitch) addEvent(benchId, "substitution", bench.name+" on for "+pitch.name, { player_on_id: benchId, player_off_id: pitchId });
    setPitchMenu(null); setSideMenu(null);
  }, [dbPlayers, matchSecs, addEvent]);

  var swapPitchPos = useCallback(function(idA, idB) {
    setPitchState(function(prev) {
      var next = Object.assign({}, prev);
      var posA = next[idA].pitchPos, posB = next[idB].pitchPos;
      next[idA] = closeStint(idA, matchSecs, next[idA]); next[idB] = closeStint(idB, matchSecs, next[idB]);
      next[idA] = openStint(idA, posB, matchSecs, next[idA]); next[idB] = openStint(idB, posA, matchSecs, next[idB]);
      return next;
    });
    setPitchMenu(null);
  }, [matchSecs]);

  var saveMatch = useCallback(function() {
    var mid = uid();
    var match = { id:mid, team_id:team.id, match_date:new Date().toISOString(), opponent:opponent||"Unknown", venue:venue||"", goals_for:score.home, goals_against:score.away, duration_seconds:matchSecs };
    var finalStints = [];
    Object.entries(pitchState).forEach(function(entry) {
      var pid = entry[0], ps = entry[1];
      var closed = closeStint(pid, matchSecs, ps);
      closed.stints.forEach(function(s) { if (s.total_seconds > 0) finalStints.push(Object.assign({},s,{match_id:mid})); });
    });
    LS.set("st_matches", LS.get("st_matches",[]).concat([match]));
    LS.set("st_stints",  LS.get("st_stints", []).concat(finalStints));
    LS.set("st_events",  LS.get("st_events", []).concat(
      events.map(function(e){return Object.assign({},e,{match_id:mid});}).concat(
        goalEvents.map(function(g){return { id:uid(), match_id:mid, player_id:g.scorerId||null, event_type:g.team==="home"?"goal_home":"goal_away", match_second:g.second, notes:g.scorerLabel||"" }; })
      )
    ));
    setHistMatches(function(prev){return prev.concat([match]);});
    setMatchSaved(true);
  }, [team, opponent, venue, score, matchSecs, pitchState, events]);

  var resetMatch = useCallback(function() {
    setRunning(false); setMatchSecs(0); setScore({home:0,away:0});
    setOpponent(""); setVenue(""); setMatchSaved(false); setEvents([]); setGoalEvents([]);
    setCurrentHalf(1); setHalfStartSec(0); setAtHalftime(false);
    setPitchState(dbPlayers.reduce(function(acc,p){ acc[p.id]={pitchPos:null,pitchSecs:0,positionTimes:{},stints:[]}; return acc; }, {}));
  }, [dbPlayers]);

  // Click handlers
  function openPosEditForSlot(posId) {
    var pos = positions.find(function(p){return p.id===posId;});
    if (!pos) return;
    setPitchMenu(null); setSideMenu(null);
    setPosEdit({ posId:posId, origX:pos.x, origY:pos.y, draftX:pos.x, draftY:pos.y, dragging:false, menuOnly:true });
  }

  function handlePitchClick(e, pid) {
    e.stopPropagation(); setSideMenu(null);
    var el = e.currentTarget, pr = pitchRef.current && pitchRef.current.getBoundingClientRect();
    if (!pr) return;
    var er = el.getBoundingClientRect();
    var x = ((er.left+er.width/2-pr.left)/pr.width)*100;
    var y = ((er.top+er.height/2-pr.top)/pr.height)*100;
    var posId = pitchState[pid] && pitchState[pid].pitchPos;
    if (isSetup) {
      var items = [{ divider:true, label:"Move to position" }]
        .concat(positions.map(function(pos){ return { label:pos.label+(pos.id!==pos.label?" - "+pos.id:""), onClick:function(){placeOnPitch(pid,pos.id);} }; }))
        .concat([
          { divider:true, label:"" },
          { label:"Edit position spot", onClick:function(){openPosEditForSlot(posId);} },
          { label:"Move to bench", danger:true, onClick:function(){sendToBench(pid);} }
        ]);
      setPitchMenu({ pid:pid, x:x, y:y, items:items });
    } else {
      if (sideMenu) {
        swapPlayers(sideMenu.playerId, pid);
      } else {
        // Live game: show swap options + edit position
        var liveItems = [
          { divider:true, label:"Substitution" },
          { label:"Select from bench to swap...", onClick:function(){} },
          { divider:true, label:"" },
          { label:"Edit position spot", onClick:function(){openPosEditForSlot(posId);} }
        ];
        setPitchMenu({ pid:pid, x:x, y:y, items:liveItems });
      }
    }
  }

  function handleBenchClick(pid) {
    setPitchMenu(null);
    if (sideMenu && sideMenu.playerId === pid) { setSideMenu(null); return; }
    if (isSetup) {
      setSideMenu({ playerId:pid, type:"bench-setup", items: positions.map(function(pos){ return { label:pos.label+(pos.id!==pos.label?" - "+pos.id:""), onClick:function(){placeOnPitch(pid,pos.id);} }; }) });
    } else {
      var pp = dbPlayers.filter(function(p){return pitchState[p.id] && pitchState[p.id].pitchPos;});
      setSideMenu({ playerId:pid, type:"bench-live", items: pp.map(function(p){ return { label:"#"+p.jersey_number+" "+p.name+" ("+pitchState[p.id].pitchPos+")", onClick:function(){swapPlayers(pid,p.id);} }; }) });
    }
  }

  function handleSlotClick(e, posId) {
    e.stopPropagation();
    if (dragIdRef.current != null) return;
    if (posEdit && posEdit.dragging) return;
    openPosEditForSlot(posId);
  }

  // Drag (mouse)
  function benchDragStart(e,id){ dragIdRef.current=id; dragSrcRef.current="bench"; e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",String(id)); }
  function pitchDragStart(e,id){ if(!isSetup){e.preventDefault();return;} dragIdRef.current=id; dragSrcRef.current="pitch"; e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",String(id)); }
  function slotDragOver(e,posId){ e.preventDefault(); setDropHi(posId); }
  function slotDragLeave(){ setDropHi(null); }
  function slotDrop(e,posId){ e.preventDefault(); setDropHi(null); if(dragIdRef.current==null)return; placeOnPitch(dragIdRef.current,posId); dragIdRef.current=null; dragSrcRef.current=null; }
  function pitchPlayerDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect="move"; }
  function pitchPlayerDrop(e,tgtId){
    e.preventDefault();
    var srcId=dragIdRef.current, src=dragSrcRef.current;
    dragIdRef.current=null; dragSrcRef.current=null;
    if(srcId==null)return;
    if(src==="bench") swapPlayers(srcId,tgtId);
    else if(src==="pitch"&&isSetup) swapPitchPos(srcId,tgtId);
  }

  // Touch drag
  function handleTouchStart(e,id,source) {
    var t=e.touches[0]; touchIdRef.current=id; touchSrcRef.current=source;
    var p=dbPlayers.find(function(pl){return pl.id===id;});
    var ghost=document.createElement("div");
    ghost.style.cssText="position:fixed;pointer-events:none;z-index:9999;width:38px;height:38px;border-radius:50%;background:#1D9E75;border:3px solid #0F6E56;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;transform:translate(-50%,-50%);left:"+t.clientX+"px;top:"+t.clientY+"px;opacity:0.9;";
    ghost.textContent = p ? String(p.jersey_number) : "";
    document.body.appendChild(ghost); touchGhostRef.current=ghost;
  }

  useEffect(function() {
    function onMove(e) {
      if(!touchGhostRef.current)return; e.preventDefault();
      var t=e.touches[0];
      touchGhostRef.current.style.left=t.clientX+"px"; touchGhostRef.current.style.top=t.clientY+"px";
      if(!pitchRef.current)return;
      var r=pitchRef.current.getBoundingClientRect();
      var xP=((t.clientX-r.left)/r.width)*100, yP=((t.clientY-r.top)/r.height)*100;
      var near=null,nearD=Infinity;
      positions.forEach(function(pos){var d=Math.hypot(pos.x-xP,pos.y-yP);if(d<nearD){nearD=d;near=pos.id;}});
      setDropHi(nearD<10?near:null);
    }
    function onEnd(e) {
      if(touchGhostRef.current){document.body.removeChild(touchGhostRef.current);touchGhostRef.current=null;}
      setDropHi(null);
      var dragId=touchIdRef.current, source=touchSrcRef.current;
      touchIdRef.current=null; touchSrcRef.current=null; if(!dragId)return;
      var t=e.changedTouches[0];
      var els=document.querySelectorAll("[data-pitch-player]");
      for(var i=0;i<els.length;i++){
        var r2=els[i].getBoundingClientRect();
        if(t.clientX>=r2.left&&t.clientX<=r2.right&&t.clientY>=r2.top&&t.clientY<=r2.bottom){
          var tgtId=els[i].dataset.pitchPlayer;
          if(source==="bench") swapPlayers(dragId,tgtId);
          else if(source==="pitch"&&isSetup) swapPitchPos(dragId,tgtId);
          return;
        }
      }
      if(!pitchRef.current)return;
      var r3=pitchRef.current.getBoundingClientRect();
      var xP2=((t.clientX-r3.left)/r3.width)*100, yP2=((t.clientY-r3.top)/r3.height)*100;
      var near2=null,nearD2=Infinity;
      positions.forEach(function(pos){var d=Math.hypot(pos.x-xP2,pos.y-yP2);if(d<nearD2){nearD2=d;near2=pos.id;}});
      if(near2&&nearD2<12) placeOnPitch(dragId,near2);
    }
    window.addEventListener("touchmove",onMove,{passive:false});
    window.addEventListener("touchend",onEnd);
    return function(){window.removeEventListener("touchmove",onMove);window.removeEventListener("touchend",onEnd);};
  }, [dbPlayers, positions, swapPlayers, placeOnPitch, swapPitchPos, isSetup]);

  // Position editing
  var startPosEditDrag = useCallback(function(e, posId) {
    if(!pitchRef.current)return;
    var isTouch=e.type==="touchstart";
    var point=isTouch?e.touches[0]:e;
    var r=pitchRef.current.getBoundingClientRect();
    var xPct=((point.clientX-r.left)/r.width)*100, yPct=((point.clientY-r.top)/r.height)*100;
    posEditDragRef.current={posId:posId};
    setPosEdit(function(prev){ return prev&&prev.posId===posId?Object.assign({},prev,{dragging:true,draftX:xPct,draftY:yPct}):prev; });
    e.stopPropagation(); if(!isTouch)e.preventDefault();
  }, []);

  useEffect(function() {
    function onMove(e) {
      if(!posEditDragRef.current)return;
      var pe=posEditRef.current; if(!pe||!pe.dragging)return;
      var isTouch=e.type==="touchmove"; var point=isTouch?e.touches[0]:e;
      if(!pitchRef.current)return; e.preventDefault();
      var r=pitchRef.current.getBoundingClientRect();
      var xPct=Math.min(96,Math.max(4,((point.clientX-r.left)/r.width)*100));
      var yPct=Math.min(96,Math.max(4,((point.clientY-r.top)/r.height)*100));
      setPosEdit(function(prev){ return prev?Object.assign({},prev,{draftX:xPct,draftY:yPct}):null; });
    }
    function onUp(){ posEditDragRef.current=null; }
    window.addEventListener("mousemove",onMove); window.addEventListener("touchmove",onMove,{passive:false});
    window.addEventListener("mouseup",onUp);     window.addEventListener("touchend",onUp);
    return function(){
      window.removeEventListener("mousemove",onMove); window.removeEventListener("touchmove",onMove);
      window.removeEventListener("mouseup",onUp);     window.removeEventListener("touchend",onUp);
    };
  }, []);

  var confirmPosEdit = useCallback(function() {
    if(!posEdit)return;
    setPositions(function(prev){return prev.map(function(p){return p.id===posEdit.posId?Object.assign({},p,{x:posEdit.draftX,y:posEdit.draftY}):p;});});
    setPosEdit(null);
  }, [posEdit]);

  // Exports
  function exportCSV() {
    // Count goals per player from this match's goalEvents
    var goalsByPlayer = {};
    goalEvents.forEach(function(g) {
      if (g.team === "home" && g.scorerId) {
        goalsByPlayer[g.scorerId] = (goalsByPlayer[g.scorerId] || 0) + 1;
      }
    });
    var headers = ["Name","Jersey","Position","Goals","Total Time"].concat(POSITIONS.map(function(p){return p.label+" ("+p.id+")";}));
    var rows = dbPlayers.map(function(p){
      var ps = pitchState[p.id] || {};
      var goals = goalsByPlayer[p.id] || 0;
      return [p.name, p.jersey_number, p.default_position, goals, fmtTime(ps.pitchSecs||0)].concat(POSITIONS.map(function(pos){return (ps.positionTimes&&ps.positionTimes[pos.id])?fmtTime(ps.positionTimes[pos.id]):""; }));
    });
    var csv = [headers].concat(rows).map(function(r){return r.map(function(c){return '"'+c+'"';}).join(",");}).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "match-report.csv"; a.click();
  }
  function exportSeasonCSV() {
    var totals = querySeasonTotals(seasonFilter);
    // Load all goal events from saved matches to tally season goals
    var allEvents = LS.get("st_events", []);
    var matchIds = new Set(LS.get("st_matches",[]).filter(function(m){return !seasonFilter||(m.match_date&&m.match_date.startsWith(seasonFilter));}).map(function(m){return m.id;}));
    var seasonGoals = {};
    allEvents.filter(function(e){return matchIds.has(e.match_id)&&e.event_type==="goal_home"&&e.player_id;}).forEach(function(e){
      seasonGoals[e.player_id] = (seasonGoals[e.player_id]||0)+1;
    });
    var headers = ["Name","Jersey","Season Goals","Season Total"].concat(POSITIONS.map(function(p){return p.label;}));
    var rows = totals.map(function(p){return [p.name,p.jersey_number,seasonGoals[p.id]||0,fmtTime(p.total)].concat(POSITIONS.map(function(pos){return p.byPos[pos.id]?fmtTime(p.byPos[pos.id]):""; }));});
    var csv = [headers].concat(rows).map(function(r){return r.map(function(c){return '"'+c+'"';}).join(",");}).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "season-"+seasonFilter+"-report.csv"; a.click();
  }
  function exportPDF() {
    var ps = pitchState;
    var teamName2 = (LS.get("st_team")||{}).name || "Home";
    var oppName   = opponent || "Away";
    var htSecs    = halfLength * 60; // expected halftime second

    // Build chronological event list with type info
    var timeline = [];

    goalEvents.forEach(function(g) {
      var scorer = g.scorerLabel ? " (<strong>" + g.scorerLabel + "</strong>)" : "";
      timeline.push({
        minute: g.minute, second: g.second,
        type: "goal", team: g.team,
        html: (g.team === "home"
          ? "<span style='color:#16a34a;font-weight:700'>Goal</span> &mdash; <strong>" + teamName2 + "</strong>" + scorer
          : "<span style='color:#dc2626;font-weight:700'>Goal</span> &mdash; <strong>" + oppName + "</strong>" + scorer)
      });
    });

    events.filter(function(e){ return e.event_type === "substitution"; }).forEach(function(e) {
      var pOn  = e.player_on_id  ? dbPlayers.find(function(p){return p.id===e.player_on_id;})  : null;
      var pOff = e.player_off_id ? dbPlayers.find(function(p){return p.id===e.player_off_id;}) : null;
      // Fall back to parsing the notes string "X on for Y"
      if (!pOn && !pOff && e.notes) {
        var parts = e.notes.match(/^(.+) on for (.+)$/);
        if (parts) {
          timeline.push({
            minute: Math.floor(e.match_second/60), second: e.match_second, type: "sub",
            html: "Substitution &mdash; "
              + "<span style='color:#16a34a;font-weight:700'>ON: <strong>" + parts[1] + "</strong></span>"
              + " &nbsp;|&nbsp; "
              + "<span style='color:#dc2626;font-weight:700'>OFF: <strong>" + parts[2] + "</strong></span>"
          });
          return;
        }
      }
      var onName  = pOn  ? pOn.name  : (e.notes ? e.notes : "Unknown");
      var offName = pOff ? pOff.name : "Unknown";
      timeline.push({
        minute: Math.floor(e.match_second/60), second: e.match_second, type: "sub",
        html: "Substitution &mdash; "
          + "<span style='color:#16a34a;font-weight:700'>ON: <strong>" + onName  + "</strong>" + (pOn  ? " (#"+pOn.jersey_number+")"  : "") + "</span>"
          + " &nbsp;|&nbsp; "
          + "<span style='color:#dc2626;font-weight:700'>OFF: <strong>" + offName + "</strong>" + (pOff ? " (#"+pOff.jersey_number+")" : "") + "</span>"
      });
    });

    // Sort by second
    timeline.sort(function(a,b){ return a.second - b.second; });

    // Build timeline HTML, injecting a halftime divider between halves
    var htInserted = false;
    var htHomeScore = 0, htAwayScore = 0;

    // Pre-compute score at halftime
    var tempH = 0, tempA = 0;
    timeline.forEach(function(e) {
      if (e.second <= htSecs && e.type === "goal") {
        if (e.team === "home") tempH++; else tempA++;
      }
    });
    htHomeScore = tempH; htAwayScore = tempA;

    var timelineRows = "";
    var rowIdx = 0;
    timeline.forEach(function(e) {
      // Insert halftime divider before first event in 2nd half (or at end if nothing in 2nd half)
      if (!htInserted && halves >= 2 && e.second > htSecs) {
        htInserted = true;
        timelineRows += "<tr><td colspan='2' style='"
          + "background:#f3f4f6;border-top:3px solid #9ca3af;border-bottom:3px solid #9ca3af;"
          + "text-align:center;padding:8px;font-size:12px;font-weight:700;color:#374151;letter-spacing:0.05em;'>"
          + "--- HALF TIME &nbsp;&nbsp; " + htHomeScore + " &ndash; " + htAwayScore + " &nbsp;&nbsp; ---"
          + "</td></tr>";
      }
      var bg = rowIdx % 2 === 0 ? "white" : "#f9fafb";
      timelineRows += "<tr style='background:" + bg + "'>"
        + "<td style='padding:6px 10px;font-weight:700;white-space:nowrap;font-size:12px;vertical-align:middle'>" + e.minute + "'</td>"
        + "<td style='padding:6px 10px;font-size:13px;vertical-align:middle'>" + e.html + "</td>"
        + "</tr>";
      rowIdx++;
    });

    // Append halftime divider at end if no 2nd-half events at all
    if (!htInserted && halves >= 2 && matchSecs > htSecs) {
      timelineRows += "<tr><td colspan='2' style='"
        + "background:#f3f4f6;border-top:3px solid #9ca3af;border-bottom:3px solid #9ca3af;"
        + "text-align:center;padding:8px;font-size:12px;font-weight:700;color:#374151;letter-spacing:0.05em;'>"
        + "--- HALF TIME &nbsp;&nbsp; " + htHomeScore + " &ndash; " + htAwayScore + " &nbsp;&nbsp; ---"
        + "</td></tr>";
    }

    var timelineHTML = timeline.length === 0 && !(halves >= 2 && matchSecs > htSecs)
      ? "<p style='color:#666;font-size:13px'>No events recorded.</p>"
      : '<table style="border-collapse:collapse;font-size:13px;width:100%;border:1px solid #e5e7eb">'
        + '<thead><tr style="background:#1D9E75;color:white">'
        + "<th style='padding:8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em'>Min</th>"
        + "<th style='padding:8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em'>Event</th>"
        + "</tr></thead><tbody>" + timelineRows + "</tbody></table>";

    // Goal summary with running score
    var runningScore = "";
    var h2 = 0, a2 = 0;
    timeline.filter(function(e){return e.type==="goal";}).forEach(function(g){
      if(g.team==="home") h2++; else a2++;
      var scorerLabel = "";
      var ge = goalEvents.find(function(ge2){return ge2.second===g.second && ge2.team===g.team;});
      if (ge && ge.scorerLabel) scorerLabel = " &mdash; <strong>" + ge.scorerLabel + "</strong>";
      runningScore += "<li style='margin-bottom:5px'>"
        + "<strong>" + g.minute + "'</strong> &mdash; "
        + "<span style='color:" + (g.team==="home"?"#16a34a":"#dc2626") + ";font-weight:700'>"
        + (g.team==="home" ? teamName2 : oppName) + "</span> scored" + scorerLabel
        + " <span style='font-weight:700;color:#374151'>(" + h2 + "&ndash;" + a2 + ")</span>"
        + "</li>";
    });
    var scoreSection = runningScore ? "<h2>Goal Summary</h2><ul style='list-style:disc;padding-left:1.4rem'>" + runningScore + "</ul>" : "";

    // Player times table - bold names
    var tbl = '<table style="border-collapse:collapse;font-size:12px;width:100%;border:1px solid #e5e7eb">'
      + '<thead><tr style="background:#1D9E75;color:white">'
      + '<th style="padding:8px;text-align:left">Name</th>'
      + '<th style="padding:8px;text-align:center">#</th>'
      + '<th style="padding:8px;text-align:center">Pos</th>'
      + '<th style="padding:8px;text-align:center">Total</th>'
      + POSITIONS.map(function(p){return "<th style='padding:8px;text-align:center;font-size:10px'>"+p.label+"</th>";}).join("")
      + "</tr></thead><tbody>"
      + dbPlayers.map(function(p,i){
          var totalSecs = (ps[p.id]&&ps[p.id].pitchSecs)||0;
          var bg = i%2===0 ? "white" : "#f9fafb";
          return '<tr style="background:'+bg+'">'
            + '<td style="padding:7px 8px"><strong>' + p.name + '</strong></td>'
            + '<td style="padding:7px 8px;text-align:center">' + p.jersey_number + '</td>'
            + '<td style="padding:7px 8px;text-align:center;color:#6b7280">' + p.default_position + '</td>'
            + '<td style="padding:7px 8px;text-align:center;font-weight:700;color:#1D9E75">' + fmtTime(totalSecs) + '</td>'
            + POSITIONS.map(function(pos){
                var t = ps[p.id]&&ps[p.id].positionTimes&&ps[p.id].positionTimes[pos.id];
                return '<td style="padding:7px 8px;text-align:center;color:'+(t?"#374151":"#d1d5db")+'">'+(t?fmtTime(t):"-")+"</td>";
              }).join("")
            + "</tr>";
        }).join("")
      + "</tbody></table>";

    var html = [
      "<!DOCTYPE html><html><head><meta charset='utf-8'>",
      "<title>Match Report - "+teamName2+"</title>",
      "<style>",
      "  body{font-family:Arial,sans-serif;padding:2rem;max-width:960px;margin:0 auto;color:#111}",
      "  h1{color:#1D9E75;margin-bottom:4px;font-size:1.8rem}",
      "  h2{color:#374151;margin-top:1.8rem;margin-bottom:0.7rem;font-size:1.1rem;border-bottom:2px solid #e5e7eb;padding-bottom:5px}",
      "  .header-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.2rem}",
      "  .stat-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}",
      "  .stat-box .num{font-size:2.2rem;font-weight:800;color:#1D9E75;line-height:1.1}",
      "  .stat-box .lbl{font-size:0.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px}",
      "  @media print{body{padding:0.5rem}.header-grid{page-break-inside:avoid}}",
      "</style></head><body>",
      "<h1>Match Report</h1>",
      "<p style='color:#6b7280;font-size:13px;margin-top:0;margin-bottom:1.2rem'>"+new Date().toLocaleDateString("en-AU",{weekday:"long",year:"numeric",month:"long",day:"numeric"})+"</p>",
      "<div class='header-grid'>",
      "  <div class='stat-box'><div class='num'>"+score.home+" &ndash; "+score.away+"</div><div class='lbl'><strong>"+teamName2+"</strong> vs <strong>"+oppName+"</strong>"+(venue?" &mdash; "+venue:"")+"</div></div>",
      "  <div class='stat-box'><div class='num'>"+fmtTime(matchSecs)+"</div><div class='lbl'>"+(halves>1?halves+"&times;"+halfLength+" min match":"Duration")+"</div></div>",
      "</div>",
      scoreSection,
      "<h2>Match Timeline</h2>",
      timelineHTML,
      "<h2>Player Time Breakdown</h2>",
      tbl,
      "</body></html>"
    ].join("\n");

    var w = window.open("","_blank");
    w.document.write(html);
    w.document.close();
    w.print();
  }

  // ---- Export the substitution plan (lineups + subs for each half) as a PDF ----
  function exportPlanPDF() {
    var teamName2 = (LS.get("st_team")||{}).name || "Home";
    var oppName   = opponent || "Away";

    function playerById(pid) { return dbPlayers.find(function(p){ return p.id === pid; }); }

    // Build per-position slot history: who occupies each slot over time
    // (starter + every planned sub in/out), same approach as the Plan tab timeline.
    var history = {}; // posId -> [ { playerId, fromMin, toMin|null } ]
    dbPlayers.forEach(function(p) {
      var ps = pitchState[p.id];
      if (ps && ps.pitchPos) {
        if (!history[ps.pitchPos]) history[ps.pitchPos] = [];
        history[ps.pitchPos].push({ playerId: p.id, fromMin: 0, toMin: null });
      }
    });
    var sorted = planSubs.filter(function(s){ return !s.done; }).slice().sort(function(a,b){ return a.minute - b.minute; });
    sorted.forEach(function(sub) {
      var posId = null;
      Object.keys(history).forEach(function(pid) {
        var arr = history[pid];
        if (arr.length > 0 && arr[arr.length-1].playerId === sub.playerOffId && arr[arr.length-1].toMin === null) posId = pid;
      });
      if (!posId) return;
      history[posId][history[posId].length-1].toMin = sub.minute;
      history[posId].push({ playerId: sub.playerOnId, fromMin: sub.minute, toMin: null });
    });

    function lineupAt(min) {
      var map = {}; // posId -> playerId
      Object.keys(history).forEach(function(posId) {
        var arr = history[posId];
        for (var i = 0; i < arr.length; i++) {
          var e = arr[i];
          if (e.fromMin <= min && (e.toMin === null || e.toMin > min)) { map[posId] = e.playerId; return; }
        }
        if (arr.length > 0) map[posId] = arr[arr.length-1].playerId;
      });
      return map;
    }

    var lineup1 = lineupAt(0);
    var lineup2 = lineupAt(halfLength);
    var subs1 = sorted.filter(function(s){ return s.minute <= halfLength; });
    var subs2 = sorted.filter(function(s){ return s.minute > halfLength; });

    // Simplified pitch markings: plain black lines on a white background, no fill/stripes.
    var pitchMarkings = [
      '<svg viewBox="0 0 68 105" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%">',
        '<rect x="1" y="1" width="66" height="103" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<line x1="1" y1="52.5" x2="67" y2="52.5" stroke="#000000" stroke-width="0.6" />',
        '<circle cx="34" cy="52.5" r="9.15" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<circle cx="34" cy="52.5" r="0.5" fill="#000000" />',
        '<circle cx="34" cy="11" r="0.5" fill="#000000" />',
        '<circle cx="34" cy="94" r="0.5" fill="#000000" />',
        '<rect x="13.84" y="1" width="40.32" height="16.5" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<rect x="13.84" y="87.5" width="40.32" height="16.5" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<rect x="24.84" y="1" width="18.32" height="5.5" fill="none" stroke="#000000" stroke-width="0.5" />',
        '<rect x="24.84" y="98.5" width="18.32" height="5.5" fill="none" stroke="#000000" stroke-width="0.5" />',
        '<rect x="30.34" y="0" width="7.32" height="1" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<rect x="30.34" y="104" width="7.32" height="1" fill="none" stroke="#000000" stroke-width="0.6" />',
        '<clipPath id="topArcClipExp"><rect x="0" y="17.5" width="68" height="87.5" /></clipPath>',
        '<clipPath id="botArcClipExp"><rect x="0" y="0" width="68" height="87.5" /></clipPath>',
        '<circle cx="34" cy="11" r="9.15" fill="none" stroke="#000000" stroke-width="0.5" clip-path="url(#topArcClipExp)" />',
        '<circle cx="34" cy="94" r="9.15" fill="none" stroke="#000000" stroke-width="0.5" clip-path="url(#botArcClipExp)" />',
        '<path d="M 1 3 A 2 2 0 0 1 3 1" fill="none" stroke="#000000" stroke-width="0.5" />',
        '<path d="M 65 1 A 2 2 0 0 1 67 3" fill="none" stroke="#000000" stroke-width="0.5" />',
        '<path d="M 1 102 A 2 2 0 0 0 3 104" fill="none" stroke="#000000" stroke-width="0.5" />',
        '<path d="M 65 104 A 2 2 0 0 0 67 102" fill="none" stroke="#000000" stroke-width="0.5" />',
      '</svg>'
    ].join("");

    function pitchHTML(lineupMap) {
      var markers = positions.map(function(pos) {
        var pid = lineupMap[pos.id];
        var p = pid ? playerById(pid) : null;
        if (!p) return "";
        return '<div style="position:absolute;left:'+pos.x+'%;top:'+pos.y+'%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;">'
          + '<div style="width:32px;height:32px;border-radius:50%;background:#ffffff;border:1.5px solid #000000;display:flex;align-items:center;justify-content:center;color:#000000;font-weight:700;font-size:12px">' + p.jersey_number + '</div>'
          + '<div style="margin-top:2px;color:#000000;font-size:9px;font-weight:600;white-space:nowrap;max-width:72px;overflow:hidden;text-overflow:ellipsis">' + p.name.split(" ")[0] + '</div>'
          + '</div>';
      }).join("");
      return '<div style="position:relative;width:100%;padding-bottom:154.4%;border-radius:6px;overflow:hidden;background:#ffffff;border:1px solid #000000;">'
        + pitchMarkings + markers + '</div>';
    }

    function subsListHTML(subsArr, emptyMsg) {
      if (subsArr.length === 0) return '<div style="color:#9ca3af;font-style:italic;padding:10px 2px;font-size:13px">' + emptyMsg + '</div>';
      return '<div>' + subsArr.map(function(s) {
        var off = playerById(s.playerOffId), on = playerById(s.playerOnId);
        var htTag = (s.minute === halfLength) ? ' <span style="color:#6b7280;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">(Half-time)</span>' : '';
        return '<div style="display:flex;align-items:center;gap:12px;padding:9px 10px;border-bottom:1px solid #e5e7eb">'
          + '<div style="font-weight:800;color:#111;min-width:42px;font-size:13px">' + s.minute + "'" + '</div>'
          + '<div style="flex:1;font-size:12px"><span style="color:#dc2626;font-weight:700">OFF</span> ' + (off ? off.name + ' (#' + off.jersey_number + ')' : 'Unknown') + '</div>'
          + '<div style="flex:1;font-size:12px"><span style="color:#16a34a;font-weight:700">ON</span> ' + (on ? on.name + ' (#' + on.jersey_number + ')' : 'Unknown') + '</div>'
          + htTag
          + '</div>';
      }).join("") + '</div>';
    }

    function pageHTML(title, lineupMap, subsArr, isFirst) {
      return '<div class="plan-page" style="' + (isFirst ? '' : 'page-break-before:always;') + 'display:flex;gap:28px;padding:14px;box-sizing:border-box;">'
        + '<div style="flex:0 0 34%;">'
          + '<h1 style="margin:0 0 2px 0;color:#1D9E75;font-size:1.3rem">' + title + '</h1>'
          + '<div style="color:#6b7280;font-size:12px;margin-bottom:10px">' + teamName2 + ' vs ' + oppName + (venue ? ' &mdash; ' + venue : '') + '</div>'
          + pitchHTML(lineupMap)
        + '</div>'
        + '<div style="flex:1;">'
          + '<h2 style="margin:0 0 8px 0;color:#374151;font-size:1.05rem;border-bottom:2px solid #e5e7eb;padding-bottom:6px">Substitutions</h2>'
          + subsListHTML(subsArr, "No substitutions scheduled")
        + '</div>'
      + '</div>';
    }

    var html = [
      "<!DOCTYPE html><html><head><meta charset='utf-8'>",
      "<title>Match Plan - "+teamName2+"</title>",
      "<style>",
      "  @page { size: landscape; margin: 10mm; }",
      "  body { font-family: Arial, sans-serif; margin:0; color:#111; }",
      "  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }",
      "  @media print { .plan-page { page-break-inside: avoid; } }",
      "</style></head><body>",
      pageHTML("First Half", lineup1, subs1, true),
      pageHTML("Second Half", lineup2, subs2, false),
      "</body></html>"
    ].join("\n");

    var w = window.open("","_blank");
    w.document.write(html);
    w.document.close();
    w.print();
  }


  function buildPayload() {
    return {
      v: 1,
      team:      LS.get("st_team"),
      players:   LS.get("st_players", []),
      positions: LS.get("st_positions", POSITIONS),
      planSubs:  planSubs,
      pitchSetup: Object.keys(pitchState).reduce(function(acc, pid) {
        if (pitchState[pid] && pitchState[pid].pitchPos) { acc[pid] = pitchState[pid].pitchPos; }
        return acc;
      }, {}),
    };
  }

  // Apply an imported payload to all state + localStorage
  function applyPayload(payload) {
    if (payload.team) {
      // Keep this device's own team id (and the namespace/registry entry tied to it) --
      // only adopt the imported name/season/coach, not the sender's (or a freshly
      // generated) team id. This prevents creating an orphaned/duplicate entry in
      // the team switcher.
      var merged = Object.assign({}, payload.team, { id: team.id });
      LS.set("st_team", merged); setTeamState(merged); setTeamName(merged.name||""); setTeamSeason(merged.season||""); setCoachName(merged.coach_name||"");
    }
    if (payload.players)   { LS.set("st_players", payload.players); setDbPlayers(payload.players); }
    if (payload.positions) { LS.set("st_positions", payload.positions); setPositions(payload.positions); }
    if (payload.planSubs)  { setPlanSubs(payload.planSubs); }
    if (payload.pitchSetup && payload.players) {
      var newPS = payload.players.reduce(function(acc, p) {
        acc[p.id] = { pitchPos: payload.pitchSetup[p.id] || null, pitchSecs: 0, positionTimes: {}, stints: [] };
        return acc;
      }, {});
      setPitchState(newPS);
    }
  }

  // Import a shared payload, matching by team name against the teams already
  // cached on this device:
  //  - If a cached team has the same name AND it's the one we're currently on,
  //    apply the data live (no reload).
  //  - If a cached team has the same name but ISN'T active, load the data into
  //    THAT team's storage and switch to it (reload).
  //  - If no cached team matches, create a new team with this name and load the
  //    data into it (reload).
  // gameSettings is an optional { hl, ha } for half-length/halves from compact links.
  function importSharedPayload(payload, gameSettings) {
    var importName = (payload.team && payload.team.name) ? String(payload.team.name).trim() : "";
    var registry = LS.get("st_teams_registry", []);
    var existing = importName
      ? registry.find(function(t){ return (t.name||"").trim().toLowerCase() === importName.toLowerCase(); })
      : null;

    if (existing && existing.id === activeTeamId) {
      // Importing into the team we're already on -- apply live, no reload needed.
      applyPayload(payload);
      if (gameSettings && gameSettings.hl) { setHalfLength(gameSettings.hl); LS.set("st_halfLength", gameSettings.hl); }
      if (gameSettings && gameSettings.ha) { setHalves(gameSettings.ha); LS.set("st_halves", gameSettings.ha); }
      return { mode: "current", teamName: importName || team.name };
    }

    var targetId, targetName;
    if (existing) {
      targetId = existing.id; targetName = existing.name;
    } else {
      targetId = uid();
      targetName = importName || "Imported Team";
      registry = registry.concat([{ id: targetId, name: targetName }]);
      LS.set("st_teams_registry", registry);
    }

    var mergedTeam = Object.assign(
      { id: targetId, name: targetName, season: String(new Date().getFullYear()), coach_name: "", created_at: new Date().toISOString() },
      payload.team || {},
      { id: targetId, name: targetName }
    );
    try {
      localStorage.setItem("st_team__" + targetId, JSON.stringify(mergedTeam));
      if (payload.players)    localStorage.setItem("st_players__"    + targetId, JSON.stringify(payload.players));
      if (payload.positions)  localStorage.setItem("st_positions__"  + targetId, JSON.stringify(payload.positions));
      if (payload.planSubs)   localStorage.setItem("st_planSubs__"   + targetId, JSON.stringify(payload.planSubs));
      if (payload.pitchSetup) localStorage.setItem("st_pitchSetup__" + targetId, JSON.stringify(payload.pitchSetup));
      if (gameSettings && gameSettings.hl) localStorage.setItem("st_halfLength__" + targetId, JSON.stringify(gameSettings.hl));
      if (gameSettings && gameSettings.ha) localStorage.setItem("st_halves__"     + targetId, JSON.stringify(gameSettings.ha));
    } catch(e) {}

    // Defer flipping the active team + reloading until after this render's other
    // effects have run. Several effects sync the CURRENT (old) team's state back
    // to localStorage via LS.set, which is namespaced by st_active_team -- if we
    // switched that immediately, those effects would write the old team's data
    // into the new team's namespace, clobbering what we just imported above.
    setTimeout(function(){
      try { localStorage.setItem("st_active_team", targetId); } catch(e) {}
      window.location.reload();
    }, 0);
    return { mode: existing ? "switched" : "created", teamName: targetName };
  }

  // Fisher-Yates shuffle - used to randomize auto-plan results so repeated
  // generates don't always produce the exact same arrangement.
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---- AUTO PLAN GENERATOR ----
  // randomizeArrangement: if true (Re-generate), ignore the current pitch setup and
  // build a fresh random starting arrangement before generating the plan.
  function generateAutoPlan(randomizeArrangement) {
    var availPlayers = shuffleArray(dbPlayers.filter(function(p){ return !unavailable.has(p.id); }));
    var pitchSize    = apPlayerSize === -1 ? (parseInt(apPlayerSizeCustom)||7) : apPlayerSize;
    var maxPerWindow = apMaxSubsPerWindow === -1 ? (parseInt(apMaxSubsCustom)||99) : (apMaxSubsPerWindow === 0 ? 99 : apMaxSubsPerWindow);
    var canReturn    = apCanComeBack;

    // ---- Step 0: Pick the position slots to use for this formation, balanced ----
    // Build a LOCAL copy of the position layout (setPositions/setRemovedPositions are async,
    // so the algorithm below needs an up-to-date list to work with immediately).
    var lineOrder = ["gk","def","mid","fwd"];

    // Pool = every position slot we know about (currently on the pitch + previously
    // removed). Group by line, preferring slots that are CURRENTLY on the pitch and
    // currently occupied (to minimize disrupting the existing setup) first.
    var pool = positions.slice().concat(removedPositions.slice());
    var byLine = { gk:[], def:[], mid:[], fwd:[] };
    pool.forEach(function(p){
      var line = POSITION_LINE[p.label] || "fwd";
      if (!byLine[line]) byLine[line] = [];
      byLine[line].push(p);
    });
    var occupiedPosIdsAll = new Set(dbPlayers.map(function(p){ return pitchState[p.id] && pitchState[p.id].pitchPos; }).filter(Boolean));
    Object.keys(byLine).forEach(function(line){
      byLine[line].sort(function(a,b){
        var ao = occupiedPosIdsAll.has(a.id) ? 0 : 1;
        var bo = occupiedPosIdsAll.has(b.id) ? 0 : 1;
        return ao - bo;
      });
    });

    // Positions currently occupied by a player are mandatory -- never drop them
    // (that would orphan a player on a slot that no longer exists). The balancing
    // below adds MORE positions on top of these, up to pitchSize.
    var selected = pool.filter(function(p){ return occupiedPosIdsAll.has(p.id); });
    var selectedIds = new Set(selected.map(function(p){ return p.id; }));
    function takeFrom(line, preferredId) {
      var pool_ = byLine[line]||[];
      var c = null;
      if (preferredId) c = pool_.find(function(p){ return p.id === preferredId && !selectedIds.has(p.id); });
      if (!c) c = pool_.find(function(p){ return !selectedIds.has(p.id); });
      if (c) { selected.push(c); selectedIds.add(c.id); return true; }
      return false;
    }
    // 1) Make sure there's at least ONE of each line (GK, Defender, Midfielder, Striker)
    // -- a balanced shape comes before adding depth in any one line. "Striker"
    // specifically means a central forward (ST) -- having wingers (LW/RW) alone
    // doesn't satisfy this, since they're a different role.
    lineOrder.forEach(function(line){
      if (selected.length >= pitchSize) return;
      var hasLine;
      if (line === "fwd") {
        hasLine = selected.some(function(p){ return p.label === "ST"; });
      } else {
        hasLine = selected.some(function(p){ return (POSITION_LINE[p.label]||"fwd") === line; });
      }
      if (hasLine) return;
      takeFrom(line, line === "fwd" ? "ST" : null);
    });
    // 2) Fill remaining slots, prioritized defence -> midfield -> attack
    ["def","mid","fwd"].forEach(function(line){
      while (selected.length < pitchSize && takeFrom(line)) {}
    });
    // 3) Anything left over (e.g. extra GKs) -- shouldn't normally be needed
    lineOrder.forEach(function(line){
      while (selected.length < pitchSize && takeFrom(line)) {}
    });
    // 4) If still short (formation bigger than the whole pool), add brand-new
    // positions. Extra slots default to attacking positions (ST), placed in a row
    // above the existing forward line.
    var extraCount = 0;
    while (selected.length < pitchSize) {
      extraCount++;
      var newId = "EXTRA_ST" + extraCount;
      var fwdPositions = selected.filter(function(p){ return (POSITION_LINE[p.label]||"") === "fwd"; });
      var baseY = fwdPositions.length > 0 ? Math.min.apply(null, fwdPositions.map(function(p){return p.y;})) : 22;
      var newPos = { id:newId, label:"ST", x: 30 + (extraCount * 15) % 50, y: Math.max(8, baseY - 10) };
      selected.push(newPos);
      selectedIds.add(newPos.id);
    }

    var localPositions = selected;
    var localRemoved = pool.filter(function(p){ return !selectedIds.has(p.id); });

    // Commit changes if the selection differs from the current saved layout
    var positionsChanged = localPositions.length !== positions.length
      || localPositions.some(function(p,i){ return !positions[i] || positions[i].id !== p.id; });
    if (positionsChanged) {
      setPositions(localPositions);
      setRemovedPositions(localRemoved);
    }


    // ---- Step 1: Auto-assign players to pitch if not enough starters ----
    var localPitchMap = {}; // pid -> posId (starters for the plan)

    if (randomizeArrangement) {
      // Re-generate: scrap the current arrangement and pick a fresh random one.
      // Keep a default-GK player in the GK slot (if one exists) so the result still
      // looks like a sensible lineup; shuffle everyone else into the remaining slots.
      var slots = localPositions.slice(0, pitchSize);
      var gkSlotIndex = slots.findIndex(function(pos){ return pos.id === "GK"; });
      var gkCandidates = shuffleArray(availPlayers.filter(function(p){ return p.default_position === "GK"; }));
      var chosenGk = gkCandidates.length > 0 ? gkCandidates[0] : null;
      var others = shuffleArray(availPlayers.filter(function(p){ return !chosenGk || p.id !== chosenGk.id; }));

      var assigned = [];
      if (chosenGk && gkSlotIndex !== -1) assigned[gkSlotIndex] = chosenGk;
      var fillIdx = 0;
      for (var si = 0; si < slots.length; si++) {
        if (assigned[si]) continue;
        if (others[fillIdx]) { assigned[si] = others[fillIdx]; fillIdx++; }
      }
      assigned.forEach(function(p, i){ if (p) localPitchMap[p.id] = slots[i].id; });

      // Reflect this new arrangement on the pitch (clears everyone else to bench)
      setPitchState(function(prev) {
        var next = {};
        dbPlayers.forEach(function(p) {
          var existing = prev[p.id] || { pitchSecs:0, positionTimes:{}, stints:[] };
          next[p.id] = Object.assign({}, existing, { pitchPos: localPitchMap[p.id] || null });
        });
        return next;
      });
    } else {
      var currentStarters = availPlayers.filter(function(p){ return pitchState[p.id] && pitchState[p.id].pitchPos; });
      var currentBenchAll = shuffleArray(availPlayers.filter(function(p){ return !pitchState[p.id] || !pitchState[p.id].pitchPos; }));

      // Build localPitchMap from the existing arrangement first
      currentStarters.forEach(function(p){ localPitchMap[p.id] = pitchState[p.id].pitchPos; });

      // If fewer starters than pitchSize, auto-place bench players (random order) onto
      // empty positions. This is the ONE source of truth -- the same selection is used
      // for both the algorithm (localPitchMap) and the pitch diagram (setPitchState),
      // so they can never disagree about who's a starter.
      if (currentStarters.length < pitchSize && currentBenchAll.length > 0) {
        var occupiedPosIds = new Set(currentStarters.map(function(p){ return pitchState[p.id].pitchPos; }));
        var emptyPositions = localPositions.filter(function(pos){ return !occupiedPosIds.has(pos.id); });
        var autoPlaceCount = Math.max(0, pitchSize - currentStarters.length);
        var toPlace = currentBenchAll.slice(0, Math.min(autoPlaceCount, emptyPositions.length));
        toPlace.forEach(function(p, i) {
          var pos = emptyPositions[i];
          if (!pos) return;
          localPitchMap[p.id] = pos.id;
          // Persist this same placement to the pitch diagram
          setPitchState(function(prev) {
            var next = Object.assign({}, prev);
            next[p.id] = Object.assign({}, next[p.id] || {pitchSecs:0,positionTimes:{},stints:[]}, { pitchPos: pos.id });
            return next;
          });
        });
      }
    }

    var starters = availPlayers.filter(function(p){ return !!localPitchMap[p.id]; });
    var benchPool = availPlayers.filter(function(p){ return !localPitchMap[p.id]; });

    if (starters.length === 0) {
      alert("No players available to generate a plan.");
      return;
    }

    // Identify who is ACTUALLY standing in the GK position (not just default_position==="GK",
    // since a backup keeper might be auto-placed in an outfield slot)
    var gkStarterId = null;
    starters.forEach(function(p){ if(localPitchMap[p.id] === "GK") gkStarterId = p.id; });
    var gkPlayers    = availPlayers.filter(function(p){ return p.default_position === "GK"; });

    // Resolve who becomes GK in the second half (if applicable) -- done up front so the
    // fairness simulation can reserve/release this player at the right times.
    var secondHalfGkId = null;
    if (halves >= 2 && gkStarterId) {
      if (apGkChange === "halftime-specified" && apGkPick) {
        secondHalfGkId = apGkPick;
      } else if (apGkChange === "halftime-random" && gkPlayers.length > 1) {
        var otherGksPre = gkPlayers.filter(function(p){ return p.id !== gkStarterId && !unavailable.has(p.id); });
        if (otherGksPre.length > 0) {
          secondHalfGkId = otherGksPre[Math.floor(Math.random()*otherGksPre.length)].id;
        }
      }
    }
    var hasSecondHalfSwap = !!secondHalfGkId && secondHalfGkId !== gkStarterId;
    // Does the incoming 2nd-half GK currently start the match on the bench?
    var secondHalfGkStartsOnBench = hasSecondHalfSwap && !localPitchMap[secondHalfGkId];

    // "GK allowed as outfield" only applies for Halftime-Random / Halftime-Specified --
    // ignore any stale value if the mode is "Never" (always excluded) or "Equal" (always included).
    var effectiveGkOutfield = apGkOutfield && apGkChange !== "never" && apGkChange !== "equal";

    // ---- Fairness target ----
    // If the GK doesn't rotate (any mode except "Equal") AND "GK allowed as outfield" is OFF,
    // exclude the GK position from the field-minutes pool, and exclude the starting GK from
    // the player pool when working out each player's fair share of minutes.
    // With "GK allowed as outfield" ON, GK players participate in the fairness pool like
    // everyone else -- the starting GK can pick up outfield minutes once their GK spell ends.
    var gkExcludedFromRotation = (apGkChange !== "equal") && !!gkStarterId && !effectiveGkOutfield;
    var outfieldSlots = gkExcludedFromRotation ? Math.max(1, pitchSize - 1) : pitchSize;
    var rotatingPool  = gkExcludedFromRotation
      ? availPlayers.filter(function(p){ return p.id !== gkStarterId; })
      : availPlayers.slice();

    // (game length) x (outfield positions) = total field-minutes available
    var totalFieldMinutes = matchLength * outfieldSlots;
    // total field-minutes / available rotating players = desired minutes per player
    var desiredMinsPerPlayer = rotatingPool.length > 0 ? totalFieldMinutes / rotatingPool.length : matchLength;

    // If the incoming 2nd-half GK currently starts as an OUTFIELD player, they're guaranteed
    // (matchLength - halfLength) minutes in goal later -- so their fair share of outfield
    // time BEFORE halftime should be reduced accordingly, otherwise they end up over-served
    // (full pre-HT outfield stint PLUS a full 2nd-half GK stint).
    var secondHalfGkPreHTTarget = hasSecondHalfSwap ? Math.max(0, desiredMinsPerPlayer - (matchLength - halfLength)) : 0;
    // The minute they should be rested to the bench (ready for the halftime GK swap)
    var secondHalfGkRestMinute = (hasSecondHalfSwap && !secondHalfGkStartsOnBench)
      ? Math.max(1, Math.min(halfLength - 1, Math.round(secondHalfGkPreHTTarget)))
      : null;

    // ---- Step 2: Determine change window minutes ----
    var windowMins = [];
    var totalSubs = benchPool.length; // bench players who need at least one turn on

    // Use a fine-grained, fairness-driven simulation only when the coach wants
    // unlimited windows AND unlimited subs per window AND "any" timing (either variant)
    // AND time-fairness focus.
    var useTimeFairnessSim = (apFocus === "time" && apChangeWindows === 0 && apMaxSubsPerWindow === 0 && (apWindowTime === "any" || apWindowTime === "any-free"));

    if (apWindowTime === "specify" && apWindowTimes.length > 0) {
      // Use the explicitly specified times
      var specCount = apChangeWindows === 0 ? apWindowTimes.length : (apChangeWindows === -1 ? (parseInt(apChangeWindowsCustom)||apWindowTimes.length) : apChangeWindows);
      windowMins = apWindowTimes.slice(0, specCount).filter(function(t){ return t > 0; });

    } else if (apWindowTime === "every") {
      // Every X minutes
      var interval = Math.max(1, apWindowTimeX);
      var maxWin   = apChangeWindows === 0 ? 99 : (apChangeWindows === -1 ? (parseInt(apChangeWindowsCustom)||99) : apChangeWindows);
      for (var t = interval; t < matchLength && windowMins.length < maxWin; t += interval) {
        windowMins.push(t);
      }

    } else if (useTimeFairnessSim) {
      // checkInterval controls SENSITIVITY (how big the drift needs to be before a sub
      // is worth making) -- it's the same for both "any" variants.
      var checkInterval = Math.max(2, matchLength / 10);
      if (apWindowTime === "any-free") {
        // No restrictions: a checkpoint every minute, so a sub can land on whatever
        // minute the drift first crosses the threshold (e.g. 2, 8, 16...), not just
        // multiples of checkInterval.
        for (var tcF = 1; tcF < matchLength; tcF++) {
          windowMins.push(tcF);
        }
      } else {
        // Evenly distributed: checkpoints only at fixed checkInterval steps.
        for (var tc = checkInterval; tc < matchLength; tc += checkInterval) {
          windowMins.push(Math.round(tc * 10) / 10);
        }
      }

    } else {
      // "any" - spread bench rotations across multiple SMALLER windows rather than
      // dumping the whole bench in at one single window.
      var numWinNeeded;
      if (apChangeWindows === 0) {
        // Unlimited - aim for roughly one window per bench player (one rotation slot each),
        // but don't pack windows closer than ~5 minutes apart, and cap at 8 windows.
        var maxWindowsBySpacing = Math.max(1, Math.floor(matchLength / 5) - 1);
        numWinNeeded = totalSubs > 0 ? Math.min(totalSubs, maxWindowsBySpacing, 8) : 1;
      } else if (apChangeWindows === -1) {
        numWinNeeded = parseInt(apChangeWindowsCustom) || 1;
      } else {
        numWinNeeded = apChangeWindows;
      }

      numWinNeeded = Math.max(1, numWinNeeded);
      var step = Math.floor(matchLength / (numWinNeeded + 1));
      step = Math.max(1, step);
      for (var wi = 1; wi <= numWinNeeded; wi++) {
        windowMins.push(wi * step);
      }
    }

    // Avoid scheduling routine rotation subs in the first/last 2 minutes of each half --
    // these moments are disruptive (kickoff/restart, or right before a whistle).
    // The halftime GK swap and its "rest" checkpoint are exempt (they're forced/
    // scheduled events, not routine rotation).
    function isRestrictedSubMinute(m) {
      for (var h = 0; h < halves; h++) {
        var start = h * halfLength;
        var end = Math.min((h + 1) * halfLength, matchLength);
        if (m > start && m <= start + 2) return true;  // first 2 min of this half
        if (m >= end - 2 && m < end) return true;      // last 2 min of this half
      }
      return false;
    }
    windowMins = windowMins.filter(function(m){ return !isRestrictedSubMinute(m); });

    if (windowMins.length === 0) windowMins.push(Math.floor(matchLength / 2));
    // Make sure the halftime GK swap (if scheduled) always has a checkpoint to attach to
    if (hasSecondHalfSwap && windowMins.indexOf(halfLength) === -1) {
      windowMins.push(halfLength);
    }
    // Make sure the 2nd-half GK's "rest" checkpoint exists (so they're on the bench by halftime)
    if (secondHalfGkRestMinute !== null && windowMins.indexOf(secondHalfGkRestMinute) === -1) {
      windowMins.push(secondHalfGkRestMinute);
    }
    windowMins.sort(function(a,b){ return a-b; });

    // If "max subs per window" is Unlimited (and we're not running the fine-grained sim),
    // don't let it mean "everyone at once" -- spread bench rotations evenly across windows.
    if (apMaxSubsPerWindow === 0 && !useTimeFairnessSim) {
      maxPerWindow = Math.max(1, Math.ceil(totalSubs / windowMins.length));
    }

    // "Unlimited" subs per window means just that -- don't impose an artificial cap.
    // The swapThreshold below naturally limits how many swaps make sense per checkpoint.
    var effectiveMaxPerWindow = useTimeFairnessSim ? 99 : maxPerWindow;
    // A larger threshold means fewer, more meaningful substitutions -- only swap when the
    // gap is at least 1.5 checkpoints' worth of drift.
    var swapThreshold = useTimeFairnessSim ? (checkInterval * 1.5) : 0;

    // ---- Step 3: Generate the sub plan ----
    var projMins = {};
    var onField  = {};  // pid -> minute they entered
    var fieldPos = {};  // pid -> position slot id they currently occupy (travels with subs)
    var subbedOff = {}; // pid -> true if this player has EVER gone from pitch to bench
                         // via regular rotation (the correct gate for "can a player come back on" = No)

    availPlayers.forEach(function(p){ projMins[p.id] = 0; });
    starters.forEach(function(p){ onField[p.id] = 0; fieldPos[p.id] = localPitchMap[p.id]; });


    var newSubs = [];

    windowMins.forEach(function(winMin) {
      // Forced "rest" sub: if the incoming 2nd-half GK started as an outfield player,
      // bring them off at their pre-HT target time so they're on the bench, ready
      // for the halftime GK swap below.
      if (secondHalfGkRestMinute !== null && winMin === secondHalfGkRestMinute) {
        if (secondHalfGkId in onField) {
          var restBench = availPlayers.filter(function(p){ return !(p.id in onField); });
          restBench.sort(function(a,b){ return (projMins[a.id]||0) - (projMins[b.id]||0); });
          if (restBench.length > 0) {
            var restOn = restBench[0];
            projMins[secondHalfGkId] = (projMins[secondHalfGkId]||0) + (winMin - (onField[secondHalfGkId]||0));
            delete onField[secondHalfGkId];
            onField[restOn.id] = winMin;
            fieldPos[restOn.id] = fieldPos[secondHalfGkId];
            delete fieldPos[secondHalfGkId];
            newSubs.push({ id:uid(), minute:winMin, playerOffId:secondHalfGkId, playerOnId:restOn.id, done:false });
          }
        }
      }

      // If the incoming 2nd-half GK STARTED ON THE BENCH (and "GK allowed as outfield"
      // is on), they're free to rotate into outfield like any other bench player during
      // the first half (see benchEligible below). Once they've had their fair share of
      // outfield time -- or it's halftime, whichever comes first -- force them back to
      // the bench so they're ready for the halftime GK swap below.
      if (effectiveGkOutfield && hasSecondHalfSwap && secondHalfGkStartsOnBench && winMin <= halfLength && (secondHalfGkId in onField)) {
        var sgkAccum = (projMins[secondHalfGkId]||0) + (winMin - (onField[secondHalfGkId]||0));
        if (sgkAccum >= secondHalfGkPreHTTarget || winMin === halfLength) {
          var restBench3 = availPlayers.filter(function(p){ return !(p.id in onField); });
          restBench3.sort(function(a,b){ return (projMins[a.id]||0) - (projMins[b.id]||0); });
          if (restBench3.length > 0) {
            var restOn3 = restBench3[0];
            projMins[secondHalfGkId] = sgkAccum;
            delete onField[secondHalfGkId];
            onField[restOn3.id] = winMin;
            fieldPos[restOn3.id] = fieldPos[secondHalfGkId];
            delete fieldPos[secondHalfGkId];
            newSubs.push({ id:uid(), minute:winMin, playerOffId:secondHalfGkId, playerOnId:restOn3.id, done:false });
          }
        }
      }

      // Forced halftime GK swap: the starting GK comes off goal, the 2nd-half GK goes on.
      // This happens BEFORE the regular rotation check for this checkpoint so the
      // eligibility filters below see the post-swap state.
      if (hasSecondHalfSwap && winMin === halfLength) {
        var gkCurrentlyOn = (gkStarterId in onField);
        var secondGkOnBench = !(secondHalfGkId in onField);
        if (gkCurrentlyOn && secondGkOnBench) {
          projMins[gkStarterId] = (projMins[gkStarterId]||0) + (winMin - (onField[gkStarterId]||0));
          delete onField[gkStarterId];
          onField[secondHalfGkId] = winMin;
          fieldPos[secondHalfGkId] = fieldPos[gkStarterId]; // takes over the GK slot
          delete fieldPos[gkStarterId];
          newSubs.push({ id:uid(), minute:winMin, playerOffId:gkStarterId, playerOnId:secondHalfGkId, done:false });
        }
        // If the 2nd-half GK is currently on the pitch (not on bench), skip the forced
        // swap here -- this is an unusual setup and existing conflict tools can resolve it.
      }

      // Is the 2nd-half GK now active (i.e., have we passed the halftime swap point)?
      var isPostHT = hasSecondHalfSwap && winMin >= halfLength;
      var activeGkId = isPostHT ? secondHalfGkId : gkStarterId;

      var currentField = Object.keys(onField);
      // Use 'in' check, not truthiness - onField[pid]=0 (entered at minute 0) is valid but falsy
      var currentBench = availPlayers.filter(function(p){ return !(p.id in onField); });
      // "Can come back on" = No: once a player has been subbed OFF via the regular
      // rotation, they're done for the match -- not just "can't come on again".
      if (!canReturn) currentBench = currentBench.filter(function(p){ return !subbedOff[p.id]; });

      // Exclude whichever player is CURRENTLY the active GK from regular rotation
      // (unless "Equal rotation" is selected, in which case everyone rotates freely).
      // Also reserve the incoming 2nd-half GK from regular field rotation until their
      // dedicated "rest" sub has happened (handled above), so they get exactly their
      // pre-HT target before going to the bench ahead of the halftime swap.
      var fieldEligible = currentField.filter(function(pid){
        if (apGkChange === "equal") return true;
        if (pid === activeGkId) return false;
        if (secondHalfGkRestMinute !== null && pid === secondHalfGkId && winMin <= secondHalfGkRestMinute) return false;
        return true;
      });
      var benchEligible = currentBench.filter(function(p){
        if (apGkChange === "equal") return true;
        if (effectiveGkOutfield) {
          // Once the incoming 2nd-half GK has had their fair share of first-half
          // outfield time (whether they started on the bench and rotated in, or
          // started on the field and were rested above), don't let regular
          // rotation bring them back on again before halftime.
          if (!isPostHT && p.id === secondHalfGkId && (projMins[p.id]||0) >= secondHalfGkPreHTTarget) return false;
          // Belt-and-suspenders for the "started on field" case: keep them on the
          // bench from their designated rest minute onward, even if rounding meant
          // projMins landed just under the target above.
          if (secondHalfGkRestMinute !== null && !isPostHT && winMin >= secondHalfGkRestMinute && p.id === secondHalfGkId) return false;
          return true;
        } else {
          // GK-default players can't fill outfield slots from the bench
          if (p.default_position === "GK") return false;
          return true;
        }
      });

      // Sort: field player with MOST accumulated time goes off
      // (shuffle first so ties between equally-played players resolve randomly)
      fieldEligible = shuffleArray(fieldEligible);
      fieldEligible.sort(function(a,b){
        var ma = (projMins[a]||0) + (winMin - (onField[a]||0));
        var mb = (projMins[b]||0) + (winMin - (onField[b]||0));
        return mb - ma;
      });

      // Sort: bench player with LEAST total time comes on (shuffle ties too)
      benchEligible = shuffleArray(benchEligible);
      benchEligible.sort(function(a,b){ return (projMins[a.id]||0) - (projMins[b.id]||0); });

      var count = 0;
      var idx   = 0;
      var remainingBench = benchEligible.slice();
      while (idx < fieldEligible.length && remainingBench.length > 0 && count < effectiveMaxPerWindow) {
        var offId = fieldEligible[idx];

        // Choose who comes on. "Equal" = pure fairness (least accumulated time).
        // "Preferred"/"Relaxed"/"Strict" weight this by how well-suited each bench
        // player is (their rating 0-10) for the position being vacated.
        var onPlayer;
        if (apPositions === "equal") {
          onPlayer = remainingBench[0];
        } else {
          var vacatedLabel = posLabelFor(fieldPos[offId]);
          if (!vacatedLabel) {
            onPlayer = remainingBench[0];
          } else {
            var baseAccum = projMins[remainingBench[0].id]||0;
            var minRatingFilter = apPositions==="strict" ? 8 : apPositions==="relaxed" ? 3 : 0;
            var tol = apPositions==="strict" ? Infinity : apPositions==="preferred" ? Math.max(2, swapThreshold/2) : Math.max(3, swapThreshold);
            var candidates = remainingBench.filter(function(p){
              var withinTol = ((projMins[p.id]||0) - baseAccum) <= tol;
              var meetsMin  = ratingFor(p, vacatedLabel) >= minRatingFilter;
              return withinTol && meetsMin;
            });
            if (candidates.length === 0) candidates = [remainingBench[0]];
            candidates.sort(function(a,b){
              var rd = ratingFor(b, vacatedLabel) - ratingFor(a, vacatedLabel);
              if (rd !== 0) return rd;
              return (projMins[a.id]||0) - (projMins[b.id]||0);
            });
            onPlayer = candidates[0];
          }
        }

        if (useTimeFairnessSim) {
          var offAccum = (projMins[offId]||0) + (winMin - (onField[offId]||0));
          var onAccum  = (projMins[onPlayer.id]||0);
          // If the gap has already closed up, no point swapping here -- later pairs
          // (sorted the same way) will have an even smaller gap, so stop entirely.
          if (offAccum - onAccum < swapThreshold) break;
        }

        projMins[offId] = (projMins[offId]||0) + (winMin - (onField[offId]||0));
        delete onField[offId];
        subbedOff[offId] = true;

        onField[onPlayer.id] = winMin;
        fieldPos[onPlayer.id] = fieldPos[offId];
        delete fieldPos[offId];

        newSubs.push({ id:uid(), minute:winMin, playerOffId:offId, playerOnId:onPlayer.id, done:false });
        remainingBench = remainingBench.filter(function(p){ return p.id !== onPlayer.id; });
        count++;
        idx++;
      }
    });

    newSubs.sort(function(a,b){ return a.minute - b.minute; });
    setPlanSubs(newSubs);
    setAutoPlanOpen(false);
  }

  // Swap a player through the entire plan (replace playerA with playerB in all subs)
  // Also swaps their pitch positions if either is currently on the field
  function swapPlayerInPlan(playerAId, playerBId) {
    // Swap in planSubs
    setPlanSubs(function(prev) {
      return prev.map(function(sub) {
        var newSub = Object.assign({}, sub);
        if (newSub.playerOffId === playerAId) newSub.playerOffId = playerBId;
        else if (newSub.playerOffId === playerBId) newSub.playerOffId = playerAId;
        if (newSub.playerOnId === playerAId) newSub.playerOnId = playerBId;
        else if (newSub.playerOnId === playerBId) newSub.playerOnId = playerAId;
        return newSub;
      });
    });

    // Swap pitch positions in pitchState
    var psA = pitchState[playerAId];
    var psB = pitchState[playerBId];
    var posA = psA && psA.pitchPos ? psA.pitchPos : null;
    var posB = psB && psB.pitchPos ? psB.pitchPos : null;

    if (posA !== posB) {
      setPitchState(function(prev) {
        var next = Object.assign({}, prev);
        // Swap positions between A and B
        next[playerAId] = Object.assign({}, prev[playerAId] || {pitchSecs:0,positionTimes:{},stints:[]}, { pitchPos: posB });
        next[playerBId] = Object.assign({}, prev[playerBId] || {pitchSecs:0,positionTimes:{},stints:[]}, { pitchPos: posA });
        return next;
      });
    }

    setSwapModal(null);
  }

  // Simulate squad state at a given minute by applying all pending planned subs <= targetMin.
  // Correctly handles chains: if a player was manually subbed on outside the plan,
  // they cannot be subbed on again by a planned sub at a later minute.
  function simulateAt(targetMin, unavailableIds) {
    var unavSet = unavailableIds !== undefined ? unavailableIds : unavailable;

    // Start from the real current pitch state
    var pitchSet = new Set();
    var benchSet = new Set();
    // Track which players have already been "used" as the ON player in any sub
    // (either already on pitch or processed through the simulation)
    // This prevents the same player going on twice
    var everOnPitch = new Set(); // players who have been on pitch at any point

    dbPlayers.forEach(function(p) {
      if (pitchState[p.id] && pitchState[p.id].pitchPos) {
        pitchSet.add(p.id);
        everOnPitch.add(p.id);
      } else if (!unavSet.has(p.id)) {
        benchSet.add(p.id);
      }
    });

    // Also add players who were already used as "ON" in done subs
    // (they went on the pitch at some point, so they can't go on again)
    planSubs.filter(function(s){ return s.done; }).forEach(function(s) {
      everOnPitch.add(s.playerOnId);
      // If they're currently on bench (subbed back off after being on), they CAN go on again
      // but only if they're actually on the bench now -- pitchState is the ground truth
      if (!pitchState[s.playerOnId] || !pitchState[s.playerOnId].pitchPos) {
        // They went on but are now off -- they can be on bench
        // (everOnPitch tracks career, but bench availability is separate)
      }
    });

    var sorted = planSubs.filter(function(s){ return !s.done; }).slice().sort(function(a,b){ return a.minute - b.minute; });

    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      if (s.minute > targetMin) break;

      // Position swaps (two on-pitch players trade spots) don't change who's on the
      // pitch vs bench -- skip them here. Their validity (both still on pitch at the
      // time) is checked separately when rendering the plan list.
      if (s.isSwap) continue;

      // A sub is valid only if:
      // 1. The OFF player is currently on pitch
      // 2. The ON player is currently on bench (not on pitch, not unavailable)
      // 3. The ON player hasn't already been put on pitch by a previous unplanned action
      //    (i.e. they're not in pitchSet due to a manual swap that bypassed the plan)
      var onPlayerCurrentlyOnPitch = pitchSet.has(s.playerOnId);
      if (pitchSet.has(s.playerOffId) && benchSet.has(s.playerOnId) && !onPlayerCurrentlyOnPitch) {
        pitchSet.delete(s.playerOffId);
        benchSet.add(s.playerOffId);
        pitchSet.add(s.playerOnId);
        benchSet.delete(s.playerOnId);
        everOnPitch.add(s.playerOnId);
      }
      // If the sub can't happen (conflict), leave state as-is so later subs
      // still see the correct current positions
    }

    return { pitchSet: pitchSet, benchSet: benchSet };
  }

  // Derived
  var onPitch = dbPlayers.filter(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos;});
  var onBench  = dbPlayers.filter(function(p){return !pitchState[p.id]||!pitchState[p.id].pitchPos;});
  var livePosns = positions.map(function(p){ return (posEdit&&posEdit.posId===p.id)?Object.assign({},p,{x:posEdit.draftX,y:posEdit.draftY}):p; });
  var seasonTotals = querySeasonTotals(seasonFilter);
  var uniqueSeasons = Array.from(new Set(histMatches.map(function(m){return m.match_date&&m.match_date.slice(0,4);}).filter(Boolean))).sort().reverse();

  // Build slot history for match page - only after match starts
  var matchSlotHistory = (function() {
    var history = {};

    // Only show history layers once match has started
    if (matchSecs > 0) {
      // Seed from completed stints in pitchState
      dbPlayers.forEach(function(p) {
        var ps = pitchState[p.id];
        if (!ps) return;
        ps.stints.forEach(function(stint) {
          var posId = stint.position_id;
          if (!posId) return;
          if (!history[posId]) history[posId] = [];
          history[posId].push({ playerId: p.id, fromSec: stint.start_second, toSec: stint.end_second, planned: false });
        });
        if (ps.pitchPos) {
          var posId = ps.pitchPos;
          if (!history[posId]) history[posId] = [];
          var hasOpen = history[posId].some(function(e){ return e.playerId===p.id && e.toSec===null && !e.planned; });
          if (!hasOpen) {
            history[posId].push({ playerId: p.id, fromSec: ps.stints.length > 0 ? ps.stints[ps.stints.length-1].start_second : 0, toSec: null, planned: false });
          }
        }
      });
    }

    // Always add planned subs as ghost entries (even before match starts)
    var simPitch = {};
    var simBench = {};
    onPitch.forEach(function(p){ simPitch[pitchState[p.id].pitchPos] = p.id; });
    onBench.forEach(function(p){ simBench[p.id] = true; });

    var sorted = planSubs.filter(function(s){ return !s.done; }).slice().sort(function(a,b){ return a.minute-b.minute; });
    sorted.forEach(function(sub) {
      var posId = null;
      Object.keys(simPitch).forEach(function(pid) { if (simPitch[pid] === sub.playerOffId) posId = pid; });
      if (!posId) return;
      if (!simBench[sub.playerOnId]) return;
      if (!history[posId]) history[posId] = [];
      history[posId].push({ playerId: sub.playerOnId, fromSec: sub.minute * 60, toSec: null, planned: true });
      simPitch[posId] = sub.playerOnId;
      simBench[sub.playerOffId] = true;
      delete simBench[sub.playerOnId];
    });

    Object.keys(history).forEach(function(posId) {
      history[posId].sort(function(a,b){ return a.fromSec - b.fromSec; });
    });
    return history;
  })();

  // Auto-suggest: for a conflicted sub, find the best available bench player
  // targeting equal pitch minutes, never suggesting the GK position off player
  function suggestReplacement(sub) {
    var stateBeforeSub = simulateAt(sub.minute - 1);
    var availableBench = dbPlayers.filter(function(p) {
      if (!stateBeforeSub.benchSet.has(p.id)) return false;
      if (p.id === sub.playerOffId) return false;
      // Don't suggest someone already committed as ON in another pending sub at same minute
      var usedElsewhere = planSubs.some(function(s) {
        return !s.done && s.id !== sub.id && s.minute === sub.minute && s.playerOnId === p.id;
      });
      return !usedElsewhere;
    });

    if (availableBench.length === 0) return null;

    // Calculate total minutes each bench player has played so far
    function totalMins(pid) {
      var ps = pitchState[pid];
      if (!ps) return 0;
      return Math.floor(ps.pitchSecs / 60);
    }

    // Pick player with fewest total minutes (most "rested")
    var best = availableBench[0];
    var bestMins = totalMins(best.id);
    for (var i = 1; i < availableBench.length; i++) {
      var m = totalMins(availableBench[i].id);
      if (m < bestMins) { bestMins = m; best = availableBench[i]; }
    }
    return best;
  }

  return (
    <div style={{ background:"#0f172a", minHeight:"100vh", fontFamily:"system-ui, sans-serif", color:"#f8fafc" }}>

      {/* Header */}
      <div style={{ background:"#1e293b", borderBottom:"1px solid #334155", padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", zIndex:200 }}>
        <div style={{ position:"relative" }}>
          <button onClick={function(){ setTeamSwitcherOpen(function(v){return !v;}); }}
            style={{ display:"flex", alignItems:"center", gap:10, background:"none", border:"none", cursor:"pointer", padding:"2px 6px 2px 2px", borderRadius:8, fontFamily:"inherit" }}
            onMouseEnter={function(e){e.currentTarget.style.background="#273548";}} onMouseLeave={function(e){e.currentTarget.style.background="none";}}>
            <div style={{ width:32, height:32, borderRadius:8, background:"#1D9E75", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>O</div>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontWeight:700, fontSize:15, color:"#f1f5f9", display:"flex", alignItems:"center", gap:5 }}>{team.name} <span style={{ fontSize:9, color:"#64748b" }}>{teamSwitcherOpen?"^":"v"}</span></div>
              <div style={{ fontSize:9, color:isSetup?"#f59e0b":running?"#34d399":"#64748b" }}>{isSetup?"SETUP":running?"LIVE":"PAUSED"} - {team.season}</div>
            </div>
          </button>

          {teamSwitcherOpen && (
            <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", top:"100%", left:0, marginTop:6, background:"#1e293b", border:"1px solid #334155", borderRadius:10, boxShadow:"0 12px 36px rgba(0,0,0,0.6)", minWidth:220, zIndex:300, overflow:"hidden" }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", padding:"8px 12px 4px" }}>Cached teams on this device</div>
              {teamsRegistry.map(function(t){
                var isActive = t.id === activeTeamId;
                return (
                  <div key={t.id} style={{ display:"flex", alignItems:"center" }}>
                    <button onClick={function(){switchToTeam(t.id);}} style={{ flex:1, textAlign:"left", padding:"8px 12px", border:"none", background:isActive?"rgba(29,158,117,0.15)":"transparent", color:isActive?"#34d399":"#e2e8f0", fontSize:12, fontWeight:isActive?700:500, cursor:"pointer", fontFamily:"inherit" }}>
                      {t.name}{isActive?" (current)":""}
                    </button>
                    {!isActive && (
                      <button onClick={function(){ if(window.confirm('Delete all cached data for "'+t.name+'"? This cannot be undone.')) deleteTeam(t.id); }}
                        title="Delete this team's cached data"
                        style={{ padding:"8px 10px", border:"none", background:"transparent", color:"#475569", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>X</button>
                    )}
                  </div>
                );
              })}
              <div style={{ borderTop:"1px solid #334155", padding:8, display:"flex", gap:6 }}>
                <input value={newTeamName} onChange={function(e){setNewTeamName(e.target.value);}} placeholder="New team name"
                  onKeyDown={function(e){ if(e.key==="Enter" && newTeamName.trim()) createNewTeam(newTeamName); }}
                  style={{ flex:1, ...S.inp, fontSize:11 }} />
                <button onClick={function(){ if(newTeamName.trim()) createNewTeam(newTeamName); }} style={{ padding:"6px 10px", borderRadius:6, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>+ New</button>
              </div>
              <div style={{ fontSize:9, color:"#475569", padding:"0 12px 8px" }}>Switching reloads the page and loads that team's own roster, plan, and history.</div>
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:3, alignItems:"center" }}>
          {["roster","plan","match","history","settings"].map(function(t){
            return <button key={t} onClick={function(){setTab(t);}} style={{ padding:"5px 10px", borderRadius:6, border:"none", fontSize:11, fontWeight:600, cursor:"pointer", textTransform:"capitalize", background:tab===t?"#1D9E75":"transparent", color:tab===t?"white":"#94a3b8", fontFamily:"inherit" }}>{t}</button>;
          })}
          <div style={{ width:1, height:20, background:"#334155", margin:"0 4px" }} />
          <button onClick={function(){setShowWB(function(w){return !w;});}} style={{ padding:"5px 10px", borderRadius:6, border:showWB?"1.5px solid #a78bfa":"1.5px solid #334155", fontSize:11, fontWeight:600, cursor:"pointer", background:showWB?"rgba(167,139,250,0.15)":"transparent", color:showWB?"#a78bfa":"#94a3b8", fontFamily:"inherit" }}>
            Board
          </button>
        </div>
      </div>

      {/* Click-away overlay for the team switcher dropdown */}
      {teamSwitcherOpen && (
        <div onClick={function(){setTeamSwitcherOpen(false);}} style={{ position:"fixed", inset:0, zIndex:199 }} />
      )}

      {/* Whiteboard overlay */}
      {showWB && (
        <Whiteboard
          matchSecs={matchSecs} running={running} score={score}
          pitchPlayers={onPitch.map(function(p){return {id:p.id,num:p.jersey_number,name:p.name,posId:pitchState[p.id].pitchPos};})}
          livePositions={livePosns}
          onClose={function(){setShowWB(false);}}
        />
      )}

      {/* ---- MATCH TAB ---- */}
      {tab==="match" && (
        <div style={{ display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" }}>
          {/* Pitch column */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"9px 7px 9px 11px", minWidth:0 }}>
            <div style={{ display:"flex", gap:5, marginBottom:6 }}>
              <input value={opponent} onChange={function(e){setOpponent(e.target.value);}} placeholder="Opponent" style={{ flex:1, ...S.inp, fontSize:11, padding:"5px 9px" }} />
              <input value={venue} onChange={function(e){setVenue(e.target.value);}} placeholder="Venue" style={{ flex:1, ...S.inp, fontSize:11, padding:"5px 9px" }} />
            </div>
            <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:7 }}>
              {/* Score bar */}
              <div style={{ display:"flex", alignItems:"center", gap:5, background:"#1e293b", borderRadius:9, padding:"6px 11px", flex:1, justifyContent:"center" }}>
                <button onClick={function(){setScore(function(s){return {home:Math.max(0,s.home-1),away:s.away};});}} style={S.btn}>-</button>
                <span style={{ fontSize:22, fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{score.home}</span>
                <span style={{ fontSize:10, color:"#64748b", padding:"0 3px" }}>{team.name||"Home"}</span>
                {/* Timer display - shows half time and full match time in second half */}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"0 5px" }}>
                  {currentHalf === 2 && halves >= 2 ? (
                    <div>
                      <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:"#1D9E75", fontVariantNumeric:"tabular-nums", textAlign:"center" }}>
                        {fmtTime(matchSecs)}
                      </div>
                      <div style={{ fontFamily:"monospace", fontSize:10, fontWeight:600, color:"#64748b", fontVariantNumeric:"tabular-nums", textAlign:"center" }}>
                        H2: {fmtTime(Math.max(0, matchSecs - halfStartSec))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:"#1D9E75", fontVariantNumeric:"tabular-nums" }}>
                      {fmtTime(matchSecs)}
                    </div>
                  )}
                  {matchLength > 0 && running && (
                    <div style={{ fontSize:8, color:"#475569", fontVariantNumeric:"tabular-nums" }}>
                      H{currentHalf} of {halves}
                    </div>
                  )}
                </div>
                <span style={{ fontSize:10, color:"#64748b", padding:"0 3px" }}>{opponent||"Away"}</span>
                <span style={{ fontSize:22, fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{score.away}</span>
                <button onClick={function(){setScore(function(s){return {home:s.home,away:Math.max(0,s.away-1)};});}} style={S.btn}>-</button>
              </div>

              {/* Goal buttons + timer controls stacked */}
              <button onClick={function(){
                var min = Math.floor(matchSecs/60);
                setScore(function(s){return {home:s.home+1,away:s.away};});
                setGoalScorerModal({team:"home",minute:min,second:matchSecs});
                setGoalScorerPlayer(""); setGoalScorerNum("");
              }} style={{ ...S.btn, ...S.grn, fontSize:10, alignSelf:"center" }}>+{(team.name||"H").slice(0,4)}</button>

              {/* Timer controls: Pause + End Half + End Match */}
              <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
                {/* Pause / Resume / Start */}
                <button onClick={function(){
                  if (atHalftime) {
                    // Starting second half: set matchSecs to halfLength so timer continues from there
                    setMatchSecs(halfLength * 60);
                    setHalfStartSec(halfLength * 60);
                    setCurrentHalf(2);
                    setAtHalftime(false);
                    setRunning(true);
                  } else {
                    setRunning(function(r){return !r;});
                  }
                }} style={{ padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:700, fontSize:11, background:running?"#ef4444":atHalftime?"#8b5cf6":"#1D9E75", color:"white", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  {running ? "Pause" : atHalftime ? "Start H2" : matchSecs > 0 ? "Resume" : "Start"}
                </button>

                {/* End Half -- only shown in final 5 mins of each half */}
                {(function(){
                  var halfEndSec = currentHalf * halfLength * 60;
                  var secsLeftInHalf = halfEndSec - matchSecs;
                  var showEndHalf = running && halves >= 2 && currentHalf < halves && secsLeftInHalf <= 5 * 60 && secsLeftInHalf >= -5 * 60;
                  if (!showEndHalf) return null;
                  return (
                    <button onClick={function(){
                      setRunning(false);
                      setAtHalftime(true);
                      // Don't change matchSecs - just pause it; second half will snap to halfLength
                    }} style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #8b5cf6", background:"rgba(139,92,246,0.12)", color:"#a78bfa", fontWeight:700, fontSize:10, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                      End Half
                    </button>
                  );
                })()}

                {/* End Match -- only shown in final 5 mins of last half */}
                {(function(){
                  var matchEndSec = matchLength * 60;
                  var secsLeft = matchEndSec - matchSecs;
                  var showEndMatch = running && currentHalf === halves && secsLeft <= 5 * 60 && secsLeft >= -5 * 60;
                  if (!showEndMatch) return null;
                  return (
                    <button onClick={function(){
                      setRunning(false);
                    }} style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #ef4444", background:"rgba(239,68,68,0.1)", color:"#f87171", fontWeight:700, fontSize:10, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                      End Match
                    </button>
                  );
                })()}
              </div>

              <button onClick={function(){
                var min = Math.floor(matchSecs/60);
                setScore(function(s){return {home:s.home,away:s.away+1};});
                setGoalScorerModal({team:"away",minute:min,second:matchSecs});
                setGoalScorerPlayer(""); setGoalScorerNum("");
              }} style={{ ...S.btn, ...S.grn, fontSize:10, alignSelf:"center" }}>+{(opponent||"A").slice(0,4)}</button>
            </div>

            {/* Pitch wrapper - enforces football pitch aspect ratio (68m x 105m ~ 0.648 wide:tall) */}
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", minHeight:0, overflow:"hidden" }}>
              <div style={{ position:"relative", aspectRatio:"68/105", maxHeight:"100%", maxWidth:"100%", width:"auto", height:"100%" }}>
            <div ref={pitchRef} onClick={function(){setPitchMenu(null);setSideMenu(null);if(!posEdit||!posEdit.dragging)setPosEdit(null);}}
              style={{ width:"100%", height:"100%", position:"relative", borderRadius:10, overflow:"visible", background:"linear-gradient(180deg,#166534 0%,#15803d 30%,#16a34a 50%,#15803d 70%,#166534 100%)", border:"2px solid "+(posEdit?"#f59e0b":"#14532d"), transition:"border-color 0.2s" }}>
              <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", borderRadius:9 }} viewBox="0 0 68 105" preserveAspectRatio="xMidYMid meet">
                {/* Pitch stripes */}
                {[0,1,2,3,4,5,6,7,8,9].map(function(i){return <rect key={i} x={0} y={i*10.5} width={68} height={5.25} fill="rgba(255,255,255,0.025)" />;}) }
                {/* Border */}
                <rect x={1} y={1} width={66} height={103} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.5} />
                {/* Halfway line */}
                <line x1={1} y1={52.5} x2={67} y2={52.5} stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
                {/* Centre circle radius 9.15m */}
                <circle cx={34} cy={52.5} r={9.15} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
                {/* Centre spot */}
                <circle cx={34} cy={52.5} r={0.4} fill="rgba(255,255,255,0.75)" />
                {/* Penalty spots */}
                <circle cx={34} cy={11} r={0.4} fill="rgba(255,255,255,0.6)" />
                <circle cx={34} cy={94} r={0.4} fill="rgba(255,255,255,0.6)" />
                {/* Penalty areas 40.32m wide x 16.5m deep */}
                <rect x={13.84} y={1} width={40.32} height={16.5} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.4} />
                <rect x={13.84} y={87.5} width={40.32} height={16.5} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.4} />
                {/* Goal areas 18.32m wide x 5.5m deep */}
                <rect x={24.84} y={1} width={18.32} height={5.5} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
                <rect x={24.84} y={98.5} width={18.32} height={5.5} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
                {/* Goals 7.32m wide */}
                <rect x={30.34} y={0} width={7.32} height={1} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
                <rect x={30.34} y={104} width={7.32} height={1} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
                {/* Penalty arcs - centred on penalty spot (34, 11) and (34, 94), r=9.15m, only portion outside penalty area shown */}
                <clipPath id="topArcClip"><rect x={0} y={17.5} width={68} height={87.5} /></clipPath>
                <clipPath id="botArcClip"><rect x={0} y={0} width={68} height={87.5} /></clipPath>
                <circle cx={34} cy={11} r={9.15} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} clipPath="url(#topArcClip)" />
                <circle cx={34} cy={94} r={9.15} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} clipPath="url(#botArcClip)" />
                {/* Corner arcs radius 1m */}
                <path d={"M 1 3 A 2 2 0 0 1 3 1"} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
                <path d={"M 65 1 A 2 2 0 0 1 67 3"} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
                <path d={"M 1 102 A 2 2 0 0 0 3 104"} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
                <path d={"M 65 104 A 2 2 0 0 0 67 102"} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
              </svg>

              {/* Position slots */}
              {livePosns.map(function(pos) {
                var occ = onPitch.find(function(p){return pitchState[p.id].pitchPos===pos.id;});
                var hi  = dropHi === pos.id;
                var isEd = posEdit && posEdit.posId === pos.id;
                return (
                  <div key={pos.id}
                    onDragOver={function(e){if(!isEd)slotDragOver(e,pos.id);}}
                    onDragLeave={function(){if(!isEd)slotDragLeave();}}
                    onDrop={function(e){if(!isEd)slotDrop(e,pos.id);}}
                    onClick={function(e){if(!occ)handleSlotClick(e,pos.id);else{e.stopPropagation();}}}
                    onMouseDown={function(e){if(isEd&&posEdit.menuOnly===false)startPosEditDrag(e,pos.id);}}
                    onTouchStart={function(e){if(isEd&&posEdit.menuOnly===false)startPosEditDrag(e,pos.id);}}
                    style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", width:occ?50:30, height:occ?50:30, borderRadius:"50%", background:isEd&&posEdit.dragging?"rgba(245,158,11,0.25)":hi?"rgba(52,211,153,0.2)":occ?"transparent":"rgba(255,255,255,0.07)", border:isEd?"2px solid "+(posEdit.dragging?"#f59e0b":"#fbbf24"):hi?"2px solid #34d399":occ?"none":"1.5px dashed rgba(255,255,255,0.22)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:"rgba(255,255,255,0.4)", pointerEvents:(occ&&!isEd)?"none":"auto", transition:"all 0.15s", zIndex:isEd?20:5, cursor:isEd&&posEdit.dragging?"grabbing":isEd?"grab":"pointer" }}>
                    {!occ && pos.label}
                  </div>
                );
              })}

              {/* Restore removed positions + Add new position - setup mode only */}
              {isSetup && (
                <div style={{ position:"absolute", bottom:6, right:6, zIndex:25, display:"flex", gap:5 }}>
                  {removedPositions.length > 0 && (
                    <button
                      onClick={function(e){
                        e.stopPropagation();
                        setPosEdit({ type:"restore" });
                      }}
                      style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.15)", color:"#34d399", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                      + Restore position ({removedPositions.length})
                    </button>
                  )}
                  <button
                    onClick={function(e){
                      e.stopPropagation();
                      setPosEdit({ type:"add" });
                    }}
                    style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #475569", background:"rgba(71,85,105,0.2)", color:"#cbd5e1", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                    + Add position
                  </button>
                </div>
              )}

              {/* Add position picker overlay */}
              {posEdit && posEdit.type === "add" && (
                <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", zIndex:40, borderRadius:9, display:"flex", alignItems:"flex-end", justifyContent:"flex-end", padding:10 }}>
                  <div onClick={function(e){e.stopPropagation();}} style={{ background:"#0f172a", border:"1px solid #475569", borderRadius:10, padding:10, minWidth:160, boxShadow:"0 8px 24px rgba(0,0,0,0.6)" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:"#cbd5e1", marginBottom:8 }}>Add position</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                      {POSITION_LABELS.filter(function(l){return l!=="GK";}).map(function(label){
                        return (
                          <button key={label} onClick={function(){ addCustomPosition(label); setPosEdit(null); }}
                            style={{ padding:"6px 8px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
                            onMouseEnter={function(e){e.currentTarget.style.background="#334155";}} onMouseLeave={function(e){e.currentTarget.style.background="#1e293b";}}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={function(){setPosEdit(null);}} style={{ marginTop:6, width:"100%", padding:"4px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Restore picker overlay */}
              {posEdit && posEdit.type === "restore" && (
                <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", zIndex:40, borderRadius:9, display:"flex", alignItems:"flex-end", justifyContent:"flex-end", padding:10 }}>
                  <div onClick={function(e){e.stopPropagation();}} style={{ background:"#0f172a", border:"1px solid #1D9E75", borderRadius:10, padding:10, minWidth:140, boxShadow:"0 8px 24px rgba(0,0,0,0.6)" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:"#34d399", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Restore position</div>
                    {removedPositions.map(function(pos){
                      return (
                        <button key={pos.id}
                          onClick={function(){
                            setPositions(function(prev){return prev.concat([pos]);});
                            setRemovedPositions(function(prev){return prev.filter(function(p){return p.id!==pos.id;});});
                            setPosEdit(null);
                          }}
                          style={{ display:"block", width:"100%", padding:"6px 8px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:11, fontWeight:600, cursor:"pointer", marginBottom:4, textAlign:"left", fontFamily:"inherit" }}
                          onMouseEnter={function(e){e.currentTarget.style.background="#334155";}}
                          onMouseLeave={function(e){e.currentTarget.style.background="#1e293b";}}>
                          {pos.label} ({pos.id})
                        </button>
                      );
                    })}
                    <button onClick={function(){setPosEdit(null);}} style={{ width:"100%", padding:"4px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", marginTop:2, fontFamily:"inherit" }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Players on pitch - with past/future ghost layers from slot history */}
              {livePosns.map(function(pos) {
                var entries = matchSlotHistory[pos.id];
                if (!entries || entries.length === 0) {
                  // No history yet for this slot - render normally if occupied
                  var occ = onPitch.find(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos===pos.id;});
                  if (!occ) return null;
                  return null; // will be handled below
                }

                var isEdP = posEdit && posEdit.posId === pos.id;
                return (
                  <div key={pos.id} style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", display:"flex", flexDirection:"column", alignItems:"center", zIndex:isEdP?21:10, userSelect:"none", WebkitUserSelect:"none" }}>
                    {entries.map(function(entry, idx) {
                      var p = dbPlayers.find(function(pl){ return pl.id === entry.playerId; });
                      if (!p) return null;
                      var isCurrent = entry.toSec === null && !entry.planned;
                      var isFuture  = entry.planned;
                      var isPast    = entry.toSec !== null && !entry.planned;
                      var opacity   = isCurrent ? 1 : 0.3;
                      var isOccupant = isCurrent; // only current player gets click handlers

                      return (
                        <div key={entry.playerId+"-"+entry.fromSec}
                          data-pitch-player={isCurrent ? p.id : undefined}
                          draggable={isCurrent && isSetup && !posEdit}
                          onDragStart={isCurrent ? function(e){if(!posEdit)pitchDragStart(e,p.id);} : undefined}
                          onDragOver={isCurrent ? function(e){if(!posEdit)pitchPlayerDragOver(e);} : undefined}
                          onDrop={isCurrent ? function(e){if(!posEdit)pitchPlayerDrop(e,p.id);} : undefined}
                          onTouchStart={isCurrent ? function(e){if(posEdit&&isEdP&&!posEdit.menuOnly){startPosEditDrag(e,posEdit.posId);return;}if(isSetup&&!posEdit)handleTouchStart(e,p.id,"pitch");} : undefined}
                          onClick={isCurrent ? function(e){if(posEdit){if(isEdP){e.stopPropagation();return;}setPosEdit(null);return;}handlePitchClick(e,p.id);} : undefined}
                          style={{ display:"flex", flexDirection:"column", alignItems:"center", opacity:opacity, transition:"opacity 0.2s", marginBottom: idx < entries.length-1 ? 1 : 0,
                            cursor: isCurrent ? (isEdP&&posEdit&&!posEdit.menuOnly?"grab":isSetup&&!posEdit?"grab":sideMenu?"pointer":"default") : "default" }}>
                          <div style={{ width:isCurrent?34:22, height:isCurrent?34:22, borderRadius:"50%",
                            background: isPast?"#374151" : isFuture?"#0F6E56" : isEdP?"#f59e0b":(sideMenu&&!isSetup)?"#f59e0b":"#1D9E75",
                            border:"2px "+(isFuture?"dashed":"solid")+" "+(isPast?"#4b5563":isFuture?"#1D9E75":isEdP?"#d97706":(sideMenu&&!isSetup)?"#d97706":"#0F6E56"),
                            display:"flex", alignItems:"center", justifyContent:"center",
                            color:"white", fontWeight:700, fontSize:isCurrent?12:8,
                            boxShadow:isCurrent?"0 2px 10px rgba(0,0,0,0.5)":"none", transition:"all 0.15s" }}>
                            {p.jersey_number}
                          </div>
                          <div style={{ marginTop:1, background:"rgba(0,0,0,"+(isCurrent?"0.78":"0.55")+")", color:"white", fontSize:isCurrent?9:7, fontWeight:600, padding:"1px 4px", borderRadius:3, whiteSpace:"nowrap", maxWidth:62, overflow:"hidden", textOverflow:"ellipsis" }}>
                            {isFuture && <span style={{ color:"#34d399", fontSize:6, marginRight:2 }}>{Math.floor(entry.fromSec/60)}&apos;</span>}
                            {p.name.split(" ")[0]}
                          </div>
                          {isCurrent && (
                            <div style={{ fontSize:8, color:"#a7f3d0", background:"rgba(0,0,0,0.6)", padding:"1px 4px", borderRadius:3, marginTop:1, fontVariantNumeric:"tabular-nums" }}>
                              {fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Players on pitch with NO slot history yet (first placement, no stints recorded) */}
              {onPitch.filter(function(p){
                var pos = livePosns.find(function(pos){return pos.id===pitchState[p.id].pitchPos;});
                if (!pos) return false;
                var entries = matchSlotHistory[pitchState[p.id].pitchPos];
                return !entries || entries.length === 0;
              }).map(function(p) {
                var pp = livePosns.find(function(pos){return pos.id===pitchState[p.id].pitchPos;});
                if(!pp) return null;
                var isEdP = posEdit && posEdit.posId === pitchState[p.id].pitchPos;
                return (
                  <div key={p.id} data-pitch-player={p.id}
                    draggable={isSetup&&!posEdit}
                    onDragStart={function(e){if(!posEdit)pitchDragStart(e,p.id);}}
                    onDragOver={function(e){if(!posEdit)pitchPlayerDragOver(e);}}
                    onDrop={function(e){if(!posEdit)pitchPlayerDrop(e,p.id);}}
                    onTouchStart={function(e){if(posEdit&&isEdP&&!posEdit.menuOnly){startPosEditDrag(e,posEdit.posId);return;}if(isSetup&&!posEdit)handleTouchStart(e,p.id,"pitch");}}
                    onClick={function(e){if(posEdit){if(isEdP){e.stopPropagation();return;}setPosEdit(null);return;}handlePitchClick(e,p.id);}}
                    style={{ position:"absolute", left:pp.x+"%", top:pp.y+"%", transform:"translate(-50%,-50%)", display:"flex", flexDirection:"column", alignItems:"center", cursor:isEdP&&posEdit&&!posEdit.menuOnly?"grab":isSetup&&!posEdit?"grab":sideMenu?"pointer":"default", zIndex:isEdP?21:10, userSelect:"none", WebkitUserSelect:"none" }}>
                    <div style={{ width:34, height:34, borderRadius:"50%", background:isEdP?"#f59e0b":(sideMenu&&!isSetup)?"#f59e0b":"#1D9E75", border:"3px solid "+(isEdP?"#d97706":(sideMenu&&!isSetup)?"#d97706":"#0F6E56"), display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:700, fontSize:12, boxShadow:"0 2px 10px rgba(0,0,0,0.5)", transition:"all 0.15s" }}>{p.jersey_number}</div>
                    <div style={{ marginTop:2, background:"rgba(0,0,0,0.78)", color:"white", fontSize:9, fontWeight:600, padding:"2px 5px", borderRadius:4, whiteSpace:"nowrap", maxWidth:62, overflow:"hidden", textOverflow:"ellipsis" }}>{p.name.split(" ")[0]}</div>
                    <div style={{ fontSize:8, color:"#a7f3d0", background:"rgba(0,0,0,0.6)", padding:"1px 4px", borderRadius:3, marginTop:1, fontVariantNumeric:"tabular-nums" }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                  </div>
                );
              })}

              {/* Position edit overlay */}
              {posEdit && (function() {
                var pos = livePosns.find(function(p){return p.id===posEdit.posId;});
                if (!pos) return null;
                var flipX = pos.x>65, flipY = pos.y>55;
                return (
                  <div>
                    <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.35)", zIndex:18, borderRadius:9 }} />
                    {posEdit.menuOnly !== false && (
                      <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate("+(flipX?"-110%":"8px")+","+(flipY?"calc(-100% - 8px)":"8px")+")", zIndex:50, background:"#0f172a", border:"1px solid #f59e0b", borderRadius:10, padding:8, minWidth:148, boxShadow:"0 8px 28px rgba(0,0,0,0.7)" }}>
                        <div style={{ fontSize:10, color:"#f59e0b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:7 }}>{pos.label} position</div>
                        <button onClick={function(e){e.stopPropagation();setPosEdit(function(prev){return Object.assign({},prev,{menuOnly:false});});}} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"7px 10px", borderRadius:7, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4, fontFamily:"inherit" }}>
                          + Drag to reposition
                        </button>
                        {isSetup && (
                          <button onClick={function(e){
                            e.stopPropagation();
                            setRemovedPositions(function(prev){return prev.concat([pos]);});
                            setPositions(function(prev){return prev.filter(function(p){return p.id!==pos.id;});});
                            var occupant = dbPlayers.find(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos===pos.id;});
                            if (occupant) sendToBench(occupant.id);
                            setPosEdit(null);
                          }} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"6px 10px", borderRadius:7, border:"1px solid #7f1d1d", background:"rgba(239,68,68,0.08)", color:"#f87171", fontSize:11, cursor:"pointer", fontFamily:"inherit", marginBottom:4 }}>
                            Remove position
                          </button>
                        )}
                        <button onClick={function(e){e.stopPropagation();var r=POSITIONS.map(function(p){return Object.assign({},p);});setPositions(r);LS.set("st_positions",r);setPosEdit(null);}} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"6px 10px", borderRadius:7, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                          Reset all positions
                        </button>
                        <button onClick={function(){setPosEdit(null);}} style={{ marginTop:2, width:"100%", padding:"4px", borderRadius:6, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                      </div>
                    )}
                    {posEdit.menuOnly === false && (
                      <div>
                        <div onMouseDown={function(e){startPosEditDrag(e,posEdit.posId);}} onTouchStart={function(e){startPosEditDrag(e,posEdit.posId);}} onClick={function(e){e.stopPropagation();}}
                          style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", width:56, height:56, borderRadius:"50%", border:"2.5px dashed #f59e0b", background:"rgba(245,158,11,0.15)", zIndex:50, cursor:posEdit.dragging?"grabbing":"grab", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <span style={{ fontSize:18, color:"#f59e0b" }}>+</span>
                        </div>
                        <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", left:Math.min(92,Math.max(8,pos.x))+"%", top:Math.min(94,Math.max(6,pos.y))+"%", transform:"translate("+(flipX?"calc(-100% - 12px)":"28px")+", -50%)", display:"flex", gap:6, zIndex:55 }}>
                          <button onClick={function(e){e.stopPropagation();confirmPosEdit();}} style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#16a34a", color:"white", fontSize:16, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", fontFamily:"inherit" }}>OK</button>
                          <button onClick={function(e){e.stopPropagation();setPosEdit(null);}} style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#dc2626", color:"white", fontSize:16, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", fontFamily:"inherit" }}>X</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Floating pitch player menu */}
              {pitchMenu && pitchMenu.x !== undefined && !posEdit && (
                <PitchMenu x={pitchMenu.x} y={pitchMenu.y} items={pitchMenu.items} onClose={function(){setPitchMenu(null);}} />
              )}
            </div>
            </div>
            </div>

            {/* Goal scorer modal */}
            {goalScorerModal && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:20, minWidth:280, maxWidth:360, boxShadow:"0 16px 48px rgba(0,0,0,0.7)" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#f8fafc", marginBottom:4 }}>
                    {goalScorerModal.team === "home" ? (team.name||"Home")+" goal" : (opponent||"Away")+" goal"} -- {goalScorerModal.minute}&apos;
                  </div>
                  <div style={{ fontSize:10, color:"#64748b", marginBottom:12 }}>Optionally record the scorer. Skip to dismiss.</div>

                  {goalScorerModal.team === "home" ? (
                    <div>
                      <label style={{ fontSize:10, color:"#94a3b8", display:"block", marginBottom:4 }}>Player who scored</label>
                      <select value={goalScorerPlayer} onChange={function(e){setGoalScorerPlayer(e.target.value);}} style={{ ...S.inp, width:"100%", marginBottom:12 }}>
                        <option value="">-- Unknown / skip --</option>
                        {dbPlayers.map(function(p){
                          return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;
                        })}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize:10, color:"#94a3b8", display:"block", marginBottom:4 }}>Scorer jersey number (optional)</label>
                      <input type="number" value={goalScorerNum} onChange={function(e){setGoalScorerNum(e.target.value);}} placeholder="e.g. 9" style={{ ...S.inp, width:"100%", marginBottom:12 }} />
                    </div>
                  )}

                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={function(){
                      var scorerLabel = "";
                      if (goalScorerModal.team === "home" && goalScorerPlayer) {
                        var pl = dbPlayers.find(function(p){return p.id===goalScorerPlayer;});
                        scorerLabel = pl ? pl.name+" (#"+pl.jersey_number+")" : "";
                      } else if (goalScorerModal.team === "away" && goalScorerNum) {
                        scorerLabel = "Jersey #"+goalScorerNum;
                      }
                      setGoalEvents(function(prev){return prev.concat([{ team:goalScorerModal.team, minute:goalScorerModal.minute, second:goalScorerModal.second, scorerId:goalScorerPlayer||null, scorerNum:goalScorerNum||null, scorerLabel:scorerLabel }]);});
                      setGoalScorerModal(null); setGoalScorerPlayer(""); setGoalScorerNum("");
                    }} style={{ flex:1, padding:"8px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      Save goal
                    </button>
                    <button onClick={function(){
                      // Save without scorer
                      setGoalEvents(function(prev){return prev.concat([{ team:goalScorerModal.team, minute:goalScorerModal.minute, second:goalScorerModal.second, scorerId:null, scorerNum:null, scorerLabel:"" }]);});
                      setGoalScorerModal(null); setGoalScorerPlayer(""); setGoalScorerNum("");
                    }} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Save / export bar */}
            <div style={{ display:"flex", gap:6, marginTop:7 }}>
              {!matchSaved
                ? <button onClick={saveMatch} disabled={matchSecs===0} style={{ flex:1, padding:"8px", borderRadius:8, border:"none", background:matchSecs>0?"#1D9E75":"#1e293b", color:matchSecs>0?"white":"#475569", fontWeight:700, fontSize:11, cursor:matchSecs>0?"pointer":"not-allowed", fontFamily:"inherit" }}>Save Match</button>
                : <div style={{ flex:1, padding:"8px", borderRadius:8, background:"#064e3b", color:"#34d399", fontWeight:700, fontSize:11, textAlign:"center" }}>Saved</div>
              }
              <button onClick={exportCSV}  style={{ ...S.btn, fontSize:10 }}>CSV</button>
              <button onClick={exportPDF}  style={{ ...S.btn, fontSize:10 }}>PDF</button>
              <button onClick={resetMatch} style={{ ...S.btn, fontSize:10, color:"#f87171" }}>New</button>
            </div>
          </div>

          {/* Bench panel - natural flow, space appears at bottom */}
          <div style={{ width:210, background:"#1e293b", borderLeft:"1px solid #334155", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {/* Fixed header */}
            <div style={{ padding:"7px 11px 5px", borderBottom:"1px solid #334155", flexShrink:0 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.07em" }}>Bench ({onBench.filter(function(p){return !unavailable.has(p.id);}).length})</div>
              <div style={{ fontSize:9, color:isSetup?"#f59e0b":"#64748b", marginTop:2 }}>{isSetup?"Drag to pitch or tap":"Tap to swap | X to mark unavailable"}</div>
            </div>

            {/* Scrollable content area - natural stack, spacer fills bottom */}
            <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column" }}>

              {/* Bench players */}
              <div style={{ padding:"4px 7px", flexShrink:0 }}>
                {onBench.filter(function(p){return !unavailable.has(p.id);}).length===0 && <div style={{ fontSize:11, color:"#475569", padding:"12px 6px", textAlign:"center" }}>All on pitch</div>}
                {onBench.filter(function(p){return !unavailable.has(p.id);}).map(function(p) {
                  return (
                    <div key={p.id}>
                      <div
                        draggable={true}
                        onDragStart={function(e){ benchDragStart(e,p.id); }}
                        onTouchStart={function(e){ handleTouchStart(e,p.id,"bench"); }}
                        onClick={function(){ handleBenchClick(p.id); }}
                        style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 7px", borderRadius:7,
                          background: sideMenu&&sideMenu.playerId===p.id?"rgba(16,185,129,0.07)":"transparent",
                          border:"1.5px solid "+(sideMenu&&sideMenu.playerId===p.id?"#1D9E75":"transparent"),
                          cursor: "grab",
                          marginBottom:2, transition:"all 0.12s", userSelect:"none", WebkitUserSelect:"none",
                        }}>
                        <div style={{ width:24, height:24, borderRadius:"50%",
                          background: "#374151",
                          border:"2px solid #4b5563",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color: "#d1d5db",
                          fontWeight:700, fontSize:9, flexShrink:0 }}>
                          {p.jersey_number}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:600,
                            color: "#f9fafb",
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize:9, color: "#6b7280" }}>
                            {p.default_position}
                          </div>
                        </div>
                        <button
                          onClick={function(e){ e.stopPropagation(); toggleUnavailable(p.id); setSideMenu(null); }}
                          title="Mark unavailable"
                          style={{ width:22, height:22, borderRadius:5, border:"1px solid #334155",
                            background: "transparent",
                            color: "#475569",
                            cursor:"pointer", fontSize:10, fontWeight:700,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            flexShrink:0, fontFamily:"inherit" }}>
                          X
                        </button>
                      </div>
                      {/* Placement / swap menu expands inline here */}
                      {sideMenu && sideMenu.playerId===p.id && (
                        <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:8, padding:6, marginBottom:6, marginLeft:2 }}>
                          <div style={{ fontSize:9, color:"#64748b", marginBottom:5, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{sideMenu.type==="bench-setup"?"Place at position":"Swap with"}</div>
                          {sideMenu.items.length===0 ? <div style={{ fontSize:11, color:"#475569" }}>No players on pitch</div>
                            : sideMenu.items.map(function(item,i){
                              return <button key={i} onClick={item.onClick} style={{ display:"block", width:"100%", textAlign:"left", padding:"5px 8px", borderRadius:5, border:"none", background:"transparent", color:"#cbd5e1", fontSize:11, fontWeight:500, cursor:"pointer", marginBottom:2, fontFamily:"inherit" }}
                                onMouseEnter={function(e){e.currentTarget.style.background="#1e293b";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
                                {item.label}
                              </button>;
                            })
                          }
                          <button onClick={function(){setSideMenu(null);}} style={{ marginTop:4, width:"100%", padding:"4px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Unavailable players - kept out of the draggable bench area entirely */}
                {onBench.filter(function(p){return unavailable.has(p.id);}).length > 0 && (
                  <div style={{ marginTop:8, paddingTop:6, borderTop:"1px solid #334155" }}>
                    <div style={{ fontSize:9, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>
                      Unavailable ({onBench.filter(function(p){return unavailable.has(p.id);}).length})
                    </div>
                    {onBench.filter(function(p){return unavailable.has(p.id);}).map(function(p) {
                      return (
                        <div key={p.id} style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 7px", borderRadius:7, background:"rgba(239,68,68,0.06)", border:"1.5px solid #7f1d1d", marginBottom:2, opacity:0.65 }}>
                          <div style={{ width:24, height:24, borderRadius:"50%", background:"#7f1d1d", border:"2px solid #ef4444", display:"flex", alignItems:"center", justifyContent:"center", color:"#fca5a5", fontWeight:700, fontSize:9, flexShrink:0 }}>
                            {p.jersey_number}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:"#ef4444", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:"line-through" }}>{p.name}</div>
                            <div style={{ fontSize:9, color:"#ef4444" }}>Unavailable</div>
                          </div>
                          <button onClick={function(){ toggleUnavailable(p.id); }} title="Mark available"
                            style={{ width:22, height:22, borderRadius:5, border:"1px solid #ef4444", background:"rgba(239,68,68,0.2)", color:"#ef4444", cursor:"pointer", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontFamily:"inherit" }}>
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* All players - accumulated time, on-pitch highlighted, bench greyed out */}
              <div style={{ borderTop:"1px solid #334155", padding:"5px 8px", flexShrink:0 }}>
                <div
                  onClick={function(){ setShowOnPitchList(function(v){return !v;}); }}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", marginBottom: showOnPitchList ? 4 : 0 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em" }}>Player Times ({dbPlayers.length})</div>
                  <span style={{ fontSize:9, color:"#475569" }}>{showOnPitchList ? "v" : ">"}</span>
                </div>
                {showOnPitchList && dbPlayers.slice().sort(function(a,b){
                  var secsA = (pitchState[a.id]&&pitchState[a.id].pitchSecs)||0;
                  var secsB = (pitchState[b.id]&&pitchState[b.id].pitchSecs)||0;
                  return secsB - secsA;
                }).map(function(p){
                  var isOnPitch = !!(pitchState[p.id] && pitchState[p.id].pitchPos);
                  var isUnavail = unavailable.has(p.id);
                  return (
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:5, padding:"2px 1px", opacity:isOnPitch?1:0.5 }}>
                      <div style={{ width:16, height:16, borderRadius:"50%", background:isOnPitch?"#1D9E75":"#374151", border:isOnPitch?"none":"1px solid #4b5563", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, fontWeight:700, color:isOnPitch?"white":"#9ca3af", flexShrink:0 }}>{p.jersey_number}</div>
                      <div style={{ fontSize:9, color:isOnPitch?"#94a3b8":"#64748b", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:isUnavail?"line-through":"none" }}>{p.name}{!isOnPitch && !isUnavail ? " (bench)" : isUnavail ? " (unavailable)" : ""}</div>
                      <div style={{ fontSize:8, color:isOnPitch?"#10b981":"#64748b", fontVariantNumeric:"tabular-nums" }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                    </div>
                  );
                })}
              </div>

              {/* Planned subs - directly below on-pitch */}
              {planSubs.length > 0 && (function() {
              // Pre-compute conflicts for all subs to decide whether to show auto-fix
              var sortedSubs = planSubs.slice().sort(function(a,b){return a.minute-b.minute;});
              var anyConflict = sortedSubs.some(function(sub) {
                if (sub.done) return false;
                var state = simulateAt(sub.minute - 1);
                return !state.benchSet.has(sub.playerOnId) || !state.pitchSet.has(sub.playerOffId);
              });

              function autoFixConflicts() {
                var updated = planSubs.slice();

                // Helper: compute projected pitch seconds for a player at a given minute
                // using a local plan snapshot - accounts for when they entered and when they'd leave
                function projectedSecs(pid, atMinute, localPlanSubs) {
                  var ps = pitchState[pid];
                  var secsAlready = ps ? ps.pitchSecs : 0;
                  // If currently on pitch, they'll accumulate more time up to atMinute
                  if (ps && ps.pitchPos) {
                    var addSecs = Math.max(0, atMinute * 60 - matchSecs);
                    // But check if a planned sub takes them off before atMinute
                    var subOff = localPlanSubs.find(function(s) {
                      return !s.done && s.playerOffId === pid && s.minute <= atMinute;
                    });
                    if (subOff) {
                      addSecs = Math.max(0, subOff.minute * 60 - matchSecs);
                    }
                    return secsAlready + addSecs;
                  }
                  // On bench currently - check if a planned sub brings them on before atMinute
                  var subOn = localPlanSubs.find(function(s) {
                    return !s.done && s.playerOnId === pid && s.minute <= atMinute;
                  });
                  if (subOn) {
                    return secsAlready + Math.max(0, (atMinute - subOn.minute) * 60);
                  }
                  return secsAlready;
                }

                // Up to 8 passes to handle chains
                for (var pass = 0; pass < 8; pass++) {
                  var changed = false;
                  var sorted2 = updated.slice().sort(function(a,b){return a.minute-b.minute;});

                  for (var i = 0; i < sorted2.length; i++) {
                    var sub = sorted2[i];
                    if (sub.done) continue;

                    // Local simulate using current updated plan
                    var localSim = (function(targetMin, localPlanSubs) {
                      var pitchSet2 = new Set();
                      var benchSet2 = new Set();
                      dbPlayers.forEach(function(p) {
                        if (pitchState[p.id] && pitchState[p.id].pitchPos) { pitchSet2.add(p.id); }
                        else if (!unavailable.has(p.id)) { benchSet2.add(p.id); }
                      });
                      var s2 = localPlanSubs.filter(function(s){return !s.done;}).slice().sort(function(a,b){return a.minute-b.minute;});
                      for (var j = 0; j < s2.length; j++) {
                        var ls = s2[j];
                        if (ls.minute > targetMin) break;
                        if (pitchSet2.has(ls.playerOffId) && benchSet2.has(ls.playerOnId) && !pitchSet2.has(ls.playerOnId)) {
                          pitchSet2.delete(ls.playerOffId); benchSet2.add(ls.playerOffId);
                          pitchSet2.add(ls.playerOnId);     benchSet2.delete(ls.playerOnId);
                        }
                      }
                      return { pitchSet: pitchSet2, benchSet: benchSet2 };
                    })(sub.minute - 1, updated);

                    var onConflict2  = !localSim.benchSet.has(sub.playerOnId);
                    var offConflict2 = !localSim.pitchSet.has(sub.playerOffId);

                    if (!onConflict2 && !offConflict2) continue;

                    // Fix OFF conflict: planned-off player is no longer on pitch
                    if (offConflict2) {
                      var usedAsOff = updated
                        .filter(function(s2){ return !s2.done && s2.id !== sub.id && s2.minute === sub.minute; })
                        .map(function(s2){ return s2.playerOffId; });

                      var availPitch = dbPlayers.filter(function(p) {
                        if (!localSim.pitchSet.has(p.id)) return false;
                        // Never sub off GK
                        if (p.default_position === "GK") return false;
                        if (pitchState[p.id] && pitchState[p.id].pitchPos === "GK") return false;
                        if (usedAsOff.indexOf(p.id) !== -1) return false;
                        return true;
                      });

                      if (availPitch.length > 0) {
                        // Most projected minutes at this sub's minute = most deserving a rest
                        availPitch.sort(function(a,b) {
                          return projectedSecs(b.id, sub.minute, updated) - projectedSecs(a.id, sub.minute, updated);
                        });
                        var bestOff = availPitch[0];
                        updated = updated.map(function(s2) {
                          return s2.id === sub.id ? Object.assign({},s2,{playerOffId: bestOff.id}) : s2;
                        });
                        sub = Object.assign({}, sub, {playerOffId: bestOff.id});
                        changed = true;
                        // Recheck ON conflict with updated sub
                        onConflict2 = !localSim.benchSet.has(sub.playerOnId);
                      }
                    }

                    // Fix ON conflict: planned-on player is no longer on bench
                    if (onConflict2) {
                      var usedAsOn = updated
                        .filter(function(s2){ return !s2.done && s2.id !== sub.id && s2.minute === sub.minute; })
                        .map(function(s2){ return s2.playerOnId; });

                      var availBench = dbPlayers.filter(function(p) {
                        if (!localSim.benchSet.has(p.id)) return false;
                        if (p.id === sub.playerOffId) return false;
                        if (usedAsOn.indexOf(p.id) !== -1) return false;
                        return true;
                      });

                      if (availBench.length > 0) {
                        // Fewest projected minutes = most rested
                        availBench.sort(function(a,b) {
                          return projectedSecs(a.id, sub.minute, updated) - projectedSecs(b.id, sub.minute, updated);
                        });
                        var bestOn = availBench[0];
                        updated = updated.map(function(s2) {
                          return s2.id === sub.id ? Object.assign({},s2,{playerOnId: bestOn.id}) : s2;
                        });
                        changed = true;
                      }
                      // If no bench players available, this conflict can't be auto-fixed
                      // The sub will remain conflicted and show the "Remove" option
                    }
                  }
                  if (!changed) break;
                }

                setPlanSubs(updated);
                setConflictPick(null);
              }

              return (
              <div style={{ borderTop:"1px solid #334155", padding:"5px 8px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: showPlanSubsList && anyConflict ? 4 : showPlanSubsList ? 4 : 0 }}>
                  <div
                    onClick={function(){ setShowPlanSubsList(function(v){return !v;}); }}
                    style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", cursor:"pointer", flex:1 }}>
                    Planned Subs ({planSubs.filter(function(s){return !s.done;}).length}) {showPlanSubsList ? "v" : ">"}
                  </div>
                </div>
                {showPlanSubsList && anyConflict && (
                  <button
                    onClick={autoFixConflicts}
                    style={{ width:"100%", padding:"6px 8px", borderRadius:7, border:"1px solid #f59e0b", background:"rgba(245,158,11,0.1)", color:"#f59e0b", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginBottom:6, textAlign:"left" }}>
                    Auto-fix conflicts -- equalise minutes, keep GK
                  </button>
                )}
                {showPlanSubsList && (
                <div style={{ overflowY:"auto" }}>
                  {planSubs.slice().sort(function(a,b){
                    // Pending first sorted by minute, done last sorted by minute
                    if (a.done !== b.done) return a.done ? 1 : -1;
                    return a.minute - b.minute;
                  }).map(function(sub) {
                    var pOff = dbPlayers.find(function(p){return p.id===sub.playerOffId;});
                    var pOn  = dbPlayers.find(function(p){return p.id===sub.playerOnId;});
                    if (!pOff || !pOn) return null;
                    var curMin = Math.floor(matchSecs/60);
                    var isDue  = !sub.done && curMin >= sub.minute;
                    var isPast = sub.done;
                    // Use simulated state just before this sub fires to check validity
                    var stateBeforeSub = simulateAt(sub.minute - 1);
                    var onConflict  = !sub.done && !stateBeforeSub.benchSet.has(sub.playerOnId);
                    var offConflict = !sub.done && !stateBeforeSub.pitchSet.has(sub.playerOffId);
                    var hasConflict = onConflict || offConflict;
                    var currentBench = dbPlayers.filter(function(p){
                      return stateBeforeSub.benchSet.has(p.id) && p.id !== sub.playerOffId;
                    });
                    return (
                      <div key={sub.id} style={{ borderRadius:7, marginBottom:4, border:"1px solid "+(isPast?"#334155":hasConflict?"#f59e0b":isDue?"#ef4444":"#1D9E75"), overflow:"hidden" }}>
                        <div
                          onClick={function(){
                            if (isPast || hasConflict) return;
                            swapPlayers(sub.playerOnId, sub.playerOffId);
                            setPlanSubs(function(prev){return prev.map(function(s){return s.id===sub.id?Object.assign({},s,{done:true}):s;});});
                          }}
                          style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 7px", cursor:isPast||hasConflict?"default":"pointer", background:isPast?"rgba(71,85,105,0.15)":hasConflict?"rgba(245,158,11,0.08)":isDue?"rgba(239,68,68,0.1)":"rgba(29,158,117,0.07)", opacity:isPast?0.5:1 }}>
                          {/* Minute */}
                          <div style={{ fontSize:10, fontWeight:800, color:isPast?"#475569":hasConflict?"#f59e0b":isDue?"#f87171":"#34d399", minWidth:20, fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{sub.minute}&apos;</div>
                          {/* Names */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:9, color:isPast?"#64748b":offConflict?"#f59e0b":"#f9fafb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              <span style={{ color:offConflict?"#f59e0b":"#f87171" }}>off </span>
                              {pOff.name.split(" ")[0]}{offConflict?" (!)":""}
                            </div>
                            <div style={{ fontSize:9, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              <span style={{ color:onConflict?"#f59e0b":"#34d399" }}>on </span>
                              {onConflict
                                ? <span style={{ color:"#f59e0b", fontWeight:700 }}>? (tap to fix)</span>
                                : <span style={{ color:isPast?"#64748b":"#f9fafb" }}>{pOn.name.split(" ")[0]}</span>
                              }
                            </div>
                          </div>
                          {/* Status */}
                          <div style={{ fontSize:9, fontWeight:700, color:isPast?"#475569":hasConflict?"#f59e0b":isDue?"#f87171":"#64748b", flexShrink:0 }}>
                            {isPast?"Done":hasConflict?"Fix":isDue?"Now!":""}
                          </div>
                        </div>
                        {/* Conflict reassignment picker inline in bench panel */}
                        {onConflict && conflictPick===sub.id && (
                          <div style={{ background:"#0f172a", borderTop:"1px solid #f59e0b", padding:"6px 8px" }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                              <div style={{ fontSize:9, color:"#f59e0b", fontWeight:700, textTransform:"uppercase" }}>Who comes on instead?</div>
                              {(function(){
                                var suggestion = suggestReplacement(sub);
                                if (!suggestion) return null;
                                return (
                                  <button
                                    onClick={function(){
                                      setPlanSubs(function(prev){return prev.map(function(s){return s.id===sub.id?Object.assign({},s,{playerOnId:suggestion.id}):s;});});
                                      setConflictPick(null);
                                    }}
                                    style={{ padding:"3px 7px", borderRadius:5, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.15)", color:"#34d399", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                    Suggest: #{suggestion.jersey_number} {suggestion.name.split(" ")[0]}
                                  </button>
                                );
                              })()}
                            </div>
                            {currentBench.length===0
                              ? <div style={{ fontSize:10, color:"#475569" }}>No bench players available.</div>
                              : currentBench.map(function(p){
                                var mins = Math.floor((pitchState[p.id]&&pitchState[p.id].pitchSecs||0)/60);
                                return (
                                  <button key={p.id}
                                    onClick={function(){
                                      setPlanSubs(function(prev){return prev.map(function(s){return s.id===sub.id?Object.assign({},s,{playerOnId:p.id}):s;});});
                                      setConflictPick(null);
                                    }}
                                    style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", textAlign:"left", padding:"4px 7px", borderRadius:5, border:"none", background:"transparent", color:"#cbd5e1", fontSize:10, cursor:"pointer", marginBottom:2, fontFamily:"inherit" }}
                                    onMouseEnter={function(e){e.currentTarget.style.background="#1e293b";}}
                                    onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
                                    <span>#{p.jersey_number} {p.name}</span>
                                    <span style={{ fontSize:9, color:"#64748b" }}>{mins}min played</span>
                                  </button>
                                );
                              })
                            }
                            <button onClick={function(){setConflictPick(null);}} style={{ marginTop:2, padding:"3px 7px", borderRadius:4, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                          </div>
                        )}
                        {/* Tap the ? row to open picker */}
                        {onConflict && conflictPick!==sub.id && (
                          <div style={{ display:"flex", borderTop:"1px solid #334155" }}>
                            <button
                              onClick={function(){setConflictPick(sub.id);}}
                              style={{ flex:1, padding:"4px 7px", border:"none", borderRight:"1px solid #334155", background:"rgba(245,158,11,0.07)", color:"#f59e0b", fontSize:9, fontWeight:700, cursor:"pointer", textAlign:"left", fontFamily:"inherit" }}>
                              Reassign
                            </button>
                            <button
                              onClick={function(){
                                setPlanSubs(function(prev){return prev.filter(function(s){return s.id!==sub.id;});});
                                setConflictPick(null);
                              }}
                              style={{ flex:1, padding:"4px 7px", border:"none", background:"rgba(239,68,68,0.07)", color:"#f87171", fontSize:9, fontWeight:700, cursor:"pointer", textAlign:"right", fontFamily:"inherit" }}>
                              Remove sub
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })()}

              {/* Spacer pushes content up, fills remaining space */}
              <div style={{ flex:1 }} />
            </div>{/* end scrollable flex column */}
          </div>
        </div>
      )}

      {/* ---- PLAN TAB ---- */}
      {tab==="plan" && (function(){

        // Compute available players for the form based on psMin
        var formMinute = parseInt(psMin);
        var hasMinute  = psMin !== "" && !isNaN(formMinute) && formMinute > 0;

        var simState   = hasMinute ? simulateAt(formMinute) : null;

        // Players already committed (either role) in other subs at the same minute
        var committedAtMinute = hasMinute
          ? planSubs
              .filter(function(s){ return !s.done && s.minute === formMinute; })
              .reduce(function(acc, s){ acc[s.playerOffId] = true; acc[s.playerOnId] = true; return acc; }, {})
          : {};

        // If minute entered: use simulated state; otherwise prompt to enter minute first
        var offPool, onPool, swapPool;
        if (simState) {
          // OFF: on pitch at this minute, not already committed at this minute
          offPool = dbPlayers.filter(function(p){
            return simState.pitchSet.has(p.id) && !committedAtMinute[p.id];
          });
          // ON: on bench at this minute, not the selected off player, not already
          // committed, and not currently marked unavailable.
          onPool = dbPlayers.filter(function(p){
            return simState.benchSet.has(p.id) && p.id !== psOff && !committedAtMinute[p.id] && !unavailable.has(p.id);
          });
          // Position-swap pool: anyone on the pitch at this minute, not already
          // committed elsewhere at this minute. Step 2 picks from the full pool;
          // Step 3 (below) excludes whichever player was picked in Step 2.
          swapPool = dbPlayers.filter(function(p){
            return simState.pitchSet.has(p.id) && !committedAtMinute[p.id];
          });
        } else {
          offPool = [];
          onPool  = [];
          swapPool = [];
        }

        // Build a slot map: for each positionId, the full ordered list of players
        // who occupy that slot over time (starter + all planned subs in/out).
        // slotHistory[posId] = [ { playerId, fromMin, toMin } ]
        function buildSlotHistory() {
          var history = {}; // posId -> [ { playerId, fromMin, toMin|null } ]
          // seed with starters
          dbPlayers.forEach(function(p) {
            var ps = pitchState[p.id];
            if (ps && ps.pitchPos) {
              if (!history[ps.pitchPos]) history[ps.pitchPos] = [];
              history[ps.pitchPos].push({ playerId: p.id, fromMin: 0, toMin: null });
            }
          });
          // apply each planned sub in order
          var sorted = planSubs.filter(function(s){return !s.done;}).slice().sort(function(a,b){return a.minute-b.minute;});
          sorted.forEach(function(sub) {
            if (sub.isSwap) {
              // Position swap: find each player's current slot and exchange them.
              var posA = null, posB = null;
              Object.keys(history).forEach(function(pid) {
                var arr = history[pid];
                if (arr.length > 0 && arr[arr.length-1].toMin === null) {
                  if (arr[arr.length-1].playerId === sub.playerOffId) posA = pid;
                  if (arr[arr.length-1].playerId === sub.playerOnId)  posB = pid;
                }
              });
              if (posA === null || posB === null || posA === posB) return;
              history[posA][history[posA].length-1].toMin = sub.minute;
              history[posB][history[posB].length-1].toMin = sub.minute;
              history[posA].push({ playerId: sub.playerOnId,  fromMin: sub.minute, toMin: null });
              history[posB].push({ playerId: sub.playerOffId, fromMin: sub.minute, toMin: null });
              return;
            }
            // Find which slot the off-player is currently in
            var posId = null;
            Object.keys(history).forEach(function(pid) {
              var arr = history[pid];
              if (arr.length > 0 && arr[arr.length-1].playerId === sub.playerOffId && arr[arr.length-1].toMin === null) {
                posId = pid;
              }
            });
            if (!posId) return;
            // Close the off-player's stint
            history[posId][history[posId].length-1].toMin = sub.minute;
            // Open the on-player's stint
            history[posId].push({ playerId: sub.playerOnId, fromMin: sub.minute, toMin: null });
          });
          return history;
        }

        var slotHistory = buildSlotHistory();
        var maxPlanMin  = planSubs.length > 0 ? Math.max.apply(null, planSubs.map(function(s){return s.minute;})) : 0;
        var timelineMax = Math.max(matchLength, maxPlanMin + 5);

        // Who is active at tlMin per slot?
        function activeAtTime(posId) {
          var arr = slotHistory[posId]; if (!arr || arr.length === 0) return null;
          for (var i = 0; i < arr.length; i++) {
            var e = arr[i];
            if (e.fromMin <= tlMin && (e.toMin === null || e.toMin > tlMin)) return e.playerId;
          }
          return arr[arr.length-1].playerId; // after all subs, show last
        }

        // Players on bench at tlMin (use simState at tlMin)
        var tlSimState = simulateAt(tlMin);
        var benchAtTime = dbPlayers.filter(function(p){ return tlSimState.benchSet.has(p.id); });

        return (
        <div style={{ display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" }}>

          {/* ---- LEFT: Interactive Pitch + bench + timeline ---- */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"10px 8px 10px 12px", minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#f8fafc", marginBottom:2 }}>
              {tlMin === 0 ? "Kickoff lineup" : "Lineup at "+tlMin+"'"}
            </div>
            <div style={{ fontSize:9, color:"#f59e0b", marginBottom:6 }}>Setup mode -- drag players onto pitch or tap to place. Click position markers to move or remove them.</div>

            {/* Pitch + bench row */}
            <div style={{ display:"flex", flex:1, minHeight:0, gap:8 }}>

              {/* Interactive pitch sharing pitchRef and all match-tab handlers */}
              <div style={{ display:"flex", justifyContent:"center", flex:1, minHeight:0 }}>
                <div style={{ position:"relative", aspectRatio:"68/105", maxHeight:"100%", maxWidth:"100%", width:"auto", height:"100%" }}>
                  <div ref={pitchRef} onClick={function(){setPitchMenu(null);setSideMenu(null);if(!posEdit||!posEdit.dragging)setPosEdit(null);}}
                    style={{ position:"absolute", inset:0, borderRadius:10, overflow:"visible", background:"linear-gradient(180deg,#166534 0%,#15803d 30%,#16a34a 50%,#15803d 70%,#166534 100%)", border:"2px solid "+(posEdit?"#f59e0b":"#14532d"), transition:"border-color 0.2s" }}>
                    <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", borderRadius:9 }} viewBox="0 0 68 105" preserveAspectRatio="xMidYMid meet">
                      <rect x={1} y={1} width={66} height={103} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.5} />
                      <line x1={1} y1={52.5} x2={67} y2={52.5} stroke="rgba(255,255,255,0.45)" strokeWidth={0.4} />
                      <circle cx={34} cy={52.5} r={9.15} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.4} />
                      <circle cx={34} cy={52.5} r={0.4} fill="rgba(255,255,255,0.7)" />
                      <circle cx={34} cy={11} r={0.4} fill="rgba(255,255,255,0.5)" />
                      <circle cx={34} cy={94} r={0.4} fill="rgba(255,255,255,0.5)" />
                      <rect x={13.84} y={1} width={40.32} height={16.5} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.4} />
                      <rect x={13.84} y={87.5} width={40.32} height={16.5} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.4} />
                      <rect x={24.84} y={1} width={18.32} height={5.5} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.35} />
                      <rect x={24.84} y={98.5} width={18.32} height={5.5} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.35} />
                      <clipPath id="tac2"><rect x={0} y={17.5} width={68} height={87.5} /></clipPath>
                      <clipPath id="bac2"><rect x={0} y={0} width={68} height={87.5} /></clipPath>
                      <circle cx={34} cy={11} r={9.15} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.35} clipPath="url(#tac2)" />
                      <circle cx={34} cy={94} r={9.15} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.35} clipPath="url(#bac2)" />
                    </svg>

                    {/* Position slots */}
                    {livePosns.map(function(pos) {
                      var occ = onPitch.find(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos===pos.id;});
                      var hi  = dropHi === pos.id;
                      var isEd = posEdit && posEdit.posId === pos.id;
                      // The pitch diagram is only directly editable at tlMin===0 (the
                      // kickoff lineup, i.e. the real pitchState). At any other minute
                      // it's a read-only PREVIEW of a simulated future lineup -- dragging
                      // there must not write to the real pitchState/current lineup.
                      var editable = tlMin === 0;
                      return (
                        <div key={pos.id}
                          onDragOver={function(e){if(!isEd && editable)slotDragOver(e,pos.id);}}
                          onDragLeave={function(){if(!isEd && editable)slotDragLeave();}}
                          onDrop={function(e){if(!isEd && editable)slotDrop(e,pos.id);}}
                          onClick={function(e){if(!editable){e.stopPropagation();return;}if(!occ)handleSlotClick(e,pos.id);else e.stopPropagation();}}
                          onMouseDown={function(e){if(isEd&&posEdit.menuOnly===false && editable)startPosEditDrag(e,pos.id);}}
                          onTouchStart={function(e){if(isEd&&posEdit.menuOnly===false && editable)startPosEditDrag(e,pos.id);}}
                          style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", width:occ?50:30, height:occ?50:30, borderRadius:"50%", background:isEd&&posEdit.dragging?"rgba(245,158,11,0.25)":hi?"rgba(52,211,153,0.2)":occ?"transparent":"rgba(255,255,255,0.07)", border:isEd?"2px solid "+(posEdit.dragging?"#f59e0b":"#fbbf24"):hi?"2px solid #34d399":occ?"none":"1.5px dashed rgba(255,255,255,0.22)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:"rgba(255,255,255,0.4)", pointerEvents:(occ&&!isEd)||!editable?"none":"auto", transition:"all 0.15s", zIndex:isEd?20:5, cursor:isEd&&posEdit.dragging?"grabbing":isEd?"grab":editable?"pointer":"default" }}>
                          {!occ && pos.label}
                        </div>
                      );
                    })}

                    {/* Restore removed positions + Add new position */}
                    <div style={{ position:"absolute", bottom:6, right:6, zIndex:25, display:"flex", gap:5 }}>
                      {removedPositions.length > 0 && (
                        <button onClick={function(e){e.stopPropagation();setPosEdit({type:"restore"});}} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.15)", color:"#34d399", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          + Restore ({removedPositions.length})
                        </button>
                      )}
                      <button onClick={function(e){e.stopPropagation();setPosEdit({type:"add"});}} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #475569", background:"rgba(71,85,105,0.2)", color:"#cbd5e1", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                        + Add position
                      </button>
                    </div>

                    {/* Add position picker overlay */}
                    {posEdit && posEdit.type === "add" && (
                      <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", zIndex:40, borderRadius:9, display:"flex", alignItems:"flex-end", justifyContent:"flex-end", padding:10 }}>
                        <div onClick={function(e){e.stopPropagation();}} style={{ background:"#0f172a", border:"1px solid #475569", borderRadius:10, padding:10, minWidth:160 }}>
                          <div style={{ fontSize:10, fontWeight:700, color:"#cbd5e1", marginBottom:8 }}>Add position</div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                            {POSITION_LABELS.filter(function(l){return l!=="GK";}).map(function(label){
                              return (
                                <button key={label} onClick={function(){ addCustomPosition(label); setPosEdit(null); }}
                                  style={{ padding:"6px 8px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
                                  onMouseEnter={function(e){e.currentTarget.style.background="#334155";}} onMouseLeave={function(e){e.currentTarget.style.background="#1e293b";}}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <button onClick={function(){setPosEdit(null);}} style={{ marginTop:6, width:"100%", padding:"4px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Restore picker overlay */}
                    {posEdit && posEdit.type === "restore" && (
                      <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", zIndex:40, borderRadius:9, display:"flex", alignItems:"flex-end", justifyContent:"flex-end", padding:10 }}>
                        <div onClick={function(e){e.stopPropagation();}} style={{ background:"#0f172a", border:"1px solid #1D9E75", borderRadius:10, padding:10, minWidth:140 }}>
                          <div style={{ fontSize:10, fontWeight:700, color:"#34d399", marginBottom:8 }}>Restore position</div>
                          {removedPositions.map(function(pos){
                            return (
                              <button key={pos.id} onClick={function(){setPositions(function(prev){return prev.concat([pos]);});setRemovedPositions(function(prev){return prev.filter(function(p){return p.id!==pos.id;});});setPosEdit(null);}}
                                style={{ display:"block", width:"100%", padding:"6px 8px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:11, fontWeight:600, cursor:"pointer", marginBottom:4, textAlign:"left", fontFamily:"inherit" }}
                                onMouseEnter={function(e){e.currentTarget.style.background="#334155";}} onMouseLeave={function(e){e.currentTarget.style.background="#1e293b";}}>
                                {pos.label} ({pos.id})
                              </button>
                            );
                          })}
                          <button onClick={function(){setPosEdit(null);}} style={{ width:"100%", padding:"4px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Player tokens - timeline ghost layers */}
                    {livePosns.map(function(pos) {
                      var arr = slotHistory[pos.id];
                      var occ = onPitch.find(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos===pos.id;});
                      if (!arr || arr.length === 0) {
                        if (!occ) return null;
                        arr = [{ playerId: occ.id, fromMin: 0, toMin: null, planned: false }];
                      }
                      var isEdP = posEdit && posEdit.posId === pos.id;
                      var activeId = activeAtTime(pos.id);
                      return (
                        <div key={pos.id} style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", display:"flex", flexDirection:"column", alignItems:"center", zIndex:isEdP?21:10, userSelect:"none", WebkitUserSelect:"none" }}>
                          {arr.map(function(entry, idx) {
                            var p = dbPlayers.find(function(pl){return pl.id===entry.playerId;});
                            if (!p) return null;
                            var isCurrent = tlMin === 0 ? (!entry.planned && entry.fromMin === 0) : (!entry.planned && tlMin >= entry.fromMin && (entry.toMin === null || tlMin < entry.toMin));
                            var isFuture = entry.planned;
                            var isPast   = !entry.planned && entry.toMin !== null && tlMin >= entry.toMin;
                            var opacity  = isCurrent ? 1 : 0.3;
                            // Only the kickoff lineup (tlMin===0) is the real, editable
                            // pitchState. At any other minute this is a read-only preview
                            // of a simulated future lineup.
                            var canEdit = isCurrent && tlMin === 0;
                            return (
                              <div key={entry.playerId+"-"+entry.fromMin}
                                data-pitch-player={canEdit ? p.id : undefined}
                                draggable={canEdit}
                                onDragStart={canEdit ? function(e){pitchDragStart(e,p.id);} : undefined}
                                onDragOver={canEdit ? function(e){pitchPlayerDragOver(e);} : undefined}
                                onDrop={canEdit ? function(e){pitchPlayerDrop(e,p.id);} : undefined}
                                onTouchStart={canEdit ? function(e){if(posEdit&&isEdP&&!posEdit.menuOnly){startPosEditDrag(e,posEdit.posId);return;}handleTouchStart(e,p.id,"pitch");} : undefined}
                                onClick={canEdit ? function(e){if(posEdit){if(isEdP){e.stopPropagation();return;}setPosEdit(null);return;}handlePitchClick(e,p.id);} : undefined}
                                style={{ display:"flex", flexDirection:"column", alignItems:"center", opacity:opacity, transition:"opacity 0.2s", marginBottom:idx<arr.length-1?1:0, cursor:canEdit?"grab":"default" }}>
                                <div style={{ width:isCurrent?34:22, height:isCurrent?34:22, borderRadius:"50%", background:isPast?"#374151":isFuture?"#0F6E56":"#1D9E75", border:"2px "+(isFuture?"dashed":"solid")+" "+(isPast?"#4b5563":isFuture?"#1D9E75":"#0F6E56"), display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:700, fontSize:isCurrent?12:8, boxShadow:isCurrent?"0 2px 10px rgba(0,0,0,0.5)":"none", transition:"all 0.15s" }}>
                                  {p.jersey_number}
                                </div>
                                <div style={{ marginTop:1, background:"rgba(0,0,0,"+(isCurrent?"0.78":"0.55")+")", color:"white", fontSize:isCurrent?9:7, fontWeight:600, padding:"1px 4px", borderRadius:3, whiteSpace:"nowrap", maxWidth:62, overflow:"hidden", textOverflow:"ellipsis" }}>
                                  {isFuture && <span style={{ color:"#34d399", fontSize:6, marginRight:2 }}>{entry.fromMin}&apos;</span>}
                                  {p.name.split(" ")[0]}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Position edit overlay */}
                    {posEdit && posEdit.posId && (function() {
                      var pos = livePosns.find(function(p){return p.id===posEdit.posId;});
                      if (!pos) return null;
                      var flipX = pos.x>65, flipY = pos.y>55;
                      return (
                        <div>
                          <div onClick={function(){setPosEdit(null);}} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.35)", zIndex:18, borderRadius:9 }} />
                          {posEdit.menuOnly !== false && (
                            <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate("+(flipX?"-110%":"8px")+","+(flipY?"calc(-100% - 8px)":"8px")+")", zIndex:50, background:"#0f172a", border:"1px solid #f59e0b", borderRadius:10, padding:8, minWidth:148, boxShadow:"0 8px 28px rgba(0,0,0,0.7)" }}>
                              <div style={{ fontSize:10, color:"#f59e0b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:7 }}>{pos.label}</div>
                              <button onClick={function(e){e.stopPropagation();setPosEdit(function(prev){return Object.assign({},prev,{menuOnly:false});});}} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"7px 10px", borderRadius:7, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4, fontFamily:"inherit" }}>
                                + Drag to reposition
                              </button>
                              <button onClick={function(e){e.stopPropagation();setRemovedPositions(function(prev){return prev.concat([pos]);});setPositions(function(prev){return prev.filter(function(p){return p.id!==pos.id;});});var occ=dbPlayers.find(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos===pos.id;});if(occ)sendToBench(occ.id);setPosEdit(null);}} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"6px 10px", borderRadius:7, border:"1px solid #7f1d1d", background:"rgba(239,68,68,0.08)", color:"#f87171", fontSize:11, cursor:"pointer", fontFamily:"inherit", marginBottom:4 }}>
                                Remove position
                              </button>
                              <button onClick={function(e){e.stopPropagation();var r=POSITIONS.map(function(p){return Object.assign({},p);});setPositions(r);LS.set("st_positions",r);setPosEdit(null);}} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", padding:"6px 10px", borderRadius:7, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                                Reset all positions
                              </button>
                              <button onClick={function(){setPosEdit(null);}} style={{ marginTop:2, width:"100%", padding:"4px", borderRadius:6, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                            </div>
                          )}
                          {posEdit.menuOnly === false && (
                            <div>
                              <div onMouseDown={function(e){startPosEditDrag(e,posEdit.posId);}} onTouchStart={function(e){startPosEditDrag(e,posEdit.posId);}} onClick={function(e){e.stopPropagation();}}
                                style={{ position:"absolute", left:pos.x+"%", top:pos.y+"%", transform:"translate(-50%,-50%)", width:56, height:56, borderRadius:"50%", border:"2.5px dashed #f59e0b", background:"rgba(245,158,11,0.15)", zIndex:50, cursor:posEdit.dragging?"grabbing":"grab", display:"flex", alignItems:"center", justifyContent:"center" }}>
                                <span style={{ fontSize:18, color:"#f59e0b" }}>+</span>
                              </div>
                              <div onClick={function(e){e.stopPropagation();}} style={{ position:"absolute", left:Math.min(92,Math.max(8,pos.x))+"%", top:Math.min(94,Math.max(6,pos.y))+"%", transform:"translate("+(flipX?"calc(-100% - 12px)":"28px")+", -50%)", display:"flex", gap:6, zIndex:55 }}>
                                <button onClick={function(e){e.stopPropagation();confirmPosEdit();}} style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#16a34a", color:"white", fontSize:16, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", fontFamily:"inherit" }}>OK</button>
                                <button onClick={function(e){e.stopPropagation();setPosEdit(null);}} style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#dc2626", color:"white", fontSize:16, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", fontFamily:"inherit" }}>X</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Floating player menu */}
                    {pitchMenu && pitchMenu.x !== undefined && !posEdit && (
                      <PitchMenu x={pitchMenu.x} y={pitchMenu.y} items={pitchMenu.items} onClose={function(){setPitchMenu(null);}} />
                    )}
                  </div>
                </div>
              </div>

              {/* Bench at current timeline position */}
              <div style={{ width:110, display:"flex", flexDirection:"column", flexShrink:0 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
                  Bench ({benchAtTime.filter(function(p){return !unavailable.has(p.id);}).length})
                </div>
                {tlMin !== 0 && (
                  <div style={{ fontSize:8, color:"#475569", marginBottom:6, lineHeight:1.4 }}>Preview only -- scrub to 0' to edit the starting lineup.</div>
                )}
                <div style={{ flex:1, overflowY:"auto" }}>
                  {benchAtTime.filter(function(p){return !unavailable.has(p.id);}).length === 0
                    ? <div style={{ fontSize:10, color:"#475569" }}>No bench players</div>
                    : benchAtTime.filter(function(p){return !unavailable.has(p.id);}).map(function(p) {
                        return (
                          <div key={p.id}
                            draggable={tlMin === 0}
                            onDragStart={tlMin === 0 ? function(e){benchDragStart(e,p.id);} : undefined}
                            onTouchStart={tlMin === 0 ? function(e){handleTouchStart(e,p.id,"bench");} : undefined}
                            onClick={tlMin === 0 ? function(){handleBenchClick(p.id);} : undefined}
                            style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 6px", borderRadius:7, background: sideMenu&&sideMenu.playerId===p.id?"rgba(16,185,129,0.07)":"#1e293b", border:"1px solid "+(sideMenu&&sideMenu.playerId===p.id?"#1D9E75":"#334155"), marginBottom:4, cursor:tlMin===0?"grab":"default", opacity:tlMin===0?1:0.6, userSelect:"none" }}>
                            <div style={{ width:24, height:24, borderRadius:"50%", background:"#374151", border:"2px solid #4b5563", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#d1d5db", flexShrink:0 }}>
                              {p.jersey_number}
                            </div>
                            <div style={{ minWidth:0 }}>
                              <div style={{ fontSize:10, fontWeight:600, color:"#f9fafb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name.split(" ")[0]}</div>
                              <div style={{ fontSize:8, color:"#6b7280" }}>{p.default_position}</div>
                            </div>
                          </div>
                        );
                      })
                  }
                  {/* Inline side menu for bench clicks in plan tab */}
                  {tlMin === 0 && sideMenu && (function(){
                    var sp = benchAtTime.find(function(p){return p.id===sideMenu.playerId;});
                    if (!sp) return null;
                    return (
                      <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:8, padding:6, marginBottom:6 }}>
                        <div style={{ fontSize:9, color:"#64748b", marginBottom:5, fontWeight:700, textTransform:"uppercase" }}>{sideMenu.type==="bench-setup"?"Place at":"Swap with"}</div>
                        {sideMenu.items.length===0 ? <div style={{ fontSize:10, color:"#475569" }}>None</div>
                          : sideMenu.items.map(function(item,i){
                            return <button key={i} onClick={item.onClick} style={{ display:"block", width:"100%", textAlign:"left", padding:"4px 6px", borderRadius:5, border:"none", background:"transparent", color:"#cbd5e1", fontSize:10, cursor:"pointer", marginBottom:2, fontFamily:"inherit" }}
                              onMouseEnter={function(e){e.currentTarget.style.background="#1e293b";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
                              {item.label}
                            </button>;
                          })
                        }
                        <button onClick={function(){setSideMenu(null);}} style={{ width:"100%", padding:"3px", borderRadius:4, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                      </div>
                    );
                  })()}
                </div>
              </div>

            </div>{/* end pitch + bench row */}
            <div style={{ padding:"8px 4px 2px" }}>
              <div style={{ position:"relative", height:28, marginBottom:4 }}>
                {planSubs.filter(function(s){return !s.done;}).map(function(sub){
                  var pct = (sub.minute / timelineMax) * 100;
                  return <div key={sub.id} style={{ position:"absolute", left:pct+"%", top:0, bottom:0, width:2, background:"#1D9E75", opacity:0.5, borderRadius:1, pointerEvents:"none" }} />;
                })}
                <input type="range" min={0} max={timelineMax} step={1} value={tlMin}
                  onChange={function(e){setTlMin(parseInt(e.target.value));}}
                  style={{ position:"absolute", inset:0, width:"100%", height:"100%", cursor:"pointer", accentColor:"#1D9E75" }}
                />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:9, color:"#64748b" }}>0&apos;</span>
                <span style={{ fontSize:9, color:"#64748b" }}>{timelineMax}&apos;</span>
              </div>
              {/* Event chips */}
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {planSubs.filter(function(s){return !s.done;}).sort(function(a,b){return a.minute-b.minute;}).map(function(sub){
                  var pOff = dbPlayers.find(function(p){return p.id===sub.playerOffId;});
                  var pOn  = dbPlayers.find(function(p){return p.id===sub.playerOnId;});
                  var isAt = tlMin >= sub.minute;
                  return (
                    <div key={sub.id} onClick={function(){setTlMin(sub.minute);}}
                      style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 7px", borderRadius:6, background:isAt?"rgba(29,158,117,0.15)":"rgba(255,255,255,0.04)", border:"1px solid "+(isAt?"#1D9E75":"#334155"), cursor:"pointer" }}>
                      <span style={{ fontSize:10, fontWeight:700, color:isAt?"#34d399":"#64748b", fontVariantNumeric:"tabular-nums" }}>{sub.minute}&apos;</span>
                      <span style={{ fontSize:9, color:"#f87171" }}>{pOff?pOff.name.split(" ")[0]:""}</span>
                      <span style={{ fontSize:8, color:"#475569" }}>off</span>
                      <span style={{ fontSize:9, color:"#34d399" }}>{pOn?pOn.name.split(" ")[0]:""}</span>
                      <span style={{ fontSize:8, color:"#475569" }}>on</span>
                    </div>
                  );
                })}
                {planSubs.filter(function(s){return !s.done;}).length === 0 && (
                  <span style={{ fontSize:10, color:"#475569" }}>Add subs to see them on the timeline.</span>
                )}
              </div>
            </div>
          </div>

          {/* ---- RIGHT: Add form + scheduled subs list ---- */}
          <div style={{ width:300, background:"#1e293b", borderLeft:"1px solid #334155", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {/* Panel header */}
            <div style={{ padding:"8px 12px 6px", borderBottom:"1px solid #334155", flexShrink:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#f8fafc" }}>Substitutions</div>
              <div style={{ fontSize:9, color:"#64748b", marginTop:1 }}>Plan, then drag the timeline to preview</div>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"10px 12px" }}>

            {/* Game settings */}
            <div style={{ background:"#0f172a", borderRadius:9, padding:10, border:"1px solid #334155", marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Game settings</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3, flex:1, minWidth:80 }}>
                  <label style={{ fontSize:10, color:"#64748b" }}>Halves</label>
                  <select value={halves} onChange={function(e){setHalves(parseInt(e.target.value));}}
                    style={{ ...S.inp, fontSize:11 }}>
                    <option value={1}>1 half</option>
                    <option value={2}>2 halves</option>
                    <option value={3}>3 periods</option>
                    <option value={4}>4 quarters</option>
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3, flex:1, minWidth:80 }}>
                  <label style={{ fontSize:10, color:"#64748b" }}>Mins per half</label>
                  <input type="number" min={1} max={60} value={halfLength}
                    onChange={function(e){setHalfLength(Math.max(1,parseInt(e.target.value)||45));}}
                    style={{ ...S.inp, fontSize:11 }} />
                </div>
              </div>
              <div style={{ fontSize:9, color:"#475569", marginTop:6 }}>
                Total: {matchLength} min | Timeline: 0 -- {timelineMax} min
              </div>
            </div>

            {/* Player availability for this plan */}
            <div style={{ background:"#0f172a", borderRadius:9, padding:10, border:"1px solid #334155", marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Player availability</div>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:7 }}>Mark players unavailable for this plan (late arrival, injury etc.)</div>
              {dbPlayers.map(function(p) {
                var isUnavail = unavailable.has(p.id);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 6px", borderRadius:6, marginBottom:3, background:isUnavail?"rgba(239,68,68,0.07)":"transparent", border:"1px solid "+(isUnavail?"#7f1d1d":"transparent") }}>
                    <div style={{ width:18, height:18, borderRadius:"50%", background:isUnavail?"#7f1d1d":"#374151", border:"1.5px solid "+(isUnavail?"#ef4444":"#4b5563"), display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, fontWeight:700, color:isUnavail?"#fca5a5":"#d1d5db", flexShrink:0 }}>{p.jersey_number}</div>
                    <div style={{ flex:1, fontSize:10, color:isUnavail?"#ef4444":"#f9fafb", textDecoration:isUnavail?"line-through":"none", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                    <button onClick={function(){ setUnavailable(function(prev){ var n=new Set(prev); if(n.has(p.id))n.delete(p.id); else n.add(p.id); return n; }); }}
                      style={{ width:20, height:20, borderRadius:4, border:"1px solid "+(isUnavail?"#ef4444":"#334155"), background:isUnavail?"rgba(239,68,68,0.2)":"transparent", color:isUnavail?"#ef4444":"#475569", cursor:"pointer", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontFamily:"inherit" }}>
                      {isUnavail ? "+" : "X"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Auto Plan */}
            <div style={{ background:"#0f172a", borderRadius:9, padding:10, border:"1px solid #334155", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: autoPlanOpen ? 10 : 0 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em" }}>Auto Plan</div>
                <div style={{ display:"flex", gap:6 }}>
                  {!autoPlanOpen && planSubs.length > 0 && (
                    <button onClick={function(){generateAutoPlan(true);}} title="Shuffle the starting lineup and try again" style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.12)", color:"#34d399", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                      Re-generate
                    </button>
                  )}
                  <button onClick={function(){setAutoPlanOpen(function(v){return !v;});}} style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #334155", background:autoPlanOpen?"#334155":"transparent", color:"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                    {autoPlanOpen ? "Hide" : "Configure"}
                  </button>
                </div>
              </div>
              {autoPlanOpen && (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {/* Players on field */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Players on field</label>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {[6,7,8,9,10,11,-1].map(function(n){
                        return <button key={n} onClick={function(){setApPlayerSize(n);}} style={{ padding:"3px 7px", borderRadius:5, border:"1px solid "+(apPlayerSize===n?"#1D9E75":"#334155"), background:apPlayerSize===n?"rgba(29,158,117,0.2)":"transparent", color:apPlayerSize===n?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>{n===-1?"Other":n+"v"+n}</button>;
                      })}
                    </div>
                    {apPlayerSize===-1 && <input type="number" value={apPlayerSizeCustom} onChange={function(e){setApPlayerSizeCustom(e.target.value);}} placeholder="Number of players" style={{ ...S.inp, fontSize:10, marginTop:4, width:"100%" }} />}
                  </div>

                  {/* Goalkeeper rotation */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Change goalkeeper</label>
                    <select value={apGkChange} onChange={function(e){setApGkChange(e.target.value);}} style={{ ...S.inp, fontSize:10, width:"100%" }}>
                      <option value="never">Never</option>
                      <option value="halftime-specified">Halftime - Specified</option>
                      <option value="halftime-random">Halftime - Random selection</option>
                      <option value="equal">Rotation</option>
                    </select>
                    {apGkChange==="halftime-specified" && (
                      <select value={apGkPick} onChange={function(e){setApGkPick(e.target.value);}} style={{ ...S.inp, fontSize:10, width:"100%", marginTop:4 }}>
                        <option value="">Select GK for 2nd half...</option>
                        {dbPlayers.filter(function(p){return !unavailable.has(p.id);}).map(function(p){return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;})}
                      </select>
                    )}
                    {apGkChange !== "equal" && apGkChange !== "never" && (
                      <div style={{ marginTop:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                          <span style={{ fontSize:9, color:"#64748b" }}>GK allowed as outfield</span>
                          <button onClick={function(){setInfoPopup({title:"GK allowed as outfield", body:"Lets a keeper rotate into outfield positions when not in goal, so they don't fall behind on total minutes."});}}
                            style={{ width:14, height:14, borderRadius:"50%", border:"1px solid #475569", background:"transparent", color:"#64748b", fontSize:8, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0, lineHeight:1, fontFamily:"inherit" }}>
                            ?
                          </button>
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={function(){setApGkOutfield(true);}} style={{ flex:1, padding:"5px", borderRadius:5, border:"1px solid "+(apGkOutfield?"#1D9E75":"#334155"), background:apGkOutfield?"rgba(29,158,117,0.2)":"transparent", color:apGkOutfield?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Yes</button>
                          <button onClick={function(){setApGkOutfield(false);}} style={{ flex:1, padding:"5px", borderRadius:5, border:"1px solid "+(!apGkOutfield?"#1D9E75":"#334155"), background:!apGkOutfield?"rgba(29,158,117,0.2)":"transparent", color:!apGkOutfield?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>No</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Player positions */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Player positions</label>
                    <select value={apPositions} onChange={function(e){setApPositions(e.target.value);}} style={{ ...S.inp, fontSize:10, width:"100%" }}>
                      <option value="equal">Equal (rotate all positions)</option>
                      <option value="relaxed">Relaxed (near preferred)</option>
                      <option value="preferred">Preferred (stay in default pos)</option>
                      <option value="strict">Strict (only default position)</option>
                    </select>
                  </div>

                  {/* Change windows */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Max change windows</label>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {[0,1,2,3,-1].map(function(n){
                        return <button key={n} onClick={function(){setApChangeWindows(n);}} style={{ padding:"3px 7px", borderRadius:5, border:"1px solid "+(apChangeWindows===n?"#1D9E75":"#334155"), background:apChangeWindows===n?"rgba(29,158,117,0.2)":"transparent", color:apChangeWindows===n?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>{n===0?"Unlimited":n===-1?"Other":n}</button>;
                      })}
                    </div>
                    {apChangeWindows===-1 && <input type="number" value={apChangeWindowsCustom} onChange={function(e){setApChangeWindowsCustom(e.target.value);}} placeholder="Number of windows" style={{ ...S.inp, fontSize:10, marginTop:4, width:"100%" }} />}
                    <div style={{ fontSize:8, color:"#475569", marginTop:3 }}>Fewer windows may be used if there aren't enough bench players to fill them (especially if "Can come back on" is No).</div>
                  </div>

                  {/* Change window times */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Change window times</label>
                    <select value={apWindowTime} onChange={function(e){setApWindowTime(e.target.value);}} style={{ ...S.inp, fontSize:10, width:"100%" }}>
                      <option value="any-free">Any (No restrictions)</option>
                      <option value="any">Any (Evenly distributed)</option>
                      <option value="every">Every X minutes</option>
                      <option value="specify">Specify times</option>
                    </select>
                    {apWindowTime==="every" && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                        <span style={{ fontSize:9, color:"#64748b" }}>Every</span>
                        <input type="number" value={apWindowTimeX} onChange={function(e){setApWindowTimeX(parseInt(e.target.value)||15);}} style={{ ...S.inp, fontSize:10, width:52 }} />
                        <span style={{ fontSize:9, color:"#64748b" }}>min</span>
                      </div>
                    )}
                    {apWindowTime==="specify" && (function(){
                      var count = apChangeWindows===0||apChangeWindows===-1 ? 3 : (apChangeWindows||3);
                      return (
                        <div style={{ marginTop:4 }}>
                          {Array.from({length:count}, function(_,i){
                            return (
                              <div key={i} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                                <span style={{ fontSize:9, color:"#64748b", minWidth:60 }}>Window {i+1}:</span>
                                <input type="number" value={apWindowTimes[i]||""} onChange={function(e){
                                  var arr = apWindowTimes.slice(); arr[i] = parseInt(e.target.value)||0; setApWindowTimes(arr);
                                }} placeholder={"min"} style={{ ...S.inp, fontSize:10, flex:1 }} />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Max subs per window */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Max subs per window</label>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {[0,1,2,3,-1].map(function(n){
                        return <button key={n} onClick={function(){setApMaxSubsPerWindow(n);}} style={{ padding:"3px 7px", borderRadius:5, border:"1px solid "+(apMaxSubsPerWindow===n?"#1D9E75":"#334155"), background:apMaxSubsPerWindow===n?"rgba(29,158,117,0.2)":"transparent", color:apMaxSubsPerWindow===n?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>{n===0?"Unlimited":n===-1?"Other":n}</button>;
                      })}
                    </div>
                    {apMaxSubsPerWindow===-1 && <input type="number" value={apMaxSubsCustom} onChange={function(e){setApMaxSubsCustom(e.target.value);}} placeholder="Max per window" style={{ ...S.inp, fontSize:10, marginTop:4, width:"100%" }} />}
                  </div>

                  {/* Can come back */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Can player come back on after being subbed off?</label>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={function(){setApCanComeBack(true);}} style={{ flex:1, padding:"5px", borderRadius:5, border:"1px solid "+(apCanComeBack?"#1D9E75":"#334155"), background:apCanComeBack?"rgba(29,158,117,0.2)":"transparent", color:apCanComeBack?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Yes</button>
                      <button onClick={function(){setApCanComeBack(false);}} style={{ flex:1, padding:"5px", borderRadius:5, border:"1px solid "+(apCanComeBack===false?"#1D9E75":"#334155"), background:apCanComeBack===false?"rgba(29,158,117,0.2)":"transparent", color:apCanComeBack===false?"#34d399":"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>No</button>
                    </div>
                  </div>

                  {/* Focus */}
                  <div>
                    <label style={{ fontSize:9, color:"#64748b", display:"block", marginBottom:3 }}>Focus point</label>
                    <select value={apFocus} onChange={function(e){setApFocus(e.target.value);}} style={{ ...S.inp, fontSize:10, width:"100%" }}>
                      <option value="none">None</option>
                      <option value="time">Time fairness (equal minutes)</option>
                      <option value="position">Position fairness (equal spread)</option>
                      <option value="preferred">Preferred positions</option>
                    </select>
                  </div>

                  {/* Generate / Re-generate */}
                  <div style={{ display:"flex", gap:6, marginTop:4 }}>
                    <button onClick={function(){generateAutoPlan(false);}} style={{ flex:1, padding:"9px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      Generate plan
                    </button>
                    <button onClick={function(){generateAutoPlan(true);}} title="Shuffle the starting lineup and try again" style={{ flex:1, padding:"9px", borderRadius:8, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.12)", color:"#34d399", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      Re-generate
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Add form - vertical for narrow panel */}
            <div style={{ background:"#0f172a", borderRadius:9, padding:10, border:"1px solid #334155", marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Add planned sub</div>

              {/* Mode toggle: normal substitution vs position swap (e.g. GK <-> defender) */}
              <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                <button onClick={function(){ setPsMode("sub");  setPsOff(""); setPsOn(""); }}
                  style={{ flex:1, padding:"7px 8px", borderRadius:7, border:psMode==="sub"?"1.5px solid #1D9E75":"1px solid #334155", background:psMode==="sub"?"rgba(29,158,117,0.15)":"transparent", color:psMode==="sub"?"#34d399":"#94a3b8", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  Substitution
                </button>
                <button onClick={function(){ setPsMode("swap"); setPsOff(""); setPsOn(""); }}
                  style={{ flex:1, padding:"7px 8px", borderRadius:7, border:psMode==="swap"?"1.5px solid #818cf8":"1px solid #334155", background:psMode==="swap"?"rgba(129,140,248,0.15)":"transparent", color:psMode==="swap"?"#a5b4fc":"#94a3b8", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  Position Swap
                </button>
              </div>
              {psMode==="swap" && (
                <div style={{ fontSize:9, color:"#64748b", marginBottom:8, lineHeight:1.4 }}>
                  Swap two players who are <b>both already on the pitch</b> (e.g. move your GK out to defence and bring a defender into goal at half-time). Neither player comes off -- they just trade positions.
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

              {/* Step 1 -- Minute */}
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <label style={{ fontSize:10, color:"#64748b" }}>Step 1 -- Minute</label>
                <input
                  type="number" min="1" max="120"
                  value={psMin}
                  onChange={function(e){ setPsMin(e.target.value); setPsOff(""); setPsOn(""); }}
                  placeholder="e.g. 45"
                  style={{ width:"100%", ...S.inp, border: hasMinute ? "1px solid #1D9E75" : "1px solid #334155" }}
                />
              </div>

              {psMode==="sub" ? (
              <div style={{ display:"contents" }}>
              {/* Step 2 -- Player OFF */}
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <label style={{ fontSize:10, color: hasMinute ? "#64748b" : "#475569" }}>
                  Step 2 -- Off {hasMinute ? "(at "+formMinute+"')" : ""}
                </label>
                <select
                  value={psOff}
                  disabled={!hasMinute}
                  onChange={function(e){ setPsOff(e.target.value); setPsOn(""); }}
                  style={{ ...S.inp, width:"100%", opacity: hasMinute ? 1 : 0.4 }}>
                  <option value="">{hasMinute ? (offPool.length > 0 ? "Select player..." : "No players on pitch") : "Enter minute first"}</option>
                  {offPool.map(function(p){ return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>; })}
                </select>
              </div>

              {/* Step 3 -- Player ON */}
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <label style={{ fontSize:10, color: psOff ? "#64748b" : "#475569" }}>
                  Step 3 -- On {hasMinute ? "(bench at "+formMinute+"')" : ""}
                </label>
                <select
                  value={psOn}
                  disabled={!hasMinute || !psOff}
                  onChange={function(e){ setPsOn(e.target.value); }}
                  style={{ ...S.inp, width:"100%", opacity: (hasMinute && psOff) ? 1 : 0.4 }}>
                  <option value="">{!hasMinute ? "Enter minute first" : !psOff ? "Select OFF player first" : onPool.length > 0 ? "Select player..." : "No bench players available"}</option>
                  {onPool.map(function(p){ return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>; })}
                </select>
              </div>
              </div>
              ) : (
              <div style={{ display:"contents" }}>
              {/* Step 2 -- Player A (on pitch) */}
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <label style={{ fontSize:10, color: hasMinute ? "#64748b" : "#475569" }}>
                  Step 2 -- Player A {hasMinute ? "(on pitch at "+formMinute+"')" : ""}
                </label>
                <select
                  value={psOff}
                  disabled={!hasMinute}
                  onChange={function(e){ setPsOff(e.target.value); setPsOn(""); }}
                  style={{ ...S.inp, width:"100%", opacity: hasMinute ? 1 : 0.4 }}>
                  <option value="">{hasMinute ? (swapPool.length > 0 ? "Select player..." : "No players on pitch") : "Enter minute first"}</option>
                  {swapPool.map(function(p){ return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>; })}
                </select>
              </div>

              {/* Step 3 -- Player B (on pitch, swaps with Player A) */}
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <label style={{ fontSize:10, color: psOff ? "#64748b" : "#475569" }}>
                  Step 3 -- Player B {hasMinute ? "(swaps places with Player A)" : ""}
                </label>
                <select
                  value={psOn}
                  disabled={!hasMinute || !psOff}
                  onChange={function(e){ setPsOn(e.target.value); }}
                  style={{ ...S.inp, width:"100%", opacity: (hasMinute && psOff) ? 1 : 0.4 }}>
                  <option value="">{!hasMinute ? "Enter minute first" : !psOff ? "Select Player A first" : "Select player..."}</option>
                  {swapPool.filter(function(p){return p.id!==psOff;}).map(function(p){ return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>; })}
                </select>
              </div>
              </div>
              )}

              <button
                onClick={function(){
                  if (!psMin || !psOff || !psOn || psOff===psOn) return;
                  setPlanSubs(function(prev){return prev.concat([{ id:uid(), minute:formMinute, playerOffId:psOff, playerOnId:psOn, isSwap: psMode==="swap", done:false }]);});
                  setPsOff(""); setPsOn("");
                  // Keep minute so user can quickly add another sub at the same time
                }}
                disabled={!psMin || !psOff || !psOn}
                style={{ padding:"8px", borderRadius:8, border:"none", background:(!psMin||!psOff||!psOn)?"#334155":psMode==="swap"?"#818cf8":"#1D9E75", color:(!psMin||!psOff||!psOn)?"#475569":"white", fontWeight:700, fontSize:12, cursor:(!psMin||!psOff||!psOn)?"not-allowed":"pointer", fontFamily:"inherit", width:"100%", transition:"all 0.15s" }}>
                {psMode==="swap" ? "<-> Add position swap" : "+ Add substitution"}
              </button>

              {/* Live hint */}
              {hasMinute && (
                <div style={{ padding:"6px 8px", borderRadius:6, background:"#1e293b", border:"1px solid #334155", fontSize:9, color:"#64748b" }}>
                  <span style={{ color:"#94a3b8", fontWeight:600 }}>At {formMinute}': </span>
                  <span style={{ color:"#1D9E75" }}>Pitch: </span>{dbPlayers.filter(function(p){return simState.pitchSet.has(p.id);}).map(function(p){return p.name.split(" ")[0];}).join(", ")||"none"}
                  {"  "}<span style={{ color:"#64748b" }}>Bench: </span>{dbPlayers.filter(function(p){return simState.benchSet.has(p.id);}).map(function(p){return p.name.split(" ")[0];}).join(", ")||"none"}
                </div>
              )}

              </div>
            </div>

          {/* Planned subs list */}
          <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
            Scheduled ({planSubs.length})
          </div>
          {planSubs.length === 0
            ? <div style={{ fontSize:11, color:"#475569", textAlign:"center", padding:"1rem 0" }}>No planned substitutions yet.</div>
            : (
              <div>
                {planSubs.slice().sort(function(a,b){return a.minute-b.minute;}).map(function(sub) {
                  var pOff = dbPlayers.find(function(p){return p.id===sub.playerOffId;});
                  var pOn  = dbPlayers.find(function(p){return p.id===sub.playerOnId;});
                  // Simulate state just before this sub fires to check validity
                  var stateBeforeSub = simulateAt(sub.minute - 1);
                  var onConflict, offConflict, currentBench;
                  if (sub.isSwap) {
                    // A position swap needs BOTH players on the pitch beforehand
                    offConflict = !sub.done && !stateBeforeSub.pitchSet.has(sub.playerOffId);
                    onConflict  = !sub.done && !stateBeforeSub.pitchSet.has(sub.playerOnId);
                    currentBench = [];
                  } else {
                    onConflict  = !sub.done && !stateBeforeSub.benchSet.has(sub.playerOnId);
                    offConflict = !sub.done && !stateBeforeSub.pitchSet.has(sub.playerOffId);
                    currentBench = dbPlayers.filter(function(p){
                      return stateBeforeSub.benchSet.has(p.id) && p.id !== sub.playerOffId && !unavailable.has(p.id);
                    });
                  }
                  var hasConflict = !sub.done && (onConflict || offConflict);
                  var accentColor = sub.isSwap ? "#818cf8" : "#1D9E75";
                  return (
                    <div key={sub.id} style={{ borderRadius:8, background:"#0f172a", marginBottom:5, border:"1px solid "+(sub.done?"#334155":hasConflict?"#f59e0b":accentColor), opacity:sub.done?0.5:1, overflow:"hidden" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px" }}>
                        {/* Minute badge */}
                        <div style={{ minWidth:38, height:38, borderRadius:8, background:sub.done?"#374151":hasConflict?"#92400e":accentColor, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <div style={{ fontSize:13, fontWeight:800, color:"white", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{sub.minute}</div>
                          <div style={{ fontSize:8, color:"rgba(255,255,255,0.7)" }}>min</div>
                        </div>
                        {/* Players */}
                        <div style={{ flex:1, minWidth:0 }}>
                          {sub.isSwap ? (
                            /* SWAP row - both players stay on, just trade positions */
                            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                              <span style={{ fontSize:8, fontWeight:800, color:"#a5b4fc", letterSpacing:"0.06em", padding:"2px 6px", borderRadius:4, background:"rgba(129,140,248,0.18)", border:"1px solid rgba(129,140,248,0.45)", flexShrink:0 }}>SWAP</span>
                              <span style={{ fontSize:11, fontWeight:600, color:offConflict?"#f59e0b":(sub.done?"#64748b":"#f1f5f9"), overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {pOff ? "#"+pOff.jersey_number+" "+pOff.name : "Unknown"}{offConflict?" -- not on pitch":""}
                              </span>
                              <span style={{ fontSize:13, color:"#818cf8", fontWeight:800, flexShrink:0 }}>{"<->"}</span>
                              <span style={{ fontSize:11, fontWeight:600, color:onConflict?"#f59e0b":(sub.done?"#64748b":"#f1f5f9"), overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {pOn ? "#"+pOn.jersey_number+" "+pOn.name : "Unknown"}{onConflict?" -- not on pitch":""}
                              </span>
                            </div>
                          ) : (
                          <div style={{ display:"contents" }}>
                          {/* OFF row */}
                          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                            <span style={{ fontSize:9, fontWeight:700, color:"#f87171", minWidth:26, flexShrink:0 }}>OFF</span>
                            {offConflict
                              ? <span style={{ fontSize:11, color:"#f59e0b", fontWeight:700 }}>
                                  {pOff ? "#"+pOff.jersey_number+" "+pOff.name : "?"} -- already off pitch
                                </span>
                              : <span style={{ fontSize:11, fontWeight:600, color:sub.done?"#64748b":"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {pOff ? "#"+pOff.jersey_number+" "+pOff.name : "Unknown"}
                                </span>
                            }
                          </div>
                          {/* ON row */}
                          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <span style={{ fontSize:9, fontWeight:700, color:"#34d399", minWidth:26, flexShrink:0 }}>ON</span>
                            {onConflict
                              ? <button
                                  onClick={function(){setConflictPick(conflictPick===sub.id?null:sub.id);}}
                                  style={{ display:"flex", alignItems:"center", gap:5, padding:"2px 8px", borderRadius:5, border:"1px solid #f59e0b", background:"rgba(245,158,11,0.1)", color:"#f59e0b", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  <span style={{ fontSize:14, fontWeight:900 }}>?</span>
                                  <span>{pOn ? pOn.name.split(" ")[0] : "Unknown"} -- now on pitch</span>
                                </button>
                              : <span style={{ fontSize:11, fontWeight:600, color:sub.done?"#64748b":"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {pOn ? "#"+pOn.jersey_number+" "+pOn.name : "Unknown"}
                                </span>
                            }
                          </div>
                          </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                          {sub.done
                            ? <span style={{ fontSize:10, color:"#475569", fontWeight:600 }}>Done</span>
                            : hasConflict
                              ? <span style={{ fontSize:10, color:"#f59e0b", fontWeight:600 }}>Conflict</span>
                              : <button onClick={function(){
                                  if (sub.isSwap) {
                                    swapPitchPos(sub.playerOffId, sub.playerOnId);
                                  } else {
                                    swapPlayers(sub.playerOnId, sub.playerOffId);
                                  }
                                  setPlanSubs(function(prev){return prev.map(function(s){return s.id===sub.id?Object.assign({},s,{done:true}):s;});});
                                  setTab("match");
                                }} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:accentColor, color:"white", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Apply now</button>
                          }
                          <button onClick={function(){ setSwapModal({ subId: sub.id, which: null }); }} style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Swap</button>
                          {!sub.done && (
                            <button onClick={function(){ setEditSubModal({ subId: sub.id, minute: sub.minute, playerOffId: sub.playerOffId, playerOnId: sub.playerOnId, isSwap: !!sub.isSwap }); }} style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Edit</button>
                          )}
                          <button onClick={function(){setPlanSubs(function(prev){return prev.filter(function(s){return s.id!==sub.id;});});setConflictPick(null);}} style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#f87171", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Remove</button>
                        </div>
                      </div>
                      {/* Conflict reassignment picker - expanded inline (substitutions only) */}
                      {!sub.isSwap && conflictPick===sub.id && onConflict && (
                        <div style={{ background:"#0f172a", borderTop:"1px solid #f59e0b", padding:"10px 14px" }}>
                          <div style={{ fontSize:10, color:"#f59e0b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                            Reassign -- who comes on instead?
                          </div>
                          {currentBench.length === 0
                            ? <div style={{ fontSize:11, color:"#475569" }}>No bench players available.</div>
                            : currentBench.map(function(p) {
                              return (
                                <button key={p.id}
                                  onClick={function(){
                                    setPlanSubs(function(prev){return prev.map(function(s){return s.id===sub.id?Object.assign({},s,{playerOnId:p.id}):s;});});
                                    setConflictPick(null);
                                  }}
                                  style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"6px 10px", borderRadius:6, border:"1px solid #334155", background:"#1e293b", color:"#f1f5f9", fontSize:11, fontWeight:500, cursor:"pointer", marginBottom:4, fontFamily:"inherit" }}
                                  onMouseEnter={function(e){e.currentTarget.style.background="#334155";}}
                                  onMouseLeave={function(e){e.currentTarget.style.background="#1e293b";}}>
                                  <div style={{ width:22, height:22, borderRadius:"50%", background:"#374151", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#d1d5db", flexShrink:0 }}>{p.jersey_number}</div>
                                  <span>{p.name}</span>
                                  <span style={{ fontSize:9, color:"#64748b" }}>{p.default_position}</span>
                                </button>
                              );
                            })
                          }
                          <button onClick={function(){setConflictPick(null);}} style={{ marginTop:2, padding:"4px 10px", borderRadius:5, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button onClick={function(){setPlanSubs([]);setConflictPick(null);}} style={{ marginTop:6, padding:"6px 10px", borderRadius:7, border:"1px solid #334155", background:"transparent", color:"#f87171", fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit", width:"100%" }}>Clear all</button>
              </div>
            )
          }

          {/* Estimated playing time breakdown */}
          {(function() {
            // Calculate estimated minutes for every player based on planned subs + matchLength
            // Walk through each player's stints in the plan
            var estMins = {}; // playerId -> minutes

            // Start: seed from current pitch setup
            var currentlyOn = {}; // playerId -> minuteTheyEnteredOrStart
            onPitch.forEach(function(p) { currentlyOn[p.id] = 0; });

            // Apply planned subs in order
            var sortedSubs = planSubs.filter(function(s){return !s.done;}).slice().sort(function(a,b){return a.minute-b.minute;});
            sortedSubs.forEach(function(sub) {
              if (sub.isSwap) return; // position swap -- doesn't change who's on the pitch
              // playerOff comes off at sub.minute
              if (currentlyOn[sub.playerOffId] !== undefined) {
                var onSince = currentlyOn[sub.playerOffId];
                estMins[sub.playerOffId] = (estMins[sub.playerOffId] || 0) + (sub.minute - onSince);
                delete currentlyOn[sub.playerOffId];
              }
              // playerOn enters at sub.minute (only if they're not already on)
              if (currentlyOn[sub.playerOnId] === undefined) {
                currentlyOn[sub.playerOnId] = sub.minute;
              }
            });

            // Everyone still on at end of match gets remaining time
            Object.keys(currentlyOn).forEach(function(pid) {
              estMins[pid] = (estMins[pid] || 0) + (matchLength - currentlyOn[pid]);
            });

            // Build sorted list - only players with estimated time or on pitch
            var allPlayers = dbPlayers.filter(function(p) {
              return estMins[p.id] || onPitch.find(function(op){return op.id===p.id;});
            }).slice().sort(function(a,b){
              return (estMins[b.id]||0) - (estMins[a.id]||0);
            });

            if (allPlayers.length === 0) return null;

            // Bar max = matchLength
            var maxMins = matchLength;

            return (
              <div style={{ marginTop:14, borderTop:"1px solid #334155", paddingTop:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                  Estimated minutes ({matchLength} min match)
                </div>
                {allPlayers.map(function(p) {
                  var mins = estMins[p.id] || 0;
                  var pct  = Math.min(100, Math.round((mins / maxMins) * 100));
                  var isOnPitch = !!onPitch.find(function(op){return op.id===p.id;});
                  // Colour coding: full game = green, partial = amber, not playing = grey
                  var barColor = mins >= matchLength ? "#1D9E75" : mins > 0 ? "#f59e0b" : "#374151";
                  return (
                    <div key={p.id} style={{ marginBottom:6 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0 }}>
                          <div style={{ width:16, height:16, borderRadius:"50%", background:isOnPitch?"#1D9E75":"#374151", border:"1px solid "+(isOnPitch?"#0F6E56":"#4b5563"), display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, fontWeight:700, color:"white", flexShrink:0 }}>
                            {p.jersey_number}
                          </div>
                          <span style={{ fontSize:10, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name.split(" ")[0]}</span>
                        </div>
                        <span style={{ fontSize:10, fontWeight:700, color:barColor, fontVariantNumeric:"tabular-nums", flexShrink:0, marginLeft:6 }}>
                          {mins}min
                        </span>
                      </div>
                      <div style={{ height:5, borderRadius:3, background:"#0f172a", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:pct+"%", background:barColor, borderRadius:3, transition:"width 0.3s" }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop:8, fontSize:9, color:"#475569", display:"flex", gap:10 }}>
                  <span><span style={{ color:"#1D9E75" }}>Full game</span> = {matchLength} min</span>
                  <span><span style={{ color:"#f59e0b" }}>Partial</span> = subbed</span>
                </div>
              </div>
            );
          })()}

            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:12, paddingTop:12, borderTop:"1px solid #334155" }}>
              <button onClick={exportPlanPDF} style={{ padding:"7px 12px", borderRadius:7, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6 }}>
                Export PDF
              </button>
            </div>

            </div>
          </div>

          {/* Edit a single scheduled sub - minute and/or players */}
          {editSubModal && (
            <div onClick={function(){setEditSubModal(null);}} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:440, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div onClick={function(e){e.stopPropagation();}} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:18, minWidth:280, maxWidth:360, boxShadow:"0 16px 48px rgba(0,0,0,0.7)" }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#f8fafc", marginBottom:12 }}>{editSubModal.isSwap ? "Edit position swap" : "Edit substitution"}</div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:10, color:"#94a3b8", display:"block", marginBottom:4 }}>Minute</label>
                  <input type="number" value={editSubModal.minute} min={0} max={matchLength}
                    onChange={function(e){ setEditSubModal(function(prev){return Object.assign({},prev,{minute: parseInt(e.target.value)||0});}); }}
                    style={{ ...S.inp, width:"100%" }} />
                </div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:10, color: editSubModal.isSwap?"#a5b4fc":"#f87171", display:"block", marginBottom:4 }}>{editSubModal.isSwap ? "Player A" : "OFF (coming off)"}</label>
                  <select value={editSubModal.playerOffId} onChange={function(e){ setEditSubModal(function(prev){return Object.assign({},prev,{playerOffId:e.target.value});}); }} style={{ ...S.inp, width:"100%" }}>
                    {dbPlayers.filter(function(p){return !unavailable.has(p.id);}).map(function(p){return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;})}
                  </select>
                </div>

                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:10, color: editSubModal.isSwap?"#a5b4fc":"#34d399", display:"block", marginBottom:4 }}>{editSubModal.isSwap ? "Player B (swaps with Player A)" : "ON (coming on)"}</label>
                  <select value={editSubModal.playerOnId} onChange={function(e){ setEditSubModal(function(prev){return Object.assign({},prev,{playerOnId:e.target.value});}); }} style={{ ...S.inp, width:"100%" }}>
                    {dbPlayers.filter(function(p){return !unavailable.has(p.id);}).map(function(p){return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;})}
                  </select>
                </div>

                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={function(){
                    setPlanSubs(function(prev){ return prev.map(function(s){
                      return s.id === editSubModal.subId
                        ? Object.assign({}, s, { minute: editSubModal.minute, playerOffId: editSubModal.playerOffId, playerOnId: editSubModal.playerOnId, isSwap: !!editSubModal.isSwap })
                        : s;
                    }); });
                    setEditSubModal(null);
                    setConflictPick(null);
                  }} style={{ flex:1, padding:"8px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    Save
                  </button>
                  <button onClick={function(){setEditSubModal(null);}} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Generic info popup - triggered by "?" help buttons */}
          {infoPopup && (
            <div onClick={function(){setInfoPopup(null);}} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:450, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div onClick={function(e){e.stopPropagation();}} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:18, maxWidth:320, boxShadow:"0 16px 48px rgba(0,0,0,0.7)" }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#f8fafc", marginBottom:8 }}>{infoPopup.title}</div>
                <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.5, marginBottom:14 }}>{infoPopup.body}</div>
                <button onClick={function(){setInfoPopup(null);}} style={{ width:"100%", padding:"8px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                  Got it
                </button>
              </div>
            </div>
          )}

          {/* Swap player modal - replaces a player throughout the entire plan */}
          {swapModal && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:20, minWidth:300, maxWidth:400, boxShadow:"0 16px 48px rgba(0,0,0,0.7)" }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#f8fafc", marginBottom:4 }}>Swap player in plan</div>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:14 }}>
                  Select two players to swap throughout the entire plan. All occurrences of each player will be exchanged.
                </div>

                {/* Player A */}
                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:10, color:"#94a3b8", display:"block", marginBottom:4 }}>Player A (will take Player B's slots)</label>
                  <select value={swapModal.playerA||""} onChange={function(e){setSwapModal(function(prev){return Object.assign({},prev,{playerA:e.target.value});});}} style={{ ...S.inp, width:"100%" }}>
                    <option value="">Select player...</option>
                    {dbPlayers.map(function(p){return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;})}
                  </select>
                </div>

                {/* Player B */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:10, color:"#94a3b8", display:"block", marginBottom:4 }}>Player B (will take Player A's slots)</label>
                  <select value={swapModal.playerB||""} onChange={function(e){setSwapModal(function(prev){return Object.assign({},prev,{playerB:e.target.value});});}} style={{ ...S.inp, width:"100%" }}>
                    <option value="">Select player...</option>
                    {dbPlayers.filter(function(p){return p.id!==(swapModal.playerA||"");}).map(function(p){return <option key={p.id} value={p.id}>#{p.jersey_number} {p.name}</option>;})}
                  </select>
                </div>

                {/* Preview of what will change */}
                {swapModal.playerA && swapModal.playerB && (function(){
                  var pa = dbPlayers.find(function(p){return p.id===swapModal.playerA;});
                  var pb = dbPlayers.find(function(p){return p.id===swapModal.playerB;});
                  var affected = planSubs.filter(function(s){return s.playerOffId===swapModal.playerA||s.playerOnId===swapModal.playerA||s.playerOffId===swapModal.playerB||s.playerOnId===swapModal.playerB;});
                  return (
                    <div style={{ background:"#0f172a", borderRadius:7, padding:8, marginBottom:12, fontSize:10, color:"#94a3b8" }}>
                      <div style={{ fontWeight:700, marginBottom:4 }}>Preview ({affected.length} sub(s) affected):</div>
                      {affected.map(function(s){
                        var offId = s.playerOffId===swapModal.playerA?swapModal.playerB:s.playerOffId===swapModal.playerB?swapModal.playerA:s.playerOffId;
                        var onId  = s.playerOnId ===swapModal.playerA?swapModal.playerB:s.playerOnId ===swapModal.playerB?swapModal.playerA:s.playerOnId;
                        var pOff2 = dbPlayers.find(function(p){return p.id===offId;});
                        var pOn2  = dbPlayers.find(function(p){return p.id===onId;});
                        return (
                          <div key={s.id} style={{ marginBottom:2 }}>
                            <span style={{ color:"#64748b", fontVariantNumeric:"tabular-nums" }}>{s.minute}' </span>
                            <span style={{ color:"#f87171" }}>{pOff2?pOff2.name.split(" ")[0]:"?"}</span>
                            <span style={{ color:"#475569" }}> off / </span>
                            <span style={{ color:"#34d399" }}>{pOn2?pOn2.name.split(" ")[0]:"?"}</span>
                            <span style={{ color:"#475569" }}> on</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div style={{ display:"flex", gap:8 }}>
                  <button
                    disabled={!swapModal.playerA || !swapModal.playerB}
                    onClick={function(){ swapPlayerInPlan(swapModal.playerA, swapModal.playerB); }}
                    style={{ flex:1, padding:"8px", borderRadius:8, border:"none", background:swapModal.playerA&&swapModal.playerB?"#1D9E75":"#334155", color:swapModal.playerA&&swapModal.playerB?"white":"#475569", fontWeight:700, fontSize:12, cursor:swapModal.playerA&&swapModal.playerB?"pointer":"not-allowed", fontFamily:"inherit" }}>
                    Swap players
                  </button>
                  <button onClick={function(){setSwapModal(null);}} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#94a3b8", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ---- ROSTER TAB ---- */}
      {tab==="roster" && (
        <div style={{ padding:16, maxWidth:600, margin:"0 auto" }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Team Settings</div>
          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155", marginBottom:18 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
              {[["Team name", teamName, setTeamName], ["Season", teamSeason, setTeamSeason], ["Coach", coachName, setCoachName]].map(function(row){
                return (
                  <div key={row[0]}>
                    <label style={{ fontSize:11, color:"#64748b", display:"block", marginBottom:3 }}>{row[0]}</label>
                    <input value={row[1]} onChange={function(e){row[2](e.target.value);}} style={{ width:"100%", ...S.inp }} />
                  </div>
                );
              })}
            </div>
            <button onClick={function(){var u=Object.assign({},team,{name:teamName,season:teamSeason,coach_name:coachName});setTeamState(u);LS.set("st_team",u);}} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Save</button>
          </div>

          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Squad Roster</div>
          <div style={{ display:"flex", gap:7, marginBottom:13, flexWrap:"wrap" }}>
            <input type="number" value={newNum} onChange={function(e){setNewNum(e.target.value);}} placeholder="#" style={{ width:52, ...S.inp }} />
            <input type="text" value={newName} onChange={function(e){setNewName(e.target.value);}} placeholder="Player name" style={{ flex:1, minWidth:110, ...S.inp }} />
            <select value={newPos} onChange={function(e){setNewPos(e.target.value);}} style={S.inp}>
              {["GK","DEF","MID","FWD"].map(function(p){return <option key={p}>{p}</option>;})}
            </select>
            <button onClick={function(){
              if(!newName.trim()||!newNum)return;
              var np={id:uid(),team_id:team.id,name:newName.trim(),jersey_number:parseInt(newNum),default_position:newPos,active:true};
              setDbPlayers(function(prev){return prev.concat([np]);});
              setPitchState(function(prev){var n=Object.assign({},prev);n[np.id]={pitchPos:null,pitchSecs:0,positionTimes:{},stints:[]};return n;});
              setNewName(""); setNewNum("");
            }} style={{ padding:"7px 12px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>+ Add</button>
          </div>
          {dbPlayers.map(function(p){
            var isOpen = editingPlayerId === p.id;
            return (
              <div key={p.id} style={{ borderRadius:8, background:"#1e293b", marginBottom:5, border:"1px solid "+(isOpen?"#1D9E75":"#334155"), overflow:"hidden" }}>
                <div onClick={function(){setEditingPlayerId(isOpen?null:p.id);}} style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 11px", cursor:"pointer" }}>
                  <div style={{ width:26, height:26, borderRadius:"50%", background:(pitchState[p.id]&&pitchState[p.id].pitchPos)?"#1D9E75":"#374151", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"white", flexShrink:0 }}>{p.jersey_number}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.name}</div>
                    <div style={{ fontSize:10, color:"#64748b" }}>{p.default_position} - {(pitchState[p.id]&&pitchState[p.id].pitchPos)?"On pitch ("+pitchState[p.id].pitchPos+")":"Bench"}</div>
                  </div>
                  <div style={{ fontSize:10, color:"#10b981", fontVariantNumeric:"tabular-nums" }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                  <span style={{ fontSize:10, color:"#475569", padding:"0 2px" }}>{isOpen?"v":">"}</span>
                  <button onClick={function(e){e.stopPropagation();setDbPlayers(function(prev){return prev.filter(function(x){return x.id!==p.id;});});setPitchState(function(prev){var n=Object.assign({},prev);delete n[p.id];return n;});}} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:14, padding:"0 3px", fontFamily:"inherit" }}>X</button>
                </div>
                {isOpen && (
                  <div style={{ padding:"4px 12px 12px 12px", borderTop:"1px solid #334155" }}>
                    <div style={{ fontSize:9, color:"#64748b", margin:"8px 0" }}>
                      Position ratings (0-10) -- used by Auto Plan's "Player positions" setting to decide who fills a vacated spot. Defaults to 5 everywhere.
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 14px" }}>
                      {POSITION_LABELS.map(function(label){
                        var val = ratingFor(p, label);
                        return (
                          <div key={label} style={{ display:"flex", alignItems:"center", gap:7 }}>
                            <span style={{ fontSize:10, color:label===p.default_position?"#34d399":"#94a3b8", fontWeight:label===p.default_position?700:500, width:26, flexShrink:0 }}>{label}</span>
                            <input type="range" min={0} max={10} step={1} value={val}
                              onChange={function(e){setRating(p.id, label, parseInt(e.target.value));}}
                              style={{ flex:1, accentColor:"#1D9E75" }} />
                            <span style={{ fontSize:10, color:"#f1f5f9", fontWeight:700, width:16, textAlign:"right", flexShrink:0, fontVariantNumeric:"tabular-nums" }}>{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- HISTORY TAB ---- */}
      {tab==="history" && (
        <div style={{ padding:16, maxWidth:760, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>Season History</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <label style={{ fontSize:11, color:"#64748b" }}>Season:</label>
              <select value={seasonFilter} onChange={function(e){setSeasonFilter(e.target.value);}} style={{ ...S.inp, fontSize:11, padding:"5px 9px" }}>
                {uniqueSeasons.length===0 ? <option>{new Date().getFullYear()}</option> : uniqueSeasons.map(function(s){return <option key={s}>{s}</option>;})}
              </select>
              <button onClick={exportSeasonCSV} style={{ ...S.btn, background:"#1D9E75", color:"white", border:"none", fontSize:10 }}>Export CSV</button>
            </div>
          </div>
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:7 }}>Matches</div>
            {histMatches.filter(function(m){return !seasonFilter||(m.match_date&&m.match_date.startsWith(seasonFilter));}).length===0
              ? <div style={{ fontSize:12, color:"#475569", padding:"1rem 0" }}>No matches saved yet. Complete a match and click Save.</div>
              : histMatches.filter(function(m){return !seasonFilter||(m.match_date&&m.match_date.startsWith(seasonFilter));}).slice().reverse().map(function(m){
                return (
                  <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:8, background:"#1e293b", marginBottom:5, border:"1px solid #334155" }}>
                    <div style={{ fontSize:11, color:"#64748b", minWidth:80 }}>{fmtDate(m.match_date)}</div>
                    <div style={{ flex:1 }}><div style={{ fontSize:12, fontWeight:600 }}>vs {m.opponent}</div>{m.venue&&<div style={{ fontSize:10, color:"#64748b" }}>{m.venue}</div>}</div>
                    <div style={{ fontSize:16, fontWeight:800, fontVariantNumeric:"tabular-nums", color:m.goals_for>m.goals_against?"#34d399":m.goals_for<m.goals_against?"#f87171":"#94a3b8" }}>{m.goals_for}-{m.goals_against}</div>
                    <div style={{ fontSize:10, color:"#64748b" }}>{fmtTime(m.duration_seconds)}</div>
                  </div>
                );
              })
            }
          </div>
          <div style={{ fontSize:11, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Player totals - {seasonFilter}</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
              <thead><tr style={{ background:"#1e293b" }}>
                <th style={S.th}>Player</th><th style={S.th}>#</th><th style={S.th}>Total</th>
                {POSITIONS.map(function(p){return <th key={p.id} style={S.th}>{p.label}</th>;})}
              </tr></thead>
              <tbody>
                {seasonTotals.slice().sort(function(a,b){return b.total-a.total;}).map(function(p,i){
                  return (
                    <tr key={p.id} style={{ background:i%2?"#1e293b":"#0f172a" }}>
                      <td style={S.td}>{p.name}</td>
                      <td style={S.td}>{p.jersey_number}</td>
                      <td style={{ ...S.td, color:"#10b981", fontWeight:700 }}>{fmtTime(p.total)}</td>
                      {POSITIONS.map(function(pos){return <td key={pos.id} style={{ ...S.td, color:p.byPos[pos.id]?"#93c5fd":"#334155" }}>{p.byPos[pos.id]?fmtTime(p.byPos[pos.id]):"-"}</td>;})}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- SETTINGS TAB ---- */}
      {tab==="settings" && (
        <div style={{ padding:16, maxWidth:480, margin:"0 auto" }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Settings</div>
          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155", marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Pitch layout</div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>Click any position marker on the pitch to reposition it.</div>
            <button onClick={function(){var r=POSITIONS.map(function(p){return Object.assign({},p);});setPositions(r);LS.set("st_positions",r);}} style={{ padding:"7px 13px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#f87171", fontWeight:700, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>Reset positions</button>
          </div>
          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155", marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:4 }}>Share setup code</div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:12 }}>
              Generate a compact code. Send it via any messaging app -- the other device pastes it below to load everything instantly.
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:8 }}>
                <button onClick={function(){
                  var p = buildPayload();
                  var compact = {
                    v:  p.v,
                    t:  p.team ? { n:p.team.name, s:p.team.season, c:p.team.coach_name } : null,
                    pl: (p.players||[]).map(function(pl){ return { i:pl.id, n:pl.name, j:pl.jersey_number, p:pl.default_position }; }),
                    ps: (p.positions||[]).map(function(pos){ return { i:pos.id, l:pos.label, x:Math.round(pos.x*10)/10, y:Math.round(pos.y*10)/10 }; }),
                    su: (p.planSubs||[]).filter(function(s){return !s.done;}).map(function(s){ return { i:s.id, m:s.minute, o:s.playerOffId, n:s.playerOnId }; }),
                    se: p.pitchSetup,
                    hl: halfLength,
                    ha: halves,
                  };
                  var json2 = JSON.stringify(compact); var code = base64UrlEncode(json2);
                  var url = window.location.origin + window.location.pathname + "#" + code;
                  setShareCode(code);
                  setShareUrl(url);
                  setCopyMsg("");
                }} style={{ padding:"7px 13px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
                  Generate link
                </button>
                {shareUrl && (
                  <button onClick={function(){
                    navigator.clipboard.writeText(shareUrl)
                      .then(function(){ setCopyMsg("Link copied!"); setTimeout(function(){ setCopyMsg(""); }, 2500); })
                      .catch(function(){ setCopyMsg("Use the link below"); });
                  }} style={{ padding:"7px 13px", borderRadius:8, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.15)", color:"#34d399", fontWeight:700, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
                    {copyMsg==="Link copied!" ? "Copied!" : "Copy link"}
                  </button>
                )}
                {shareUrl && (
                  <button onClick={function(){ setShareCode(""); setShareUrl(""); setCopyMsg(""); }} style={{ padding:"7px 10px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
                )}
              </div>
              {copyMsg && copyMsg !== "Link copied!" && <div style={{ fontSize:10, color:"#f59e0b", marginBottom:6 }}>{copyMsg}</div>}
              {shareUrl && (
                <div>
                  {/* Primary: clickable link */}
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:9, color:"#64748b", marginBottom:3, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Share link (click to open, or send directly)</div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                        style={{ flex:1, padding:"7px 10px", borderRadius:7, border:"1px solid #1D9E75", background:"rgba(29,158,117,0.08)", color:"#34d399", fontSize:9, fontFamily:"monospace", wordBreak:"break-all", textDecoration:"none", display:"block" }}>
                        {shareUrl}
                      </a>
                    </div>
                    <div style={{ fontSize:9, color:"#475569", marginTop:3 }}>
                      Send this link. The recipient just opens it -- everything loads automatically.
                    </div>
                  </div>
                  {/* Fallback: raw code */}
                  <details style={{ cursor:"pointer" }}>
                    <summary style={{ fontSize:9, color:"#475569", marginBottom:4, userSelect:"none" }}>
                      Backup: raw code (if link does not work)
                    </summary>
                    <div style={{ marginTop:6 }}>
                      <div style={{ display:"flex", gap:6, marginBottom:4 }}>
                        <button onClick={function(){
                          navigator.clipboard.writeText(shareCode)
                            .then(function(){ setCopyMsg("Code copied!"); setTimeout(function(){ setCopyMsg(""); }, 2000); })
                            .catch(function(){});
                        }} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #334155", background:"#334155", color:"#f1f5f9", fontWeight:600, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>
                          Copy code
                        </button>
                        {copyMsg==="Code copied!" && <span style={{ fontSize:10, color:"#34d399" }}>Copied!</span>}
                      </div>
                      <textarea readOnly value={shareCode} onClick={function(e){e.target.select();}}
                        style={{ width:"100%", height:60, padding:"7px 9px", borderRadius:7, border:"1px solid #334155", background:"#0f172a", color:"#94a3b8", fontSize:8, fontFamily:"monospace", resize:"none", outline:"none", wordBreak:"break-all" }} />
                      <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>{shareCode.length} chars. Paste into the Import box on another device.</div>
                    </div>
                  </details>
                </div>
              )}
            </div>
            <div style={{ borderTop:"1px solid #334155", paddingTop:14 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Import code</div>
              <textarea value={importCode} onChange={function(e){ setImportCode(e.target.value); setImportMsg(""); }}
                placeholder="Paste code here..."
                style={{ width:"100%", height:56, padding:"8px 10px", borderRadius:8, border:"1px solid #334155", background:"#0f172a", color:"#f1f5f9", fontSize:10, fontFamily:"monospace", resize:"none", outline:"none", marginBottom:8 }} />
              {importMsg && <div style={{ fontSize:11, color:importMsg.startsWith("Error")?"#f87171":"#34d399", marginBottom:8, fontWeight:600 }}>{importMsg}</div>}
              <button onClick={function(){
                var raw = importCode.trim(); if (!raw) return;
                var code = raw.includes("#") ? raw.split("#").pop() : raw;
                try {
                  var data = JSON.parse(decodeShareCode(code));
                  var payload;
                  if (data.pl) {
                    payload = {
                      v: data.v,
                      team: data.t ? { name:data.t.n, season:data.t.s, coach_name:data.t.c, id:uid(), created_at:new Date().toISOString() } : null,
                      players: (data.pl||[]).map(function(pl){ return { id:pl.i, name:pl.n, jersey_number:pl.j, default_position:pl.p, active:true, team_id:"" }; }),
                      positions: (data.ps||[]).map(function(pos){ return { id:pos.i, label:pos.l, x:pos.x, y:pos.y }; }),
                      planSubs: (data.su||[]).map(function(s){ return { id:s.i, minute:s.m, playerOffId:s.o, playerOnId:s.n, done:false }; }),
                      pitchSetup: data.se || {},
                    };
                  } else { payload = data; }
                  if (!payload.v || !payload.players) { setImportMsg("Error: invalid code."); return; }
                  var result = importSharedPayload(payload, { hl: data.hl, ha: data.ha });
                  if (result.mode === "current") {
                    setImportCode(""); setImportMsg("Loaded into " + result.teamName + "! Switching to Match tab..."); setTab("match");
                  } else if (result.mode === "switched") {
                    setImportMsg("Loading into existing team \"" + result.teamName + "\"...");
                  } else {
                    setImportMsg("Creating new team \"" + result.teamName + "\" and loading data...");
                  }
                } catch(e) { setImportMsg("Error: could not read code."); }
              }} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"#334155", color:"#f1f5f9", fontWeight:700, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Load</button>
            </div>
          </div>

          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155" }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Export all data</div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>Download your full database as JSON for import into a website or database.</div>
            <button onClick={function(){
              var data={team:LS.get("st_team"),players:LS.get("st_players",[]),matches:LS.get("st_matches",[]),stints:LS.get("st_stints",[]),events:LS.get("st_events",[]),exported_at:new Date().toISOString()};
              var a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})); a.download="subtracker-export.json"; a.click();
            }} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"#334155", color:"#f1f5f9", fontWeight:700, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Export JSON</button>
          </div>
        </div>
      )}
    </div>
  );
}

// If something crashes during render -- most commonly because data saved by an
// older version of the app is no longer compatible with the current code -- show
// a friendly recovery screen instead of a blank white page, with options to
// reload or clear the cached data and start over.
class SubTrackerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    try { console.error("SubTracker crashed:", error, info); } catch(e) {}
  }
  render() {
    if (!this.state.hasError) return <SubTrackerApp />;

    var activeId = null;
    try { activeId = localStorage.getItem("st_active_team"); } catch(e) {}

    function resetThisTeam() {
      if (!window.confirm("This will clear the cached roster, plan, and history for the current team on this device and start it fresh. Other cached teams are not affected. This cannot be undone. Continue?")) return;
      try {
        PER_TEAM_LS_KEYS.forEach(function(k){ localStorage.removeItem(k + "__" + activeId); });
      } catch(e) {}
      window.location.reload();
    }

    function resetEverything() {
      if (!window.confirm("This will clear ALL cached teams and data on this device and start completely fresh. This cannot be undone. Continue?")) return;
      try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("st_") === 0) keysToRemove.push(k);
        }
        keysToRemove.forEach(function(k){ localStorage.removeItem(k); });
      } catch(e) {}
      window.location.reload();
    }

    return (
      <div style={{ minHeight:"100vh", background:"#0f172a", color:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth:420, width:"100%", background:"#1e293b", border:"1px solid #334155", borderRadius:14, padding:24, textAlign:"center" }}>
          <div style={{ width:48, height:48, borderRadius:"50%", background:"rgba(245,158,11,0.15)", border:"1px solid #f59e0b", color:"#f59e0b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:800, margin:"0 auto 14px" }}>!</div>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Something went wrong loading SubTracker</div>
          <div style={{ fontSize:12, color:"#94a3b8", marginBottom:20, lineHeight:1.6 }}>
            This is usually caused by data saved by a previous version of the app that's no longer compatible with this version. Try reloading first -- if that doesn't help, you can reset the cached data and start fresh.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <button onClick={function(){ window.location.reload(); }} style={{ padding:"10px 14px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Reload
            </button>
            <button onClick={resetThisTeam} style={{ padding:"10px 14px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#f1f5f9", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Reset this team's data and start fresh
            </button>
            <button onClick={resetEverything} style={{ padding:"10px 14px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#f87171", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
              Reset ALL cached teams on this device
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default function SubTracker() {
  return <SubTrackerErrorBoundary />;
}
