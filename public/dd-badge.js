/* ATM Brokerage — Due Diligence transparency badge.
   Usage on a listing page:
     <div data-atm-dd="DL-2026-ATM-00032"></div>
     <script src="https://atm-brokerage-crm.vercel.app/dd-badge.js" async></script>
*/
(function () {
  var s = document.currentScript || document.querySelector('script[src*="dd-badge.js"]');
  var ORIGIN = s ? new URL(s.src).origin : "https://atm-brokerage-crm.vercel.app";
  var CSS = ".atmdd{font-family:inherit;border:1px solid #d9dee7;border-radius:10px;padding:18px 20px;margin:20px 0;background:#fff;color:#1f2937;max-width:680px}" +
    ".atmdd h4{margin:0 0 2px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1f3864}" +
    ".atmdd .row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px}" +
    ".atmdd .big{font-size:34px;font-weight:700;line-height:1}" +
    ".atmdd .bar{flex:1;min-width:160px;height:10px;background:#eef1f5;border-radius:6px;overflow:hidden}" +
    ".atmdd .bar i{display:block;height:100%}" +
    ".atmdd .meta{font-size:13px;color:#4b5563;margin-top:8px}" +
    ".atmdd button{margin-top:10px;background:none;border:1px solid #c7ced9;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;color:#1f3864}" +
    ".atmdd .list{margin-top:12px;display:none}.atmdd.open .list{display:block}" +
    ".atmdd .sec{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;margin:12px 0 4px}" +
    ".atmdd .it{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:5px 0;border-bottom:1px solid #f1f3f6}" +
    ".atmdd .st{font-size:12px;font-weight:700;white-space:nowrap}" +
    ".atmdd .v{color:#6b7280;font-size:12px}.atmdd .foot{font-size:12px;color:#6b7280;margin-top:12px}";
  var ST = {
    verified: ["✓ Verified", "#15803d"], provided: ["Provided", "#1d4ed8"], partial: ["Partial", "#b45309"],
    requested: ["Requested", "#7c3aed"], pending: ["Pending", "#9ca3af"], not_provided: ["Not provided", "#6b7280"]
  };
  function esc(t) { var d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
  function render(el, d) {
    var col = d.score >= 80 ? "#15803d" : d.score >= 50 ? "#b45309" : "#b91c1c";
    var provided = d.counts.verified + d.counts.provided;
    var h = '<h4>Due diligence transparency</h4>' +
      '<div class="row"><div class="big" style="color:' + col + '">' + d.score + '%</div>' +
      '<div class="bar"><i style="width:' + d.score + '%;background:' + col + '"></i></div></div>' +
      '<div class="meta">' + provided + ' of ' + d.total + ' checklist items provided by the seller · ' +
      d.counts.verified + ' verified by ATM Brokerage' + (d.counts.requested ? ' · ' + d.counts.requested + ' requested' : '') + '</div>' +
      '<button type="button">See the checklist</button><div class="list">';
    d.sections.forEach(function (sec) {
      h += '<div class="sec">' + esc(sec.name) + '</div>';
      sec.items.forEach(function (it) {
        var s = ST[it.status] || ST.pending;
        h += '<div class="it"><span>' + esc(it.label) + (it.value ? '<div class="v">' + esc(it.value) + '</div>' : '') +
          '</span><span class="st" style="color:' + s[1] + '">' + s[0] + '</span></div>';
      });
    });
    h += '<div class="foot">We check every listing against our due diligence checklist and show buyers exactly what has been provided. ' +
      'Financials, locations and contracts are shared after an NDA.' + (d.updated_at ? ' Updated ' + new Date(d.updated_at).toLocaleDateString() + '.' : '') + '</div></div>';
    el.className = "atmdd";
    el.innerHTML = h;
    el.querySelector("button").onclick = function () {
      el.classList.toggle("open");
      this.textContent = el.classList.contains("open") ? "Hide the checklist" : "See the checklist";
    };
  }
  function init() {
    if (!document.getElementById("atmdd-css")) {
      var st = document.createElement("style"); st.id = "atmdd-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    document.querySelectorAll("[data-atm-dd]").forEach(function (el) {
      if (el.dataset.atmDdDone) return; el.dataset.atmDdDone = "1";
      fetch(ORIGIN + "/api/public/dd/" + encodeURIComponent(el.getAttribute("data-atm-dd")))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.sections) render(el, d); })
        .catch(function () {});
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
