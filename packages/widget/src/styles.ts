/** In den Shadow DOM injiziertes CSS – isoliert vom Host-Theme der Kundenseite. */
export const STYLES = /* css */ `
:host, * { box-sizing: border-box; }
.kc-root {
  --kc-primary: #2563eb;
  --kc-bubble: #2563eb;
  --kc-on-primary: #ffffff;
  --kc-bg: #f7f8fa;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  position: fixed;
  z-index: 2147483000;
  bottom: 20px;
}
.kc-root.kc-right { right: 20px; }
.kc-root.kc-left { left: 20px; }

.kc-launcher {
  width: 60px; height: 60px; border-radius: 50%;
  background: var(--kc-bubble); color: var(--kc-on-primary);
  border: none; padding: 0; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; transition: transform .15s ease;
}
.kc-launcher:hover { transform: scale(1.06); }
.kc-launcher { overflow: hidden; }
.kc-launcher-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; }

.kc-teaser {
  position: absolute; bottom: 80px; width: 220px; max-width: calc(100vw - 40px); min-height: 22px;
  background: #fff; color: #111; border-radius: 16px; padding: 13px 30px 13px 16px;
  box-shadow: 0 8px 28px rgba(0,0,0,.18); font-size: 14px; line-height: 1.5;
  cursor: pointer; transform-origin: bottom right; animation: kc-bubble-in .28s cubic-bezier(.18,.9,.32,1.2);
}
.kc-root.kc-right .kc-teaser { right: 6px; }
.kc-root.kc-left .kc-teaser { left: 6px; transform-origin: bottom left; }
/* Sprechblasen-Pfeil nach unten Richtung Launcher */
.kc-teaser::after {
  content: ''; position: absolute; bottom: -8px; width: 0; height: 0;
  border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 9px solid #fff;
  filter: drop-shadow(0 4px 3px rgba(0,0,0,.06));
}
.kc-root.kc-right .kc-teaser::after { right: 22px; }
.kc-root.kc-left .kc-teaser::after { left: 22px; }
.kc-teaser-close { position:absolute; top:6px; right:9px; border:none; background:none; cursor:pointer; color:#bbb; font-size:15px; line-height:1; }
.kc-teaser-cursor { display:inline-block; width:1px; margin-left:1px; animation: kc-blink 1s step-end infinite; }
@keyframes kc-bubble-in { from { opacity:0; transform: scale(.6) translateY(10px); } to { opacity:1; transform: scale(1) translateY(0); } }

.kc-panel {
  position: absolute; bottom: 74px; width: 360px; max-width: calc(100vw - 32px);
  height: 520px; max-height: calc(100vh - 120px);
  background: #fff; border-radius: 16px; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,.28); display: flex; flex-direction: column;
  animation: kc-pop .18s ease;
}
.kc-root.kc-right .kc-panel { right: 0; }
.kc-root.kc-left .kc-panel { left: 0; }

/* Bei eingebetteter Terminbuchung: Panel breiter & höher, Iframe groß genug ohne Scrollen */
.kc-panel.kc-wide { width: 560px; height: 760px; max-height: calc(100vh - 32px); transition: width .2s ease, height .2s ease; }
.kc-panel.kc-wide .kc-embed iframe { height: min(620px, calc(100vh - 210px)); }

.kc-header {
  background: var(--kc-primary); color: var(--kc-on-primary);
  padding: 14px 16px; font-weight: 600; display:flex; align-items:center; justify-content:space-between;
}
.kc-header button { background:none; border:none; color:inherit; cursor:pointer; font-size:20px; line-height:1; }
.kc-status { font-size:11px; font-weight:500; opacity:.9; margin-top:2px; }
.kc-agent-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:#0f766e; margin-bottom:2px; }

.kc-messages { flex:1; overflow-y:auto; padding:14px; background:var(--kc-bg); display:flex; flex-direction:column; gap:10px; }
.kc-msg { max-width: 85%; padding:10px 13px; border-radius:14px; font-size:14px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word; }
.kc-msg.kc-bot { background:#fff; color:#111; align-self:flex-start; border:1px solid #ececf0; border-bottom-left-radius:4px; }
.kc-msg.kc-user { background:var(--kc-primary); color:var(--kc-on-primary); align-self:flex-end; border-bottom-right-radius:4px; }
.kc-embed { align-self:stretch; width:100%; }
.kc-embed iframe { width:100%; height:440px; border:none; border-radius:12px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.08); }
.kc-typing { align-self:flex-start; background:#fff; border:1px solid #ececf0; border-radius:14px; border-bottom-left-radius:4px; padding:13px 14px; display:flex; gap:4px; }
.kc-typing span { width:7px; height:7px; border-radius:50%; background:#bcbcc6; display:inline-block; animation: kc-blink 1.2s infinite ease-in-out both; }
.kc-typing span:nth-child(2){ animation-delay:.18s; }
.kc-typing span:nth-child(3){ animation-delay:.36s; }
@keyframes kc-blink { 0%,80%,100%{ transform:scale(.6); opacity:.35; } 40%{ transform:scale(1); opacity:1; } }

.kc-quick { display:flex; flex-wrap:wrap; gap:8px; padding:0 14px 8px; background:var(--kc-bg); }
.kc-quick button {
  border:1px solid var(--kc-primary); color:var(--kc-primary); background:#fff;
  border-radius:18px; padding:7px 12px; font-size:13px; cursor:pointer;
}
.kc-quick button:hover { background:var(--kc-primary); color:var(--kc-on-primary); }

.kc-input { display:flex; gap:8px; padding:10px; border-top:1px solid #ececf0; background:#fff; }
.kc-input input { flex:1; border:1px solid #d8d8e0; border-radius:20px; padding:10px 14px; font-size:14px; outline:none; }
.kc-input input:focus { border-color: var(--kc-primary); }
.kc-input button { border:none; background:var(--kc-primary); color:var(--kc-on-primary); border-radius:50%; width:40px; height:40px; cursor:pointer; font-size:16px; }
.kc-input button:disabled { opacity:.5; cursor:default; }

.kc-lead { padding:12px 14px; background:#fff; border-top:1px solid #ececf0; display:flex; flex-direction:column; gap:8px; }
.kc-lead input { border:1px solid #d8d8e0; border-radius:8px; padding:9px 11px; font-size:14px; }
.kc-lead button { border:none; background:var(--kc-primary); color:var(--kc-on-primary); border-radius:8px; padding:10px; font-size:14px; cursor:pointer; }
.kc-foot { text-align:center; font-size:11px; color:#aaa; padding:6px; background:#fff; }

@keyframes kc-pop { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
`;
