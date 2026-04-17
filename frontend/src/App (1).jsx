import { useState, useEffect, useMemo, useCallback } from "react";

const API_URL = "http://127.0.0.1:8000";
const EMPTY_FORM = { exercise: "", sets: "", reps: "", weight: "", notes: "" };

// ─── Keyword classifier (mirrors backend for instant preview) ──────────────────
const KEYWORD_RULES = [
  ["bench press","Chest"],["chest press","Chest"],["chest fly","Chest"],
  ["incline press","Chest"],["decline press","Chest"],["pec deck","Chest"],
  ["cable fly","Chest"],["push up","Chest"],["pushup","Chest"],["dip","Chest"],
  ["pull up","Back"],["pullup","Back"],["chin up","Back"],["chinup","Back"],
  ["lat pulldown","Back"],["pull down","Back"],["seated row","Back"],
  ["cable row","Back"],["bent over row","Back"],["barbell row","Back"],
  ["t-bar row","Back"],["t bar row","Back"],["face pull","Back"],
  ["good morning","Back"],["hyperextension","Back"],["back extension","Back"],
  ["romanian deadlift","Legs"],["stiff leg deadlift","Legs"],["rdl","Legs"],
  ["bulgarian split","Legs"],["split squat","Legs"],["hack squat","Legs"],
  ["sumo deadlift","Legs"],["sumo squat","Legs"],["leg press","Legs"],
  ["leg curl","Legs"],["leg extension","Legs"],["calf raise","Legs"],
  ["hip thrust","Legs"],["glute bridge","Legs"],["step up","Legs"],
  ["box jump","Legs"],["lunge","Legs"],["squat","Legs"],["deadlift","Legs"],
  ["overhead press","Shoulders"],["shoulder press","Shoulders"],
  ["military press","Shoulders"],["ohp","Shoulders"],["arnold press","Shoulders"],
  ["lateral raise","Shoulders"],["front raise","Shoulders"],
  ["upright row","Shoulders"],["rear delt","Shoulders"],
  ["reverse fly","Shoulders"],["shrug","Shoulders"],
  ["skull crusher","Arms"],["preacher curl","Arms"],["concentration curl","Arms"],
  ["hammer curl","Arms"],["zottman curl","Arms"],["spider curl","Arms"],
  ["cable curl","Arms"],["barbell curl","Arms"],["ez bar curl","Arms"],
  ["bicep curl","Arms"],["biceps curl","Arms"],["close grip bench","Arms"],
  ["overhead extension","Arms"],["tricep pushdown","Arms"],
  ["tricep extension","Arms"],["tricep dip","Arms"],["tricep","Arms"],
  ["triceps","Arms"],["curl","Arms"],
  ["ab wheel","Core"],["dragon flag","Core"],["hanging leg raise","Core"],
  ["leg raise","Core"],["cable crunch","Core"],["russian twist","Core"],
  ["pallof press","Core"],["wood chop","Core"],["hollow hold","Core"],
  ["l-sit","Core"],["v-up","Core"],["sit up","Core"],["situp","Core"],
  ["crunch","Core"],["plank","Core"],
  ["jump rope","Cardio"],["jumping jack","Cardio"],["mountain climber","Cardio"],
  ["high knee","Cardio"],["sled push","Cardio"],["rowing machine","Cardio"],
  ["elliptical","Cardio"],["treadmill","Cardio"],["stair climber","Cardio"],
  ["stair","Cardio"],["cycling","Cardio"],["stationary bike","Cardio"],
  ["burpee","Cardio"],["sprint","Cardio"],["running","Cardio"],
  ["jogging","Cardio"],["swimming","Cardio"],["hiit","Cardio"],
  ["walk","Cardio"],["run","Cardio"],["bike","Cardio"],["swim","Cardio"],
  ["jog","Cardio"],
];
function classifyExercise(name) {
  const l = name.toLowerCase().replace(/[-_/]/g, " ").trim();
  for (const [kw, g] of KEYWORD_RULES) { if (l.includes(kw)) return g; }
  return "Other";
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const GROUP_COLORS = {
  Chest:"#ef4444", Legs:"#f97316", Back:"#3b82f6", Shoulders:"#8b5cf6",
  Arms:"#ec4899", Core:"#14b8a6", Cardio:"#f59e0b", Other:"#6b7280",
};
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const REC_TYPE_STYLE = {
  recovery:  { color: "#ef4444", bg: "rgba(239,68,68,0.08)",   icon: "⚠️" },
  neglected: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  icon: "📉" },
  imbalance: { color: "#f97316", bg: "rgba(249,115,22,0.08)",  icon: "⚖️" },
  stall:     { color: "#8b5cf6", bg: "rgba(139,92,246,0.08)",  icon: "📊" },
  frequency: { color: "#3b82f6", bg: "rgba(59,130,246,0.08)",  icon: "📅" },
  new_group: { color: "#14b8a6", bg: "rgba(20,184,166,0.08)",  icon: "✨" },
  positive:  { color: "#a3e635", bg: "rgba(163,230,53,0.08)",  icon: "🏆" },
  welcome:   { color: "#6b7280", bg: "rgba(107,114,128,0.08)", icon: "👋" },
};

function parseUTC(iso) {
  if (!iso) return new Date(0);
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(s);
}
function formatDate(iso) {
  if (!iso) return "";
  return parseUTC(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function utcDateKey(iso) {
  const d = parseUTC(iso);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function fmtWeight(w) {
  if (!w || w === 0) return "BW";
  return `${w % 1 === 0 ? w : w.toFixed(1)} lbs`;
}
function epley1RM(weight, reps) {
  if (!weight || reps === 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// ─── Token storage ─────────────────────────────────────────────────────────────
const TOKEN_KEY = "fw_token";
const USER_KEY  = "fw_user";
function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function loadSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw   = localStorage.getItem(USER_KEY);
  const user  = raw ? JSON.parse(raw) : null;
  return { token, user };
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ─── Authed fetch helper ───────────────────────────────────────────────────────
async function apiFetch(path, token, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  return res;
}

// ─── Theme ─────────────────────────────────────────────────────────────────────
function getThemeVars(dark) {
  return dark ? {
    "--bg-page":"#0d0d14","--bg-card":"rgba(255,255,255,0.03)",
    "--bg-card-hov":"rgba(255,255,255,0.06)","--bg-input":"rgba(255,255,255,0.05)",
    "--border":"rgba(255,255,255,0.07)","--border-in":"rgba(255,255,255,0.1)",
    "--text":"#ffffff","--text-sec":"rgba(255,255,255,0.45)",
    "--text-ter":"rgba(255,255,255,0.25)","--header-bg":"rgba(13,13,20,0.85)",
    "--accent":"#a3e635","--accent-dk":"#65a30d","--accent-text":"#0d1117",
    "--tab-active-bg":"rgba(163,230,53,0.15)","--tab-active-clr":"#a3e635",
    "--tab-clr":"rgba(255,255,255,0.4)","--error-bg":"rgba(239,68,68,0.1)",
    "--error-bd":"rgba(239,68,68,0.3)","--select-bg":"#1a1a2e",
  } : {
    "--bg-page":"#f0f2f5","--bg-card":"#ffffff",
    "--bg-card-hov":"#f8fafc","--bg-input":"#ffffff",
    "--border":"rgba(0,0,0,0.08)","--border-in":"rgba(0,0,0,0.12)",
    "--text":"#0d1117","--text-sec":"rgba(0,0,0,0.5)",
    "--text-ter":"rgba(0,0,0,0.3)","--header-bg":"rgba(240,242,245,0.9)",
    "--accent":"#65a30d","--accent-dk":"#3f6212","--accent-text":"#ffffff",
    "--tab-active-bg":"rgba(101,163,13,0.12)","--tab-active-clr":"#3f6212",
    "--tab-clr":"rgba(0,0,0,0.4)","--error-bg":"rgba(239,68,68,0.08)",
    "--error-bd":"rgba(239,68,68,0.25)","--select-bg":"#ffffff",
  };
}
function makeStyles() {
  return {
    input: {
      background:"var(--bg-input)",border:"1px solid var(--border-in)",
      borderRadius:"10px",padding:"10px 14px",color:"var(--text)",
      fontSize:"14px",outline:"none",width:"100%",boxSizing:"border-box",
      fontFamily:"inherit",transition:"border-color 0.15s",
    },
    card: {
      background:"var(--bg-card)",border:"1px solid var(--border)",
      borderRadius:"16px",padding:"20px",
    },
    label: {
      fontSize:"11px",color:"var(--text-sec)",fontWeight:700,
      textTransform:"uppercase",letterSpacing:"0.08em",
      display:"block",marginBottom:"6px",
    },
  };
}

// ─── Auth screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, dark }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ username: "", password: "", display_name: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const S = makeStyles();
  const tv = getThemeVars(dark);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      if (mode === "register") {
        const res = await fetch(`${API_URL}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            display_name: form.display_name || undefined,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.detail || "Registration failed");
        }
        setMode("login");
        setError(null);
        setForm(f => ({ ...f, password: "" }));
        return;
      }
      // Login — OAuth2 form format
      const body = new URLSearchParams({ username: form.username, password: form.password });
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Login failed");
      }
      const data = await res.json();
      saveSession(data.access_token, { username: data.username, display_name: data.display_name });
      onAuth(data.access_token, { username: data.username, display_name: data.display_name });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...tv, minHeight:"100vh", background:"var(--bg-page)", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ width:"100%", maxWidth:"420px", padding:"0 24px" }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:"10px", justifyContent:"center", marginBottom:"40px" }}>
          <div style={{ width:"36px", height:"36px", borderRadius:"10px",
            background:"linear-gradient(135deg, var(--accent), var(--accent-dk))",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6.5 6.5h11M6.5 17.5h11M3 12h18M8 4v16M16 4v16"/>
            </svg>
          </div>
          <span style={{ fontWeight:800, fontSize:"24px", letterSpacing:"-0.5px", color:"var(--text)" }}>FitWise</span>
        </div>

        <div style={{ ...S.card, padding:"32px" }}>
          <h2 style={{ fontSize:"20px", fontWeight:800, margin:"0 0 4px", color:"var(--text)", letterSpacing:"-0.4px" }}>
            {mode === "login" ? "Welcome back" : "Create account"}
          </h2>
          <p style={{ color:"var(--text-sec)", fontSize:"13px", margin:"0 0 24px" }}>
            {mode === "login" ? "Log in to your FitWise account" : "Start tracking your training today"}
          </p>

          {error && (
            <div style={{ background:"var(--error-bg)", border:"1px solid var(--error-bd)",
              borderRadius:"8px", padding:"10px 14px", marginBottom:"16px",
              color:"#ef4444", fontSize:"13px" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display:"grid", gap:"12px" }}>
              {mode === "register" && (
                <div>
                  <label style={S.label}>Display name <span style={{ color:"var(--text-ter)", fontWeight:400, textTransform:"none" }}>(optional)</span></label>
                  <input placeholder="e.g. Alex Johnson" value={form.display_name}
                    onChange={e => setForm({ ...form, display_name: e.target.value })}
                    style={S.input}
                    onFocus={e => e.target.style.borderColor="var(--accent)"}
                    onBlur={e => e.target.style.borderColor="var(--border-in)"}
                  />
                </div>
              )}
              <div>
                <label style={S.label}>Username</label>
                <input required placeholder="your_username" value={form.username} autoComplete="username"
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  style={S.input}
                  onFocus={e => e.target.style.borderColor="var(--accent)"}
                  onBlur={e => e.target.style.borderColor="var(--border-in)"}
                />
              </div>
              <div>
                <label style={S.label}>Password {mode === "register" && <span style={{ color:"var(--text-ter)", fontWeight:400, textTransform:"none" }}>(min. 6 chars)</span>}</label>
                <input required type="password" placeholder="••••••••" value={form.password} autoComplete={mode === "login" ? "current-password" : "new-password"}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  style={S.input}
                  onFocus={e => e.target.style.borderColor="var(--accent)"}
                  onBlur={e => e.target.style.borderColor="var(--border-in)"}
                />
              </div>
              <button type="submit" disabled={loading} style={{
                background:"linear-gradient(135deg, var(--accent), var(--accent-dk))",
                color:"var(--accent-text)", border:"none", borderRadius:"12px",
                padding:"13px", fontSize:"14px", fontWeight:700, cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1, marginTop:"4px", transition:"opacity 0.15s",
              }}>
                {loading ? (mode === "login" ? "Logging in…" : "Creating account…") : (mode === "login" ? "Log in" : "Create account")}
              </button>
            </div>
          </form>

          <p style={{ textAlign:"center", fontSize:"13px", color:"var(--text-sec)", marginTop:"20px", marginBottom:0 }}>
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
              style={{ background:"none", border:"none", color:"var(--accent)", fontWeight:700,
                cursor:"pointer", fontSize:"13px", padding:0 }}>
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Shared sub-components ─────────────────────────────────────────────────────
function WeekGrid({ workouts }) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (6 - i)); return d;
  });
  const daySet = new Set(workouts.map(w => utcDateKey(w.created_at)));
  return (
    <div style={{ display:"flex", gap:"6px" }}>
      {days.map((d, i) => {
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        const active = daySet.has(key);
        const isToday = i === 6;
        return (
          <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"4px" }}>
            <div style={{
              width:"36px", height:"36px", borderRadius:"8px",
              background: active ? "var(--accent)" : "var(--bg-input)",
              border: isToday ? "1.5px solid var(--accent)" : "1px solid var(--border)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"12px", fontWeight:600,
              color: active ? "var(--accent-text)" : "var(--text-ter)", transition:"all 0.2s",
            }}>{d.getDate()}</div>
            <span style={{ fontSize:"10px", color:"var(--text-ter)", fontFamily:"monospace" }}>
              {DAY_LABELS[d.getDay()]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom:"10px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
        <span style={{ fontSize:"12px", color:"var(--text-sec)", fontWeight:500 }}>{label}</span>
        <span style={{ fontSize:"12px", color, fontWeight:700, fontFamily:"monospace" }}>{value}</span>
      </div>
      <div style={{ height:"4px", background:"var(--border)", borderRadius:"99px", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:"99px", transition:"width 0.6s cubic-bezier(0.34,1.56,0.64,1)" }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)",
      borderRadius:"16px", padding:"20px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:"2px", background:accent }} />
      <div style={{ fontSize:"26px", fontWeight:800, color:"var(--text)", letterSpacing:"-0.5px", lineHeight:1.1 }}>{value}</div>
      <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginTop:"4px" }}>{label}</div>
      {sub && <div style={{ fontSize:"12px", color:accent, fontWeight:600, marginTop:"6px" }}>{sub}</div>}
    </div>
  );
}

function VolumeChart({ workouts }) {
  const data = useMemo(() => {
    const map = {};
    workouts.forEach(w => {
      const d = formatDate(w.created_at);
      const v = w.weight > 0 ? w.sets * w.reps * w.weight : w.sets * w.reps;
      map[d] = (map[d] || 0) + v;
    });
    const entries = Object.entries(map).sort((a,b) => new Date(a[0])-new Date(b[0])).slice(-8);
    const max = Math.max(...entries.map(([,v]) => v), 1);
    return { entries, max };
  }, [workouts]);

  if (!data.entries.length) return (
    <div style={{ textAlign:"center", color:"var(--text-ter)", fontSize:"13px", padding:"32px 0" }}>No volume data yet</div>
  );
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:"6px", height:"80px", paddingTop:"8px" }}>
      {data.entries.map(([date, vol], i) => (
        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:"4px", height:"100%" }}>
          <div style={{ flex:1, width:"100%", display:"flex", alignItems:"flex-end" }}>
            <div title={`${date}: ${Math.round(vol).toLocaleString()}`} style={{
              width:"100%", background:"var(--accent)", borderRadius:"4px 4px 2px 2px",
              minHeight:"4px", height:`${(vol/data.max)*100}%`, cursor:"pointer",
              opacity: i === data.entries.length-1 ? 1 : 0.5, transition:"height 0.5s",
            }} />
          </div>
          <span style={{ fontSize:"9px", color:"var(--text-ter)", whiteSpace:"nowrap" }}>{date.split(" ")[1]}</span>
        </div>
      ))}
    </div>
  );
}

function PRCard({ exercise, weight, date, color }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"12px", padding:"10px 14px",
      borderRadius:"12px", background:"var(--bg-input)", border:"1px solid var(--border)", marginBottom:"8px" }}>
      <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:color, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:"13px", fontWeight:600, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{exercise}</div>
        <div style={{ fontSize:"11px", color:"var(--text-ter)", marginTop:"1px" }}>{date}</div>
      </div>
      <div style={{ fontSize:"15px", fontWeight:800, color, fontFamily:"monospace", flexShrink:0 }}>{fmtWeight(weight)}</div>
    </div>
  );
}

function GroupBadge({ muscleGroup }) {
  const group = muscleGroup || "Other";
  const color = GROUP_COLORS[group] || "#6b7280";
  return (
    <div style={{ width:"42px", height:"42px", borderRadius:"12px", flexShrink:0,
      background:`${color}22`, border:`1px solid ${color}44`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:"10px", fontWeight:700, color, textTransform:"uppercase", letterSpacing:"0.03em" }}>
      {group.slice(0, 3)}
    </div>
  );
}

function WorkoutCard({ workout, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const group = workout.muscle_group || "Other";
  const color = GROUP_COLORS[group] || "#6b7280";
  const volume = workout.weight > 0 ? workout.sets * workout.reps * workout.weight : workout.sets * workout.reps;
  const handleDeleteClick = () => {
    if (confirming) { onDelete(workout.id); }
    else { setConfirming(true); setTimeout(() => setConfirming(false), 3000); }
  };
  return (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)",
      borderRadius:"14px", padding:"16px", display:"flex", alignItems:"center",
      gap:"14px", transition:"background 0.18s" }}
      onMouseEnter={e => e.currentTarget.style.background="var(--bg-card-hov)"}
      onMouseLeave={e => e.currentTarget.style.background="var(--bg-card)"}
    >
      <GroupBadge muscleGroup={group} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, color:"var(--text)", fontSize:"14px", marginBottom:"2px",
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{workout.exercise}</div>
        <div style={{ fontSize:"12px", color:"var(--text-sec)", display:"flex", gap:"10px", flexWrap:"wrap" }}>
          <span>{workout.sets} × {workout.reps}</span>
          <span style={{ color:"var(--text-ter)" }}>·</span>
          <span style={{ color:"#60a5fa", fontWeight:600 }}>{fmtWeight(workout.weight)}</span>
          <span style={{ color:"var(--text-ter)" }}>·</span>
          <span style={{ color:"var(--accent)", fontWeight:600 }}>{Math.round(volume).toLocaleString()} vol</span>
        </div>
        {workout.notes && <div style={{ fontSize:"11px", color:"var(--text-ter)", marginTop:"4px", fontStyle:"italic" }}>{workout.notes}</div>}
      </div>
      <div style={{ fontSize:"11px", color:"var(--text-ter)", flexShrink:0 }}>{formatDate(workout.created_at)}</div>
      <div style={{ display:"flex", gap:"6px", flexShrink:0 }}>
        <button onClick={() => onEdit(workout)} style={{
          background:"var(--bg-input)", border:"1px solid var(--border-in)",
          color:"var(--text-sec)", borderRadius:"8px", padding:"6px 10px",
          fontSize:"11px", cursor:"pointer", fontWeight:600, transition:"all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.background="var(--bg-card-hov)"; e.currentTarget.style.color="var(--text)"; }}
          onMouseLeave={e => { e.currentTarget.style.background="var(--bg-input)"; e.currentTarget.style.color="var(--text-sec)"; }}
        >Edit</button>
        <button onClick={handleDeleteClick} style={{
          background: confirming ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.08)",
          border:`1px solid ${confirming ? "rgba(239,68,68,0.6)" : "rgba(239,68,68,0.2)"}`,
          color:"#ef4444", borderRadius:"8px", padding:"6px 10px",
          fontSize:"11px", cursor:"pointer", fontWeight:600, transition:"all 0.15s", minWidth:"52px",
        }}>{confirming ? "Sure?" : "Del"}</button>
      </div>
    </div>
  );
}

// ─── Progression chart (SVG, no deps) ─────────────────────────────────────────
function ProgressionChart({ workouts }) {
  const exercises = useMemo(() => [...new Set(workouts.filter(w => w.weight > 0).map(w => w.exercise))].sort(), [workouts]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState("weight");

  useEffect(() => { if (exercises.length && !selected) setSelected(exercises[0]); }, [exercises]);

  const chartData = useMemo(() => {
    if (!selected) return [];
    return workouts.filter(w => w.exercise === selected && w.weight > 0)
      .sort((a,b) => parseUTC(a.created_at) - parseUTC(b.created_at))
      .map(w => ({
        date: formatDate(w.created_at), weight: w.weight,
        volume: w.sets*w.reps*w.weight, orm: epley1RM(w.weight, w.reps),
        sets: w.sets, reps: w.reps,
      }));
  }, [workouts, selected]);

  const getValue = d => mode === "weight" ? d.weight : mode === "volume" ? d.volume : d.orm;
  const getLabel = () => mode === "weight" ? "Max Weight (lbs)" : mode === "volume" ? "Volume (lbs)" : "Est. 1RM (lbs)";

  if (!exercises.length) return (
    <div style={{ textAlign:"center", color:"var(--text-ter)", fontSize:"14px", padding:"48px 0" }}>
      Log weighted exercises to see progression charts
    </div>
  );

  const values = chartData.map(getValue);
  const minVal = Math.min(...values, 0), maxVal = Math.max(...values, 1);
  const range = maxVal - minVal || 1;
  const W=600,H=180,PL=52,PR=16,PT=16,PB=36;
  const iW=W-PL-PR, iH=H-PT-PB;
  const points = chartData.map((d,i) => ({
    x: PL + (chartData.length===1 ? iW/2 : (i/(chartData.length-1))*iW),
    y: PT + iH - ((getValue(d)-minVal)/range)*iH,
    ...d,
  }));
  const pathD = points.length < 2 ? "" : points.map((p,i) => i===0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`).join(" ");
  const yTicks = [0,0.25,0.5,0.75,1].map(t => ({ val:Math.round(minVal+t*range), y:PT+iH-t*iH }));
  const btnS = active => ({
    padding:"4px 12px", borderRadius:"6px", border:"1px solid var(--border-in)",
    fontSize:"12px", cursor:"pointer", fontWeight:600, transition:"all 0.15s",
    background: active ? "var(--accent)" : "var(--bg-input)",
    color: active ? "var(--accent-text)" : "var(--text-sec)",
  });

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"16px", flexWrap:"wrap" }}>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{
          background:"var(--bg-input)", border:"1px solid var(--border-in)",
          color:"var(--text)", borderRadius:"8px", padding:"6px 10px", fontSize:"13px", flex:1, minWidth:"140px",
        }}>
          {exercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
        </select>
        <div style={{ display:"flex", gap:"4px" }}>
          {[["weight","Weight"],["volume","Volume"],["1rm","Est. 1RM"]].map(([k,l]) => (
            <button key={k} style={btnS(mode===k)} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
      </div>
      {chartData.length === 0 ? (
        <div style={{ textAlign:"center", color:"var(--text-ter)", fontSize:"13px", padding:"32px 0" }}>No weighted data for this exercise</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow:"visible", display:"block" }}>
            {yTicks.map((t,i) => (
              <g key={i}>
                <line x1={PL} y1={t.y} x2={W-PR} y2={t.y} stroke="var(--border)" strokeWidth="1"/>
                <text x={PL-6} y={t.y+4} textAnchor="end" fontSize="10" fill="var(--text-ter)" fontFamily="monospace">{t.val}</text>
              </g>
            ))}
            {points.map((p,i) => (
              (i===0 || i===points.length-1 || points.length<=6) && (
                <text key={i} x={p.x} y={H-4} textAnchor="middle" fontSize="10" fill="var(--text-ter)">{p.date}</text>
              )
            ))}
            {pathD && <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
            {pathD && points.length>1 && <path d={`${pathD} L ${points[points.length-1].x} ${PT+iH} L ${points[0].x} ${PT+iH} Z`} fill="var(--accent)" opacity="0.08"/>}
            {points.map((p,i) => (
              <g key={i}><circle cx={p.x} cy={p.y} r="4" fill="var(--accent)"/>
                <title>{p.date}: {Math.round(getValue(p))} | {p.sets}×{p.reps}</title>
              </g>
            ))}
          </svg>
          <div style={{ fontSize:"11px", color:"var(--text-ter)", textAlign:"center", marginTop:"4px" }}>
            {getLabel()} · {chartData.length} session{chartData.length!==1?"s":""}{mode==="1rm"?" · Epley formula":""}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Recommendations panel ─────────────────────────────────────────────────────
function RecommendationsPanel({ token, workoutCount }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch("/recommendations", token);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRecs(data.recommendations || []);
    } catch {
      setError("Could not load recommendations. Make sure the API is running.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load, workoutCount]);

  if (loading) return (
    <div style={{ textAlign:"center", color:"var(--text-ter)", padding:"64px" }}>Analysing your training…</div>
  );
  if (error) return (
    <div style={{ background:"var(--error-bg)", border:"1px solid var(--error-bd)",
      borderRadius:"12px", padding:"16px", color:"#ef4444", fontSize:"13px" }}>{error}</div>
  );

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:"14px" }}>
      {recs.map((rec, i) => {
        const style = REC_TYPE_STYLE[rec.type] || REC_TYPE_STYLE.welcome;
        const groupColor = rec.group ? (GROUP_COLORS[rec.group] || "#6b7280") : null;
        return (
          <div key={i} style={{
            background:"var(--bg-card)", border:"1px solid var(--border)",
            borderRadius:"16px", padding:"18px 20px",
            borderLeft:`3px solid ${style.color}`,
          }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:"10px", marginBottom:"10px" }}>
              <span style={{ fontSize:"18px", lineHeight:1, marginTop:"1px" }}>{style.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:"13px", fontWeight:700, color:"var(--text)", marginBottom:"2px" }}>{rec.title}</div>
                {rec.group && (
                  <span style={{ display:"inline-block", fontSize:"10px", fontWeight:700,
                    background:`${groupColor}22`, color:groupColor,
                    padding:"1px 7px", borderRadius:"99px", border:`1px solid ${groupColor}44`,
                    textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"6px" }}>
                    {rec.group}
                  </span>
                )}
              </div>
              <div style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px", borderRadius:"6px",
                background:style.bg, color:style.color, whiteSpace:"nowrap", textTransform:"uppercase",
                letterSpacing:"0.05em" }}>
                {rec.type === "positive" ? "Good" : rec.priority <= 1 ? "Urgent" : rec.priority <= 2 ? "High" : rec.priority <= 3 ? "Medium" : "Low"}
              </div>
            </div>
            <p style={{ margin:0, fontSize:"13px", color:"var(--text-sec)", lineHeight:1.55 }}>{rec.message}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Training Insights panel ───────────────────────────────────────────────────
function InsightCard({ icon, title, value, detail, accent }) {
  return (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)",
      borderRadius:"14px", padding:"16px 18px", borderLeft:`3px solid ${accent}` }}>
      <div style={{ fontSize:"11px", color:"var(--text-ter)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"6px" }}>{icon} {title}</div>
      <div style={{ fontSize:"20px", fontWeight:800, color:"var(--text)", letterSpacing:"-0.5px", lineHeight:1.1 }}>{value}</div>
      {detail && <div style={{ fontSize:"12px", color:"var(--text-sec)", marginTop:"5px" }}>{detail}</div>}
    </div>
  );
}

function TrainingInsights({ workouts, stats }) {
  const insights = useMemo(() => {
    if (!workouts.length) return [];
    const result = [];
    const topGroup = Object.entries(stats.groupCounts).sort((a,b) => b[1]-a[1])[0];
    if (topGroup) result.push({
      icon:"💪", title:"Favourite group", accent:GROUP_COLORS[topGroup[0]]||"#6b7280",
      value:topGroup[0], detail:`${topGroup[1]} session${topGroup[1]!==1?"s":""} logged`,
    });
    const total = Object.values(stats.groupCounts).reduce((a,b) => a+b, 0);
    if (topGroup && total > 0) {
      const pct = Math.round((topGroup[1]/total)*100);
      if (pct > 40) result.push({
        icon:"⚖️", title:"Balance check", accent:"#f59e0b",
        value:`${pct}% ${topGroup[0]}`,
        detail:"Consider training other muscle groups more",
      });
    }
    const exHistory = {};
    workouts.filter(w => w.weight > 0).forEach(w => {
      const k = w.exercise.toLowerCase().trim();
      if (!exHistory[k]) exHistory[k] = { name:w.exercise, logs:[] };
      exHistory[k].logs.push({ weight:w.weight, date:parseUTC(w.created_at) });
    });
    let bestGain = null;
    Object.values(exHistory).forEach(({ name, logs }) => {
      if (logs.length < 2) return;
      logs.sort((a,b) => a.date-b.date);
      const gain = logs[logs.length-1].weight - logs[0].weight;
      if (gain > 0 && (!bestGain || gain > bestGain.gain)) bestGain = { name, gain };
    });
    if (bestGain) result.push({
      icon:"📈", title:"Most improved", accent:"#14b8a6",
      value:bestGain.name, detail:`+${bestGain.gain} lbs since first log`,
    });
    const best1RM = workouts.filter(w => w.weight > 0).reduce((best, w) => {
      const orm = epley1RM(w.weight, w.reps);
      return orm > (best?.orm||0) ? { exercise:w.exercise, orm, weight:w.weight, reps:w.reps } : best;
    }, null);
    if (best1RM) result.push({
      icon:"🏆", title:"Best est. 1RM", accent:"#f97316",
      value:`${best1RM.orm} lbs`, detail:`${best1RM.exercise} (${best1RM.weight}×${best1RM.reps})`,
    });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
    const recentDays = new Set(workouts.filter(w => parseUTC(w.created_at)>=cutoff).map(w => utcDateKey(w.created_at))).size;
    result.push({
      icon:"📅", title:"Last 30 days", accent:"#8b5cf6",
      value:`${recentDays} active day${recentDays!==1?"s":""}`,
      detail:`${Math.round((recentDays/30)*100)}% consistency`,
    });
    const totalReps = workouts.reduce((s,w) => s+w.sets*w.reps, 0);
    result.push({
      icon:"🔁", title:"Total reps ever", accent:"#ec4899",
      value:totalReps.toLocaleString(),
      detail:`Across ${workouts.length} logged session${workouts.length!==1?"s":""}`,
    });
    return result;
  }, [workouts, stats]);

  if (!insights.length) return (
    <div style={{ textAlign:"center", color:"var(--text-ter)", fontSize:"14px", padding:"48px 0" }}>
      Log a few workouts to unlock insights
    </div>
  );
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:"12px" }}>
      {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // Auth state
  const [token, setToken] = useState(() => loadSession().token);
  const [currentUser, setCurrentUser] = useState(() => loadSession().user);

  // Theme
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("fw-theme");
    return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const toggleTheme = () => setDark(d => { localStorage.setItem("fw-theme", !d ? "dark" : "light"); return !d; });

  // App state
  const [workouts, setWorkouts] = useState([]);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filterGroup, setFilterGroup] = useState("All");
  const [previewGroup, setPreviewGroup] = useState(null);

  const S = makeStyles();
  const themeVars = getThemeVars(dark);

  // Live exercise classification preview
  useEffect(() => {
    const name = formData.exercise.trim();
    setPreviewGroup(name ? classifyExercise(name) : null);
  }, [formData.exercise]);

  const handleAuth = (tok, user) => { setToken(tok); setCurrentUser(user); };

  const handleLogout = () => {
    clearSession();
    setToken(null); setCurrentUser(null);
    setWorkouts([]); setActiveTab("dashboard");
  };

  const fetchWorkouts = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true); setError(null);
      const res = await apiFetch("/workouts", token);
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setWorkouts(await res.json());
    } catch {
      setError("Can't reach server — make sure the API is running.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchWorkouts(); }, [fetchWorkouts]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const payload = {
      exercise: formData.exercise,
      sets: Number(formData.sets),
      reps: Number(formData.reps),
      weight: Number(formData.weight) || 0,
      notes: formData.notes || "",
    };
    try {
      setSubmitting(true);
      const res = await apiFetch(
        editingId ? `/workouts/${editingId}` : "/workouts",
        token,
        { method: editingId ? "PUT" : "POST", body: JSON.stringify(payload) }
      );
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) throw new Error();
      setFormData(EMPTY_FORM); setEditingId(null); setActiveTab("dashboard");
      fetchWorkouts();
    } catch {
      setError("Failed to save workout. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = w => {
    setFormData({ exercise:w.exercise, sets:String(w.sets), reps:String(w.reps),
      weight:w.weight>0 ? String(w.weight) : "", notes:w.notes||"" });
    setEditingId(w.id); setActiveTab("log");
  };

  const handleDelete = async id => {
    try {
      const res = await apiFetch(`/workouts/${id}`, token, { method:"DELETE" });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) throw new Error();
      fetchWorkouts();
    } catch { setError("Failed to delete workout. Please try again."); }
  };

  // Derived data
  const groups = ["All", ...Object.keys(GROUP_COLORS)];
  const filtered = useMemo(() =>
    workouts.filter(w => filterGroup === "All" || (w.muscle_group||"Other") === filterGroup),
    [workouts, filterGroup]);

  const stats = useMemo(() => {
    const totalVol = workouts.reduce((s,w) => s+(w.weight>0 ? w.sets*w.reps*w.weight : w.sets*w.reps), 0);
    const uniqueDays = new Set(workouts.map(w => utcDateKey(w.created_at))).size;
    const groupCounts = {};
    workouts.forEach(w => { const g=w.muscle_group||"Other"; groupCounts[g]=(groupCounts[g]||0)+1; });
    const streak = (() => {
      const cur = new Date();
      const days = [...new Set(workouts.map(w => utcDateKey(w.created_at)))].sort().reverse();
      let s=0;
      for (const key of days) {
        const exp = `${cur.getUTCFullYear()}-${cur.getUTCMonth()}-${cur.getUTCDate()}`;
        if (key===exp) { s++; cur.setUTCDate(cur.getUTCDate()-1); } else break;
      }
      return s;
    })();
    const prMap = {};
    workouts.forEach(w => {
      if (w.weight<=0) return;
      const k=w.exercise.toLowerCase().trim();
      if (!prMap[k]||w.weight>prMap[k].weight)
        prMap[k]={exercise:w.exercise,weight:w.weight,date:formatDate(w.created_at),group:w.muscle_group||"Other"};
    });
    const topPRs = Object.values(prMap).sort((a,b) => b.weight-a.weight).slice(0,5);
    const sessionVols = {};
    workouts.forEach(w => {
      const k=utcDateKey(w.created_at);
      sessionVols[k]=(sessionVols[k]||0)+(w.weight>0?w.sets*w.reps*w.weight:w.sets*w.reps);
    });
    const bestSession = Math.max(0,...Object.values(sessionVols));
    return { totalVol, uniqueDays, streak, groupCounts, topPRs, bestSession };
  }, [workouts]);

  const groupColor = previewGroup ? (GROUP_COLORS[previewGroup]||"#6b7280") : null;

  const getTabStyle = active => ({
    padding:"8px 18px", borderRadius:"8px", border:"none", cursor:"pointer",
    fontSize:"13px", fontWeight:600, transition:"all 0.15s",
    background: active ? "var(--tab-active-bg)" : "transparent",
    color: active ? "var(--tab-active-clr)" : "var(--tab-clr)",
    letterSpacing:"0.02em",
  });

  // ── Show auth screen if not logged in ────────────────────────────────────────
  if (!token || !currentUser) {
    return <AuthScreen onAuth={handleAuth} dark={dark} />;
  }

  const TABS = ["dashboard","recommendations","insights","progress","log","history"];

  // ── Main app ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...themeVars, minHeight:"100vh", background:"var(--bg-page)",
      fontFamily:"'DM Sans','Segoe UI',sans-serif", color:"var(--text)", transition:"background 0.25s, color 0.25s" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}} *{box-sizing:border-box;}`}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom:"1px solid var(--border)", padding:"0 32px", position:"sticky",
        top:0, zIndex:100, backdropFilter:"blur(12px)", background:"var(--header-bg)" }}>
        <div style={{ maxWidth:"1200px", margin:"0 auto", display:"flex", alignItems:"center",
          justifyContent:"space-between", height:"60px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <div style={{ width:"28px", height:"28px", borderRadius:"8px",
              background:"linear-gradient(135deg, var(--accent), var(--accent-dk))",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6.5 6.5h11M6.5 17.5h11M3 12h18M8 4v16M16 4v16"/>
              </svg>
            </div>
            <span style={{ fontWeight:800, fontSize:"18px", letterSpacing:"-0.5px" }}>FitWise</span>
          </div>

          <nav style={{ display:"flex", gap:"4px" }}>
            {TABS.map(tab => (
              <button key={tab} style={getTabStyle(activeTab===tab)} onClick={() => setActiveTab(tab)}>
                {tab === "recommendations" ? "Coach" : tab.charAt(0).toUpperCase()+tab.slice(1)}
              </button>
            ))}
          </nav>

          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            {/* User badge */}
            <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"6px 12px",
              borderRadius:"10px", background:"var(--bg-input)", border:"1px solid var(--border-in)" }}>
              <div style={{ width:"22px", height:"22px", borderRadius:"50%",
                background:"linear-gradient(135deg, var(--accent), var(--accent-dk))",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:"10px", fontWeight:800, color:"var(--accent-text)" }}>
                {(currentUser.display_name||currentUser.username).charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize:"13px", fontWeight:600, color:"var(--text-sec)" }}>
                {currentUser.display_name || currentUser.username}
              </span>
            </div>
            <button onClick={toggleTheme} title={dark?"Light mode":"Dark mode"} style={{
              width:"36px", height:"36px", borderRadius:"10px",
              border:"1px solid var(--border-in)", background:"var(--bg-input)",
              cursor:"pointer", fontSize:"16px", display:"flex", alignItems:"center",
              justifyContent:"center", transition:"all 0.2s",
            }}>{dark?"☀️":"🌙"}</button>
            <button onClick={() => { setActiveTab("log"); setEditingId(null); setFormData(EMPTY_FORM); }} style={{
              background:"linear-gradient(135deg, var(--accent), var(--accent-dk))", color:"var(--accent-text)",
              border:"none", borderRadius:"10px", padding:"8px 18px",
              fontSize:"13px", fontWeight:700, cursor:"pointer",
            }}>+ Log</button>
            <button onClick={handleLogout} style={{
              background:"transparent", border:"1px solid var(--border-in)",
              color:"var(--text-ter)", borderRadius:"10px", padding:"8px 12px",
              fontSize:"13px", fontWeight:600, cursor:"pointer",
            }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:"1200px", margin:"0 auto", padding:"32px" }}>
        {error && (
          <div style={{ background:"var(--error-bg)", border:"1px solid var(--error-bd)",
            borderRadius:"12px", padding:"12px 16px", marginBottom:"24px",
            color:"#ef4444", fontSize:"13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            {error}
            <button onClick={() => setError(null)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:"18px" }}>×</button>
          </div>
        )}

        {/* ── DASHBOARD ──────────────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div>
            <div style={{ marginBottom:"28px" }}>
              <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", margin:0 }}>
                {currentUser.display_name ? `Hey, ${currentUser.display_name.split(" ")[0]} 👋` : "Your Dashboard"}
              </h2>
              <p style={{ color:"var(--text-sec)", fontSize:"14px", marginTop:"4px" }}>Track your progress and stay consistent</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"16px", marginBottom:"16px" }}>
              <StatCard label="Total Workouts" value={workouts.length} sub="All time" accent="#a3e635"/>
              <StatCard label="Total Volume" value={stats.totalVol>=1000?`${(stats.totalVol/1000).toFixed(1)}k`:Math.round(stats.totalVol).toLocaleString()} sub="Sets × Reps × Weight" accent="#3b82f6"/>
              <StatCard label="Active Days" value={stats.uniqueDays} sub="Days trained" accent="#f97316"/>
              <StatCard label="Streak" value={`${stats.streak}d`} sub={stats.streak>0?"Keep it up!":"Start today"} accent="#ec4899"/>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"16px", marginBottom:"16px" }}>
              <StatCard label="Best Session" value={stats.bestSession>=1000?`${(stats.bestSession/1000).toFixed(1)}k`:Math.round(stats.bestSession).toLocaleString()} sub="Single day record" accent="#a78bfa"/>
              <StatCard label="Exercises" value={new Set(workouts.map(w=>w.exercise.toLowerCase())).size} sub="Unique exercises" accent="#34d399"/>
              <StatCard label="PRs" value={stats.topPRs.length} sub="Exercises with weight" accent="#f59e0b"/>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px", marginBottom:"16px" }}>
              <div style={S.card}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>This Week</div>
                <WeekGrid workouts={workouts}/>
              </div>
              <div style={S.card}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"8px" }}>Volume (last 8 sessions)</div>
                <VolumeChart workouts={workouts}/>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"16px" }}>
              <div style={S.card}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>Muscle Groups</div>
                {!Object.keys(stats.groupCounts).length
                  ? <div style={{ color:"var(--text-ter)", fontSize:"13px" }}>No data yet</div>
                  : Object.entries(stats.groupCounts).sort((a,b)=>b[1]-a[1]).map(([g,c]) => (
                    <MiniBar key={g} label={g} value={c} max={Math.max(...Object.values(stats.groupCounts))} color={GROUP_COLORS[g]||"#6b7280"}/>
                  ))
                }
              </div>
              <div style={S.card}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>Personal Records 🏆</div>
                {!stats.topPRs.length
                  ? <div style={{ color:"var(--text-ter)", fontSize:"13px" }}>Log workouts with weight to see PRs</div>
                  : stats.topPRs.map((pr,i) => <PRCard key={i} exercise={pr.exercise} weight={pr.weight} date={pr.date} color={GROUP_COLORS[pr.group]||"#6b7280"}/>)
                }
              </div>
              <div style={S.card}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>Recent Activity</div>
                {!workouts.length
                  ? <div style={{ color:"var(--text-ter)", fontSize:"13px" }}>No workouts logged yet</div>
                  : workouts.slice(0,5).map(w => {
                    const g=w.muscle_group||"Other"; const c=GROUP_COLORS[g]||"#6b7280";
                    return (
                      <div key={w.id} style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                        <div style={{ width:"6px", height:"6px", borderRadius:"50%", background:c, flexShrink:0 }}/>
                        <span style={{ flex:1, fontSize:"13px", color:"var(--text-sec)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{w.exercise}</span>
                        <span style={{ fontSize:"11px", color:c, fontWeight:600, flexShrink:0 }}>{g}</span>
                        <span style={{ fontSize:"11px", color:"var(--text-ter)", flexShrink:0 }}>{formatDate(w.created_at)}</span>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </div>
        )}

        {/* ── RECOMMENDATIONS (COACH) ────────────────────────────────────────── */}
        {activeTab === "recommendations" && (
          <div>
            <div style={{ marginBottom:"28px" }}>
              <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", margin:0 }}>AI Coach</h2>
              <p style={{ color:"var(--text-sec)", fontSize:"14px", marginTop:"4px" }}>
                Personalised recommendations based on your training history
              </p>
            </div>
            <RecommendationsPanel token={token} workoutCount={workouts.length}/>
          </div>
        )}

        {/* ── INSIGHTS ──────────────────────────────────────────────────────── */}
        {activeTab === "insights" && (
          <div>
            <div style={{ marginBottom:"28px" }}>
              <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", margin:0 }}>Training Insights</h2>
              <p style={{ color:"var(--text-sec)", fontSize:"14px", marginTop:"4px" }}>Smart analysis of your training patterns</p>
            </div>
            <TrainingInsights workouts={workouts} stats={stats}/>
            {workouts.length > 0 && (
              <div style={{ marginTop:"28px" }}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>Volume Breakdown</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
                  <div style={S.card}>
                    <div style={{ fontSize:"13px", color:"var(--text-sec)", marginBottom:"14px" }}>Sessions per group</div>
                    {Object.entries(stats.groupCounts).sort((a,b)=>b[1]-a[1]).map(([g,c]) => (
                      <MiniBar key={g} label={g} value={c} max={Math.max(...Object.values(stats.groupCounts))} color={GROUP_COLORS[g]||"#6b7280"}/>
                    ))}
                  </div>
                  <div style={S.card}>
                    <div style={{ fontSize:"13px", color:"var(--text-sec)", marginBottom:"14px" }}>Top personal records</div>
                    {stats.topPRs.length
                      ? stats.topPRs.map((pr,i) => <PRCard key={i} exercise={pr.exercise} weight={pr.weight} date={pr.date} color={GROUP_COLORS[pr.group]||"#6b7280"}/>)
                      : <div style={{ color:"var(--text-ter)", fontSize:"13px" }}>No weighted exercises yet</div>
                    }
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PROGRESS ──────────────────────────────────────────────────────── */}
        {activeTab === "progress" && (
          <div>
            <div style={{ marginBottom:"28px" }}>
              <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", margin:0 }}>Progression Charts</h2>
              <p style={{ color:"var(--text-sec)", fontSize:"14px", marginTop:"4px" }}>Visualise your strength gains over time</p>
            </div>
            <div style={S.card}>
              <ProgressionChart workouts={workouts}/>
            </div>
            {stats.topPRs.length > 0 && (
              <div style={{ ...S.card, marginTop:"16px" }}>
                <div style={{ fontSize:"11px", color:"var(--text-sec)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"16px" }}>All-time PRs with estimated 1RM</div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"13px" }}>
                    <thead><tr>
                      {["Exercise","Group","Best Weight","Sets×Reps","Est. 1RM","Date"].map(h => (
                        <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:"11px",
                          color:"var(--text-ter)", fontWeight:700, textTransform:"uppercase",
                          letterSpacing:"0.06em", borderBottom:"1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {stats.topPRs.map((pr,i) => {
                        const raw = workouts.find(w => w.exercise===pr.exercise && w.weight===pr.weight);
                        const orm = raw ? epley1RM(raw.weight, raw.reps) : "—";
                        return (
                          <tr key={i} style={{ borderBottom:"1px solid var(--border)" }}
                            onMouseEnter={e => e.currentTarget.style.background="var(--bg-card-hov)"}
                            onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                            <td style={{ padding:"10px", color:"var(--text)", fontWeight:600 }}>{pr.exercise}</td>
                            <td style={{ padding:"10px" }}><span style={{ background:`${GROUP_COLORS[pr.group]||"#6b7280"}22`, color:GROUP_COLORS[pr.group]||"#6b7280", padding:"2px 8px", borderRadius:"6px", fontSize:"11px", fontWeight:700 }}>{pr.group}</span></td>
                            <td style={{ padding:"10px", fontFamily:"monospace", color:"var(--accent)", fontWeight:700 }}>{fmtWeight(pr.weight)}</td>
                            <td style={{ padding:"10px", color:"var(--text-sec)", fontFamily:"monospace" }}>{raw?`${raw.sets}×${raw.reps}`:"—"}</td>
                            <td style={{ padding:"10px", fontFamily:"monospace", color:"#f97316", fontWeight:700 }}>{orm?`${orm} lbs`:"—"}</td>
                            <td style={{ padding:"10px", color:"var(--text-ter)" }}>{pr.date}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LOG ───────────────────────────────────────────────────────────── */}
        {activeTab === "log" && (
          <div style={{ maxWidth:"520px", margin:"0 auto" }}>
            <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", marginBottom:"8px" }}>
              {editingId ? "Edit Workout" : "Log a Workout"}
            </h2>
            <p style={{ color:"var(--text-sec)", fontSize:"14px", marginBottom:"28px" }}>
              {editingId ? "Update the details below" : "Record your sets, reps, weight, and progress"}
            </p>
            <form onSubmit={handleSubmit}>
              <div style={{ display:"grid", gap:"12px" }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"6px" }}>
                    <label style={{ ...S.label, margin:0 }}>Exercise</label>
                    {previewGroup && (
                      <div style={{ display:"inline-flex", alignItems:"center",
                        padding:"3px 10px", borderRadius:"99px", fontSize:"11px", fontWeight:700,
                        background:`${groupColor}20`, border:`1px solid ${groupColor}50`, color:groupColor,
                        transition:"all 0.2s" }}>
                        {previewGroup}
                      </div>
                    )}
                  </div>
                  <input placeholder="e.g. Bench Press, Bulgarian Split Squat…" value={formData.exercise} required
                    onChange={e => setFormData({...formData, exercise:e.target.value})}
                    style={S.input}
                    onFocus={e => e.target.style.borderColor="var(--accent)"}
                    onBlur={e => e.target.style.borderColor="var(--border-in)"}
                  />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"12px" }}>
                  {[
                    {name:"sets",placeholder:"3",label:"Sets",type:"number",min:"1"},
                    {name:"reps",placeholder:"10",label:"Reps",type:"number",min:"1"},
                    {name:"weight",placeholder:"0",label:"Weight (lbs)",type:"number",min:"0",step:"0.5"},
                  ].map(({name,placeholder,label,type,min,step}) => (
                    <div key={name}>
                      <label style={S.label}>
                        {label}{name==="weight"&&<span style={{ color:"var(--text-ter)", fontWeight:400, textTransform:"none" }}> (opt)</span>}
                      </label>
                      <input name={name} type={type} placeholder={placeholder} value={formData[name]}
                        required={name!=="weight"} min={min} step={step}
                        onChange={e => setFormData({...formData,[e.target.name]:e.target.value})}
                        style={S.input}
                        onFocus={e => e.target.style.borderColor="var(--accent)"}
                        onBlur={e => e.target.style.borderColor="var(--border-in)"}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <label style={S.label}>Notes <span style={{ color:"var(--text-ter)", fontWeight:400, textTransform:"none" }}>(optional)</span></label>
                  <input placeholder="PR? How did it feel?" value={formData.notes}
                    onChange={e => setFormData({...formData,notes:e.target.value})}
                    style={S.input}
                    onFocus={e => e.target.style.borderColor="var(--accent)"}
                    onBlur={e => e.target.style.borderColor="var(--border-in)"}
                  />
                </div>
                <div style={{ display:"flex", gap:"10px", marginTop:"4px" }}>
                  <button type="submit" disabled={submitting} style={{
                    flex:1, background:"linear-gradient(135deg, var(--accent), var(--accent-dk))",
                    color:"var(--accent-text)", border:"none", borderRadius:"12px", padding:"13px",
                    fontSize:"14px", fontWeight:700, cursor:submitting?"not-allowed":"pointer",
                    opacity:submitting?0.7:1, transition:"opacity 0.15s",
                  }}>{submitting?"Saving…":editingId?"Save Changes":"Log Workout"}</button>
                  {editingId && (
                    <button type="button" onClick={() => {setFormData(EMPTY_FORM);setEditingId(null);}} style={{
                      background:"var(--bg-input)", border:"1px solid var(--border-in)",
                      color:"var(--text-sec)", borderRadius:"12px", padding:"13px 20px",
                      fontSize:"14px", fontWeight:600, cursor:"pointer",
                    }}>Cancel</button>
                  )}
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ── HISTORY ───────────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
              marginBottom:"24px", flexWrap:"wrap", gap:"12px" }}>
              <div>
                <h2 style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.8px", margin:0 }}>Workout History</h2>
                <p style={{ color:"var(--text-sec)", fontSize:"14px", marginTop:"4px" }}>{filtered.length} workout{filtered.length!==1?"s":""} found</p>
              </div>
              <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
                style={{ ...S.input, width:"auto", padding:"8px 12px", fontSize:"13px" }}>
                {groups.map(g => <option key={g} value={g}>{g==="All"?"All Groups":g}</option>)}
              </select>
            </div>
            {loading ? (
              <div style={{ textAlign:"center", color:"var(--text-ter)", padding:"64px" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:"center", padding:"64px", color:"var(--text-ter)" }}>
                <div style={{ fontSize:"40px", marginBottom:"12px" }}>🏋️</div>
                <div style={{ fontSize:"15px", fontWeight:600 }}>No workouts found</div>
                <div style={{ fontSize:"13px", marginTop:"6px" }}>Try adjusting your filter or log a workout</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                {filtered.map(w => <WorkoutCard key={w.id} workout={w} onEdit={handleEdit} onDelete={handleDelete}/>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
