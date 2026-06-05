import { useState, useEffect, useRef, useCallback } from "react";

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

const LS = {
  get: (key, fb) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : (fb !== undefined ? fb : null); } catch(e) { return fb !== undefined ? fb : null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} },
};

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
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(w*0.04, h*0.04, w*0.92, h*0.92);
  ctx.beginPath(); ctx.moveTo(w*0.04, h*0.5); ctx.lineTo(w*0.96, h*0.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(w*0.5, h*0.5, Math.min(w,h)*0.1, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(w*0.5, h*0.5, 3, 0, Math.PI*2); ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.fill();
  ctx.strokeRect(w*0.25, h*0.04, w*0.5, h*0.18);
  ctx.strokeRect(w*0.25, h*0.78, w*0.5, h*0.18);
  ctx.strokeRect(w*0.36, h*0.04, w*0.28, h*0.07);
  ctx.strokeRect(w*0.36, h*0.89, w*0.28, h*0.07);
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

      <div ref={wrapRef} style={{ flex:1, position:"relative", overflow:"hidden", touchAction:"none" }}>
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
  );
}

// ---- Main App ----

export default function SubTracker() {
  useEffect(function() { initStorage(); }, []);

  var _tab = useState("match"); var tab = _tab[0], setTab = _tab[1];

  var _team = useState(function() { return LS.get("st_team", { id:uid(), name:"My Team", season:String(new Date().getFullYear()), coach_name:"", created_at:new Date().toISOString() }); });
  var team = _team[0], setTeamState = _team[1];

  var _dbPl = useState(function() { return LS.get("st_players", []); });
  var dbPlayers = _dbPl[0], setDbPlayers = _dbPl[1];

  var _pos = useState(function() { return LS.get("st_positions") || POSITIONS.map(function(p){return Object.assign({},p);}); });
  var positions = _pos[0], setPositions = _pos[1];

  var _secs = useState(0);  var matchSecs = _secs[0], setMatchSecs = _secs[1];
  var _run  = useState(false); var running = _run[0], setRunning = _run[1];
  var _score= useState({home:0,away:0}); var score = _score[0], setScore = _score[1];
  var _opp  = useState(""); var opponent = _opp[0], setOpponent = _opp[1];
  var _ven  = useState(""); var venue    = _ven[0], setVenue    = _ven[1];
  var _saved= useState(false); var matchSaved = _saved[0], setMatchSaved = _saved[1];

  var _ps = useState(function() {
    return LS.get("st_players",[]).reduce(function(acc,p) { acc[p.id]={pitchPos:null,pitchSecs:0,positionTimes:{},stints:[]}; return acc; }, {});
  });
  var pitchState = _ps[0], setPitchState = _ps[1];

  var _events = useState([]); var events = _events[0], setEvents = _events[1];
  var _pm = useState(null);  var pitchMenu = _pm[0], setPitchMenu = _pm[1];
  var _sm = useState(null);  var sideMenu  = _sm[0], setSideMenu  = _sm[1];
  var _dh = useState(null);  var dropHi    = _dh[0], setDropHi    = _dh[1];
  var _pe = useState(null);  var posEdit   = _pe[0], setPosEdit   = _pe[1];
  var _wb = useState(false); var showWB    = _wb[0], setShowWB    = _wb[1];

  var _hist = useState(function(){ return LS.get("st_matches",[]); }); var histMatches = _hist[0], setHistMatches = _hist[1];
  var _sf   = useState(function(){ return String(new Date().getFullYear()); }); var seasonFilter = _sf[0], setSeasonFilter = _sf[1];

  var _nn = useState(""); var newNum = _nn[0], setNewNum = _nn[1];
  var _nna= useState(""); var newName= _nna[0],setNewName= _nna[1];
  var _np = useState("MID"); var newPos= _np[0], setNewPos = _np[1];

  var _tn = useState(function(){ return (LS.get("st_team",{})||{}).name||"My Team"; }); var teamName = _tn[0], setTeamName = _tn[1];
  var _ts = useState(function(){ return (LS.get("st_team",{})||{}).season||String(new Date().getFullYear()); }); var teamSeason = _ts[0], setTeamSeason = _ts[1];
  var _cn = useState(function(){ return (LS.get("st_team",{})||{}).coach_name||""; }); var coachName = _cn[0], setCoachName = _cn[1];

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

  // Tick
  useEffect(function() {
    if (running) {
      intRef.current = setInterval(function() {
        setMatchSecs(function(s){return s+1;});
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

  var addEvent = useCallback(function(playerId, eventType, notes) {
    setEvents(function(prev){ return prev.concat([{ id:uid(), player_id:playerId, event_type:eventType, match_second:matchSecs, notes:notes||"" }]); });
  }, [matchSecs]);

  function closeStint(pid, endSec, ps) {
    if (!ps.pitchPos) return ps;
    var stints = ps.stints.slice();
    var last = stints[stints.length-1];
    if (!last || last.end_second !== null) return ps;
    stints[stints.length-1] = Object.assign({}, last, { end_second:endSec, total_seconds:endSec-last.start_second });
    return Object.assign({}, ps, { stints:stints });
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
    if (bench && pitch) addEvent(benchId, "substitution", bench.name+" on for "+pitch.name);
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
    LS.set("st_events",  LS.get("st_events", []).concat(events.map(function(e){return Object.assign({},e,{match_id:mid});})));
    setHistMatches(function(prev){return prev.concat([match]);});
    setMatchSaved(true);
  }, [team, opponent, venue, score, matchSecs, pitchState, events]);

  var resetMatch = useCallback(function() {
    setRunning(false); setMatchSecs(0); setScore({home:0,away:0});
    setOpponent(""); setVenue(""); setMatchSaved(false); setEvents([]);
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
    var headers=["Name","Jersey","Position","Total Time"].concat(POSITIONS.map(function(p){return p.label+" ("+p.id+")";}));
    var rows=dbPlayers.map(function(p){
      var ps=pitchState[p.id]||{}; return [p.name,p.jersey_number,p.default_position,fmtTime(ps.pitchSecs||0)].concat(POSITIONS.map(function(pos){return (ps.positionTimes&&ps.positionTimes[pos.id])?fmtTime(ps.positionTimes[pos.id]):""; }));
    });
    var csv=[headers].concat(rows).map(function(r){return r.map(function(c){return '"'+c+'"';}).join(",");}).join("\n");
    var a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="match-report.csv"; a.click();
  }
  function exportSeasonCSV() {
    var totals=querySeasonTotals(seasonFilter);
    var headers=["Name","Jersey","Season Total"].concat(POSITIONS.map(function(p){return p.label;}));
    var rows=totals.map(function(p){return [p.name,p.jersey_number,fmtTime(p.total)].concat(POSITIONS.map(function(pos){return p.byPos[pos.id]?fmtTime(p.byPos[pos.id]):""; }));});
    var csv=[headers].concat(rows).map(function(r){return r.map(function(c){return '"'+c+'"';}).join(",");}).join("\n");
    var a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="season-"+seasonFilter+"-report.csv"; a.click();
  }
  function exportPDF() {
    var ps=pitchState;
    var tbl='<table border="1" cellpadding="5" style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="background:#1D9E75;color:white"><th>Name</th><th>#</th><th>Total</th>'+POSITIONS.map(function(p){return "<th>"+p.label+"</th>";}).join("")+"</tr></thead><tbody>"+dbPlayers.map(function(p,i){return '<tr style="background:'+(i%2?"#f0fdf4":"white")+'"><td>'+p.name+"</td><td>"+p.jersey_number+"</td><td>"+fmtTime((ps[p.id]&&ps[p.id].pitchSecs)||0)+"</td>"+POSITIONS.map(function(pos){return "<td>"+((ps[p.id]&&ps[p.id].positionTimes&&ps[p.id].positionTimes[pos.id])?fmtTime(ps[p.id].positionTimes[pos.id]):"-")+"</td>";}).join("")+"</tr>";}).join("")+"</tbody></table>";
    var w=window.open("","_blank");
    w.document.write("<!DOCTYPE html><html><head><title>Match Report</title></head><body style=\"font-family:sans-serif;padding:2rem\"><h1 style=\"color:#1D9E75\">SubTracker Report</h1><p>"+opponent+" | Score: "+score.home+"-"+score.away+" | Duration: "+fmtTime(matchSecs)+"</p><h2>Player Times</h2>"+tbl+"</body></html>");
    w.document.close(); w.print();
  }

  // Derived
  var onPitch = dbPlayers.filter(function(p){return pitchState[p.id]&&pitchState[p.id].pitchPos;});
  var onBench  = dbPlayers.filter(function(p){return !pitchState[p.id]||!pitchState[p.id].pitchPos;});
  var livePosns = positions.map(function(p){ return (posEdit&&posEdit.posId===p.id)?Object.assign({},p,{x:posEdit.draftX,y:posEdit.draftY}):p; });
  var seasonTotals = querySeasonTotals(seasonFilter);
  var uniqueSeasons = Array.from(new Set(histMatches.map(function(m){return m.match_date&&m.match_date.slice(0,4);}).filter(Boolean))).sort().reverse();

  return (
    <div style={{ background:"#0f172a", minHeight:"100vh", fontFamily:"system-ui, sans-serif", color:"#f8fafc" }}>

      {/* Header */}
      <div style={{ background:"#1e293b", borderBottom:"1px solid #334155", padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", zIndex:200 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:"#1D9E75", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>O</div>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>{team.name}</div>
            <div style={{ fontSize:9, color:isSetup?"#f59e0b":running?"#34d399":"#64748b" }}>{isSetup?"SETUP":running?"LIVE":"PAUSED"} - {team.season}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:3, alignItems:"center" }}>
          {["match","roster","history","settings"].map(function(t){
            return <button key={t} onClick={function(){setTab(t);}} style={{ padding:"5px 10px", borderRadius:6, border:"none", fontSize:11, fontWeight:600, cursor:"pointer", textTransform:"capitalize", background:tab===t?"#1D9E75":"transparent", color:tab===t?"white":"#94a3b8", fontFamily:"inherit" }}>{t}</button>;
          })}
          <div style={{ width:1, height:20, background:"#334155", margin:"0 4px" }} />
          <button onClick={function(){setShowWB(function(w){return !w;});}} style={{ padding:"5px 10px", borderRadius:6, border:showWB?"1.5px solid #a78bfa":"1.5px solid #334155", fontSize:11, fontWeight:600, cursor:"pointer", background:showWB?"rgba(167,139,250,0.15)":"transparent", color:showWB?"#a78bfa":"#94a3b8", fontFamily:"inherit" }}>
            Board
          </button>
        </div>
      </div>

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
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7 }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, background:"#1e293b", borderRadius:9, padding:"6px 11px", flex:1, justifyContent:"center" }}>
                <button onClick={function(){setScore(function(s){return {home:Math.max(0,s.home-1),away:s.away};});}} style={S.btn}>-</button>
                <span style={{ fontSize:22, fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{score.home}</span>
                <span style={{ fontSize:10, color:"#64748b", padding:"0 3px" }}>HOME</span>
                <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:"#1D9E75", padding:"0 5px", fontVariantNumeric:"tabular-nums" }}>{fmtTime(matchSecs)}</div>
                <span style={{ fontSize:10, color:"#64748b", padding:"0 3px" }}>AWAY</span>
                <span style={{ fontSize:22, fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{score.away}</span>
                <button onClick={function(){setScore(function(s){return {home:s.home,away:Math.max(0,s.away-1)};});}} style={S.btn}>-</button>
              </div>
              <button onClick={function(){setScore(function(s){return {home:s.home+1,away:s.away};});}} style={{ ...S.btn, ...S.grn, fontSize:10 }}>+H</button>
              <button onClick={function(){setRunning(function(r){return !r;});}} style={{ padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:700, fontSize:11, background:running?"#ef4444":"#1D9E75", color:"white", fontFamily:"inherit" }}>
                {running?"Pause":matchSecs>0?"Resume":"Start"}
              </button>
              <button onClick={function(){setScore(function(s){return {home:s.home,away:s.away+1};});}} style={{ ...S.btn, ...S.grn, fontSize:10 }}>+A</button>
            </div>

            {/* Pitch */}
            <div ref={pitchRef} onClick={function(){setPitchMenu(null);setSideMenu(null);if(!posEdit||!posEdit.dragging)setPosEdit(null);}}
              style={{ flex:1, position:"relative", borderRadius:10, overflow:"visible", background:"linear-gradient(180deg,#166534 0%,#15803d 30%,#16a34a 50%,#15803d 70%,#166534 100%)", border:"2px solid "+(posEdit?"#f59e0b":"#14532d"), transition:"border-color 0.2s" }}>
              <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", borderRadius:9 }} viewBox="0 0 100 100" preserveAspectRatio="none">
                {[0,1,2,3,4,5,6,7].map(function(i){return <rect key={i} x={0} y={i*12.5} width={100} height={6.25} fill="rgba(255,255,255,0.03)" />;}) }
                <rect x={3} y={3} width={94} height={94} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.6} />
                <line x1={3} y1={50} x2={97} y2={50} stroke="rgba(255,255,255,0.45)" strokeWidth={0.5} />
                <circle cx={50} cy={50} r={12} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.5} />
                <circle cx={50} cy={50} r={0.8} fill="rgba(255,255,255,0.7)" />
                <rect x={28} y={3} width={44} height={18} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
                <rect x={28} y={79} width={44} height={18} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
                <rect x={38} y={3} width={24} height={7} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.4} />
                <rect x={38} y={90} width={24} height={7} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={0.4} />
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

              {/* Players on pitch */}
              {onPitch.map(function(p) {
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

          {/* Bench panel */}
          <div style={{ width:210, background:"#1e293b", borderLeft:"1px solid #334155", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ padding:"7px 11px 5px", borderBottom:"1px solid #334155" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.07em" }}>Bench ({onBench.length})</div>
              <div style={{ fontSize:9, color:isSetup?"#f59e0b":"#64748b", marginTop:2 }}>{isSetup?"Drag to pitch or tap":"Tap to swap"}</div>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"4px 7px" }}>
              {onBench.length===0 && <div style={{ fontSize:11, color:"#475569", padding:"12px 6px", textAlign:"center" }}>All on pitch</div>}
              {onBench.map(function(p) {
                return (
                  <div key={p.id}>
                    <div draggable onDragStart={function(e){benchDragStart(e,p.id);}} onTouchStart={function(e){handleTouchStart(e,p.id,"bench");}} onClick={function(){handleBenchClick(p.id);}}
                      style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 7px", borderRadius:7, background:sideMenu&&sideMenu.playerId===p.id?"rgba(16,185,129,0.07)":"transparent", border:"1.5px solid "+(sideMenu&&sideMenu.playerId===p.id?"#1D9E75":"transparent"), cursor:"grab", marginBottom:2, transition:"all 0.12s", userSelect:"none", WebkitUserSelect:"none" }}>
                      <div style={{ width:24, height:24, borderRadius:"50%", background:"#374151", border:"2px solid #4b5563", display:"flex", alignItems:"center", justifyContent:"center", color:"#d1d5db", fontWeight:700, fontSize:9, flexShrink:0 }}>{p.jersey_number}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:"#f9fafb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                        <div style={{ fontSize:9, color:"#6b7280" }}>{p.default_position}</div>
                      </div>
                      <div style={{ fontSize:9, color:"#10b981", fontVariantNumeric:"tabular-nums", fontWeight:600 }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                    </div>
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
            </div>
            <div style={{ borderTop:"1px solid #334155", padding:"5px 8px" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>On Pitch ({onPitch.length})</div>
              <div style={{ maxHeight:140, overflowY:"auto" }}>
                {onPitch.map(function(p){
                  return (
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:5, padding:"2px 1px" }}>
                      <div style={{ width:16, height:16, borderRadius:"50%", background:"#1D9E75", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, fontWeight:700, color:"white", flexShrink:0 }}>{p.jersey_number}</div>
                      <div style={{ fontSize:9, color:"#94a3b8", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                      <div style={{ fontSize:8, color:"#10b981", fontVariantNumeric:"tabular-nums" }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- ROSTER TAB ---- */}
      {tab==="roster" && (
        <div style={{ padding:16, maxWidth:600, margin:"0 auto" }}>
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
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 11px", borderRadius:8, background:"#1e293b", marginBottom:5, border:"1px solid #334155" }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:(pitchState[p.id]&&pitchState[p.id].pitchPos)?"#1D9E75":"#374151", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"white", flexShrink:0 }}>{p.jersey_number}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:600 }}>{p.name}</div>
                  <div style={{ fontSize:10, color:"#64748b" }}>{p.default_position} - {(pitchState[p.id]&&pitchState[p.id].pitchPos)?"On pitch ("+pitchState[p.id].pitchPos+")":"Bench"}</div>
                </div>
                <div style={{ fontSize:10, color:"#10b981", fontVariantNumeric:"tabular-nums" }}>{fmtTime((pitchState[p.id]&&pitchState[p.id].pitchSecs)||0)}</div>
                <button onClick={function(){setDbPlayers(function(prev){return prev.filter(function(x){return x.id!==p.id;});});setPitchState(function(prev){var n=Object.assign({},prev);delete n[p.id];return n;});}} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:14, padding:"0 3px", fontFamily:"inherit" }}>X</button>
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
          <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Team Settings</div>
          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155", marginBottom:14 }}>
            {[["Team name", teamName, setTeamName], ["Season", teamSeason, setTeamSeason], ["Coach", coachName, setCoachName]].map(function(row){
              return (
                <div key={row[0]} style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11, color:"#64748b", display:"block", marginBottom:3 }}>{row[0]}</label>
                  <input value={row[1]} onChange={function(e){row[2](e.target.value);}} style={{ width:"100%", ...S.inp }} />
                </div>
              );
            })}
            <button onClick={function(){var u=Object.assign({},team,{name:teamName,season:teamSeason,coach_name:coachName});setTeamState(u);LS.set("st_team",u);}} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:"#1D9E75", color:"white", fontWeight:700, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Save</button>
          </div>
          <div style={{ background:"#1e293b", borderRadius:10, padding:16, border:"1px solid #334155", marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Pitch layout</div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>Click any position marker on the pitch to reposition it.</div>
            <button onClick={function(){var r=POSITIONS.map(function(p){return Object.assign({},p);});setPositions(r);LS.set("st_positions",r);}} style={{ padding:"7px 13px", borderRadius:8, border:"1px solid #334155", background:"transparent", color:"#f87171", fontWeight:700, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>Reset positions</button>
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
