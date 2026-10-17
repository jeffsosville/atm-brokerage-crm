/* ATM Brokerage website chat. Add to a site with:
 *   <script src="https://dealroom.sosville.co/chat.js" async></script>
 * Talks to /api/site-chat on the same host the script came from. */
(function () {
  if (window.__sosChat) return;
  window.__sosChat = true;
  var me = document.currentScript || document.querySelector('script[src*="/chat.js"]');
  var API = new URL(me && me.src ? me.src : location.href).origin + "/api/site-chat";
  var ACCENT = (me && me.getAttribute("data-accent")) || "#1d4ed8";
  var GREETING = (me && me.getAttribute("data-greeting")) ||
    "Hi! Looking to buy an ATM route, or thinking about selling one? Ask me anything about our listings.";

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function rid() { var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  var visitorId = store("sos_chat_vid") || rid(); store("sos_chat_vid", visitorId);
  var sessionId = store("sos_chat_sid") || "";
  var mem = { open: store("sos_chat_open") === "1" };

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    '<style>' +
    ':host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '.btn{width:58px;height:58px;border-radius:50%;border:0;background:' + ACCENT + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;margin-left:auto}' +
    '.btn svg{width:28px;height:28px}' +
    '.panel{display:none;flex-direction:column;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 100px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;margin-bottom:12px}' +
    '.open .panel{display:flex}.open .btn{display:none}' +
    '.head{background:' + ACCENT + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
    '.head b{font-size:15px;display:block}.head span{font-size:12px;opacity:.85}.x{margin-left:auto;background:none;border:0;color:#fff;font-size:24px;cursor:pointer;line-height:1}' +
    '.log{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}' +
    '.m{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;color:#0f172a}' +
    '.m a{color:' + ACCENT + '}.b{background:#fff;border:1px solid #e2e8f0;align-self:flex-start;border-bottom-left-radius:4px}' +
    '.v{background:' + ACCENT + ';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}.v a{color:#fff}' +
    '.typing{align-self:flex-start;color:#64748b;font-size:13px;padding:4px 6px}' +
    'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}' +
    'textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:14px;height:42px;max-height:110px;outline:none;color:#0f172a}' +
    'textarea:focus{border-color:' + ACCENT + '}' +
    '.send{border:0;background:' + ACCENT + ';color:#fff;border-radius:10px;padding:0 14px;font-size:14px;font-weight:600;cursor:pointer}.send:disabled{opacity:.5}' +
    '.foot{font-size:11px;color:#94a3b8;text-align:center;padding:0 0 8px;background:#fff}' +
    '@media (max-width:480px){.panel{width:calc(100vw - 32px);height:calc(100vh - 110px)}}' +
    '</style>' +
    '<div class="wrap">' +
    '<div class="panel" role="dialog" aria-label="Chat with ATM Brokerage">' +
    '<div class="head"><div><b>ATM Brokerage</b><span>Ask about listings, buying or selling</span></div><button class="x" aria-label="Close chat">&times;</button></div>' +
    '<div class="log" aria-live="polite"></div>' +
    '<form><textarea placeholder="Type your message…" aria-label="Message" maxlength="1000"></textarea><button class="send" type="submit">Send</button></form>' +
    '<div class="foot">Automated assistant · a person follows up</div>' +
    '</div>' +
    '<button class="btn" aria-label="Open chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>' +
    '</div>';

  var wrap = root.querySelector(".wrap"), log = root.querySelector(".log"), form = root.querySelector("form");
  var ta = root.querySelector("textarea"), send = root.querySelector(".send");
  var loaded = false, busy = false;

  function linkify(el, text) {
    var re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement("a"); a.href = m[1]; a.textContent = m[1].replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""); a.target = "_top";
      el.appendChild(a); last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  function add(role, text) {
    var d = document.createElement("div"); d.className = "m " + (role === "visitor" ? "v" : "b");
    linkify(d, text); log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function load() {
    if (loaded) return; loaded = true;
    if (!sessionId) { add("assistant", GREETING); return; }
    fetch(API + "?visitorId=" + visitorId + "&sessionId=" + sessionId).then(function (r) { return r.json(); }).then(function (d) {
      add("assistant", GREETING);
      (d.messages || []).forEach(function (m) { add(m.role, m.content); });
    }).catch(function () { add("assistant", GREETING); });
  }
  function setOpen(o) { mem.open = o; store("sos_chat_open", o ? "1" : "0"); wrap.classList.toggle("open", o); if (o) { load(); setTimeout(function () { ta.focus(); }, 50); } }

  root.querySelector(".btn").onclick = function () { setOpen(true); };
  root.querySelector(".x").onclick = function () { setOpen(false); };
  ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); } });
  form.onsubmit = function (e) {
    e.preventDefault();
    var text = ta.value.trim(); if (!text || busy) return;
    busy = true; send.disabled = true; ta.value = ""; add("visitor", text);
    var t = document.createElement("div"); t.className = "typing"; t.textContent = "Typing…"; log.appendChild(t); log.scrollTop = log.scrollHeight;
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitorId, sessionId: sessionId, message: text, page: location.href }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.sessionId) { sessionId = d.sessionId; store("sos_chat_sid", sessionId); } add("assistant", d.reply || "Sorry, something went wrong. Please email info@atmbrokerage.com."); })
      .catch(function () { add("assistant", "Sorry, I couldn't connect. Please email info@atmbrokerage.com or call +1 888-430-5535."); })
      .then(function () { t.remove(); busy = false; send.disabled = false; ta.focus(); });
  };

  function mount() { document.body.appendChild(host); if (mem.open) setOpen(true); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
