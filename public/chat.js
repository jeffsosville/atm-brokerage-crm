/* Sosville website chat widget (replaces Drift).
   Add to the site, before </body>:
     <script src="https://atm-brokerage-crm.vercel.app/chat.js" data-brand="atm" defer></script>
   data-brand: atm | vending | cleaning
   data-teaser: seconds before the "Questions? Ask me" bubble shows (default 12; "off" to disable) */
(function () {
  if (window.__sosChat) return;
  window.__sosChat = true;
  var s = document.currentScript || document.querySelector('script[src*="/chat.js"]');
  if (!s) return;
  var origin = new URL(s.src).origin;
  var brand = s.getAttribute("data-brand") || "atm";
  var teaserAfter = s.getAttribute("data-teaser");
  var ACCENT = { atm: "#3b82f6", vending: "#d97706", cleaning: "#059669" }[brand] || "#3b82f6";
  var Z = 2147483000;
  var ss = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
  };

  var css = document.createElement("style");
  css.textContent =
    "#sos-chat-btn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:" + ACCENT + ";box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:" + Z + ";display:flex;align-items:center;justify-content:center;padding:0}" +
    "#sos-chat-btn svg{width:28px;height:28px}" +
    "#sos-chat-panel{position:fixed;right:20px;bottom:90px;width:380px;height:min(600px,calc(100vh - 110px));border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:" + Z + ";display:none;background:#fff}" +
    "#sos-chat-panel iframe{width:100%;height:100%;border:0}" +
    "#sos-chat-teaser{position:fixed;right:88px;bottom:30px;max-width:230px;background:#fff;color:#111827;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:10px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:" + Z + ";cursor:pointer;display:none}" +
    "@media (max-width:480px){#sos-chat-panel{right:0;bottom:0;width:100%;height:100%;border-radius:0}#sos-chat-panel.open~#sos-chat-btn{display:none}}";
  document.head.appendChild(css);

  var panel = document.createElement("div");
  panel.id = "sos-chat-panel";
  var btn = document.createElement("button");
  btn.id = "sos-chat-btn";
  btn.setAttribute("aria-label", "Open chat");
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  btn.innerHTML = ICON_CHAT;
  var teaser = document.createElement("div");
  teaser.id = "sos-chat-teaser";
  teaser.textContent = /\/atm-route-for-sale\/|\/listing\//i.test(location.pathname)
    ? "Questions about this listing? Ask me."
    : "Buying or selling? Ask me anything.";

  document.body.appendChild(panel);
  document.body.appendChild(btn);
  document.body.appendChild(teaser);

  var open = false, loaded = false;
  function setOpen(v) {
    open = v;
    if (v && !loaded) {
      var f = document.createElement("iframe");
      f.title = "Chat";
      f.allow = "clipboard-write";
      f.src = origin + "/chat?brand=" + encodeURIComponent(brand) + "&page=" + encodeURIComponent(location.origin + location.pathname);
      panel.appendChild(f);
      loaded = true;
    }
    panel.style.display = v ? "block" : "none";
    panel.className = v ? "open" : "";
    btn.innerHTML = v ? ICON_X : ICON_CHAT;
    btn.setAttribute("aria-label", v ? "Close chat" : "Open chat");
    teaser.style.display = "none";
    if (v) ss.set("sos_chat_teased", "1");
  }
  btn.addEventListener("click", function () { setOpen(!open); });
  teaser.addEventListener("click", function () { setOpen(true); });
  window.addEventListener("message", function (e) {
    if (e.origin === origin && e.data && e.data.type === "sc-close") setOpen(false);
  });

  if (teaserAfter !== "off" && !ss.get("sos_chat_teased")) {
    setTimeout(function () {
      if (!open) { teaser.style.display = "block"; ss.set("sos_chat_teased", "1"); }
    }, (Number(teaserAfter) || 12) * 1000);
  }
})();
