/* Beyondia: the small amount of script the site uses. Everything works without it;
   it adds the theme toggle, the mobile menu, a reading-progress fallback, the search
   and the checks and email layout of the application form. */
(function () {
  "use strict";
  var root = document.documentElement;
  var KEY = "beyondia-theme";
  var THEME_COLOR = { classic: "#003049", light: "#F4BF96" };

  /* ---------- theme ---------- */
  function currentTheme() { return root.getAttribute("data-theme") === "light" ? "light" : "classic"; }

  function applyTheme(theme, save) {
    if (theme === "light") { root.setAttribute("data-theme", "light"); } else { root.removeAttribute("data-theme"); }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute("content", THEME_COLOR[theme]); }
    var buttons = document.querySelectorAll(".theme-toggle");
    for (var i = 0; i < buttons.length; i++) { buttons[i].setAttribute("aria-pressed", theme === "light" ? "true" : "false"); }
    if (save) { try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode: the choice just is not remembered */ } }
  }

  var toggles = document.querySelectorAll(".theme-toggle");
  for (var t = 0; t < toggles.length; t++) {
    toggles[t].addEventListener("click", function () { applyTheme(currentTheme() === "light" ? "classic" : "light", true); });
  }
  applyTheme(currentTheme(), false);

  /* ---------- mobile menu ---------- */
  var button = document.querySelector(".menu-btn");
  var nav = document.getElementById("main-nav");
  if (button && nav) {
    var setOpen = function (open) {
      nav.classList.toggle("open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    };
    button.addEventListener("click", function () { setOpen(button.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") { setOpen(false); button.focus(); }
    });
  }

  /* ---------- reading progress, for browsers without scroll-driven animations ---------- */
  var supportsTimeline = window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()");
  if (!supportsTimeline && document.querySelector(".story")) {
    var bar = document.createElement("div");
    bar.className = "js-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var ticking = false;
    var update = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty("--read", max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : "0");
      ticking = false;
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------- application form (community page) ----------
     The site has no server, so an application travels as an email from the visitor's own email app
     (mailto:). Without this script the browser checks the fields and hands them to the email app as
     plain lines; with it, mistakes are shown next to the fields in plain words, the email is laid out
     neatly, and the application can be copied when no email app opens. The address is read from the
     form's action, so it is written in one place only. */
  var applyForm = document.getElementById("apply-form");
  if (applyForm) { setupApplication(applyForm); }

  function setupApplication(form) {
    var FIELDS = ["name", "email", "phone", "message"];
    var LIMITS = { name: 100, email: 254, phone: 32, message: 2000 };
    var RULE = "========================";
    var address = form.getAttribute("action").replace(/^mailto:/, "").split("?")[0];
    var status = document.getElementById("apply-status");
    var next = document.getElementById("apply-next");
    var copyText = document.getElementById("apply-copy-text");
    var copyStatus = document.getElementById("apply-copy-status");
    var hints = {};
    FIELDS.forEach(function (name) { hints[name] = form.elements[name].getAttribute("aria-describedby") || ""; });
    form.setAttribute("novalidate", "");

    function value(name) {
      var raw = form.elements[name].value;
      return name === "message" ? raw.replace(/\r\n?/g, "\n").trim() : raw.replace(/\s+/g, " ").trim();
    }

    function problem(name) {
      var v = value(name);
      if (name === "name") {
        if (!v) { return "Enter your name."; }
        if (v.length > LIMITS.name) { return "Use at most " + LIMITS.name + " characters."; }
      } else if (name === "email") {
        if (!v) { return "Enter your email address."; }
        if (v.length > LIMITS.email || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/.test(v)) {
          return "Enter an email address like name@example.com.";
        }
      } else if (name === "phone") {
        if (!v) { return "Enter your phone number."; }
        var digits = v.replace(/\D/g, "").length;
        if (v.length > LIMITS.phone || !/^\+?[0-9()\-.\s]+$/.test(v) || digits < 7 || digits > 15) {
          return "Enter a phone number with 7 to 15 digits, like +44 20 7946 0958.";
        }
      } else if (name === "message") {
        if (!v) { return "Write a few words about yourself."; }
        if (v.length > LIMITS.message) { return "Use at most " + LIMITS.message + " characters."; }
      }
      return "";
    }

    function mark(name, message) {
      var input = form.elements[name];
      var id = input.id + "-error";
      var note = document.getElementById(id);
      if (!message) {
        if (note) { note.parentNode.removeChild(note); }
        input.removeAttribute("aria-invalid");
        if (hints[name]) { input.setAttribute("aria-describedby", hints[name]); } else { input.removeAttribute("aria-describedby"); }
        return;
      }
      if (!note) {
        note = document.createElement("p");
        note.className = "field-error";
        note.id = id;
        input.parentNode.insertBefore(note, input.nextSibling);
      }
      note.textContent = message;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", (id + " " + hints[name]).trim());
    }

    function say(node, text, isError) {
      node.textContent = text;
      node.classList.toggle("is-error", !!isError);
    }

    /* The email itself: plain text (mailto: carries no formatting), laid out to read well in any inbox. */
    function letter() {
      return [
        "NEW MEMBER APPLICATION",
        "Beyondia, a country of ideas",
        RULE,
        "",
        "Name:   " + value("name"),
        "Email:  " + value("email"),
        "Phone:  " + value("phone"),
        "",
        "Message",
        "-------",
        value("message"),
        "",
        RULE,
        "Sent from the application form on the Beyondia website."
      ].join("\n");
    }

    FIELDS.forEach(function (name) {
      var input = form.elements[name];
      input.addEventListener("blur", function () { if (value(name)) { mark(name, problem(name)); } });
      input.addEventListener("input", function () { if (input.getAttribute("aria-invalid") === "true") { mark(name, problem(name)); } });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var first = null;
      var count = 0;
      FIELDS.forEach(function (name) {
        var p = problem(name);
        mark(name, p);
        if (p) { count++; if (!first) { first = form.elements[name]; } }
      });
      if (first) {
        say(status, count === 1 ? "Please correct the field marked above." : "Please correct the " + count + " fields marked above.", true);
        first.focus();
        return;
      }
      say(status, "", false);
      say(copyStatus, "", false);
      var body = letter();
      copyText.value = "To: " + address + "\n\n" + body;
      next.hidden = false;
      document.getElementById("apply-next-title").focus();
      window.location.href = "mailto:" + address +
        "?subject=" + encodeURIComponent("New member application: " + value("name")) +
        "&body=" + encodeURIComponent(body.replace(/\n/g, "\r\n"));
    });

    document.getElementById("apply-copy").addEventListener("click", function () {
      function selectAndAsk() {
        copyText.focus();
        copyText.select();
        var copied = false;
        try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
        say(copyStatus, copied ? "Copied. Paste it into a new email to " + address + "." : "Copying is not allowed here: the text is selected, copy it yourself.", !copied);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyText.value).then(function () {
          say(copyStatus, "Copied. Paste it into a new email to " + address + ".", false);
        }, selectAndAsk);
      } else {
        selectAndAsk();
      }
    });
  }

  /* ---------- search ---------- */
  var form = document.getElementById("search-form");
  if (!form) { return; }
  var input = document.getElementById("search-input");
  var list = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  var index = window.BEYONDIA_INDEX;

  function words(text) { return (text.toLowerCase().match(/[a-z0-9À-ɏ]+/g) || []); }

  function snippet(text, terms) {
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      var found = lower.indexOf(terms[i]);
      if (found !== -1 && (at === -1 || found < at)) { at = found; }
    }
    var start = Math.max(0, at - 70);
    var piece = text.slice(start, start + 220).replace(/\s+/g, " ").trim();
    return (start > 0 ? "…" : "") + piece + (start + 220 < text.length ? "…" : "");
  }

  function highlight(parent, text, terms) {
    var pattern = terms.map(function (term) { return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|");
    if (!pattern) { parent.textContent = text; return; }
    var re = new RegExp("(" + pattern + ")", "gi");
    var last = 0;
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) { parent.appendChild(document.createTextNode(text.slice(last, match.index))); }
      var mark = document.createElement("mark");
      mark.textContent = match[0];
      parent.appendChild(mark);
      last = match.index + match[0].length;
      if (match[0].length === 0) { re.lastIndex++; }
    }
    if (last < text.length) { parent.appendChild(document.createTextNode(text.slice(last))); }
  }

  function run(query) {
    list.textContent = "";
    var terms = words(query);
    if (!index) { status.textContent = "The search index could not be loaded."; return; }
    if (!terms.length) { status.textContent = "Type a word to search the whole site."; return; }
    var hits = [];
    index.forEach(function (page) {
      var title = page.title.toLowerCase();
      var heads = page.headings.join(" ").toLowerCase();
      var body = page.text.toLowerCase();
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        var s = (title.indexOf(terms[i]) !== -1 ? 10 : 0) + (heads.indexOf(terms[i]) !== -1 ? 5 : 0) + (body.indexOf(terms[i]) !== -1 ? 1 : 0);
        if (!s) { return; }
        score += s;
      }
      hits.push({ page: page, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || (a.page.title < b.page.title ? -1 : 1); });
    status.textContent = hits.length ? hits.length + (hits.length === 1 ? " page matches" : " pages match") : "Nothing found. Try a shorter or different word.";
    hits.forEach(function (hit) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = hit.page.url;
      var section = document.createElement("span");
      section.className = "label";
      section.textContent = hit.page.section;
      var heading = document.createElement("h2");
      highlight(heading, hit.page.title, terms);
      var paragraph = document.createElement("p");
      highlight(paragraph, snippet(hit.page.text, terms), terms);
      link.appendChild(section);
      link.appendChild(heading);
      link.appendChild(paragraph);
      item.appendChild(link);
      list.appendChild(item);
    });
  }

  var timer = null;
  input.addEventListener("input", function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      run(input.value);
      if (window.history && history.replaceState) {
        history.replaceState(null, "", input.value ? "?q=" + encodeURIComponent(input.value) : location.pathname);
      }
    }, 120);
  });
  form.addEventListener("submit", function (event) { event.preventDefault(); run(input.value); });

  var preset = /[?&]q=([^&]*)/.exec(location.search);
  if (preset) { input.value = decodeURIComponent(preset[1].replace(/\+/g, " ")); }
  run(input.value);
  input.focus();
})();
