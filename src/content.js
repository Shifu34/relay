/* Relay content script v2: multi-strategy thread parsing.
 *
 * Design: never depend on a single selector. Each site gets several
 * independent parsing strategies ordered by reliability. The first
 * strategy that yields 2+ messages wins. Strategies use different DOM
 * signals, so one site redesign cannot break all of them.
 */

(function () {
  'use strict';

  if (window.__relayLoaded) return;
  window.__relayLoaded = true;

  var DEBUG = [];

  function log() {
    DEBUG.push(Array.prototype.join.call(arguments, ' '));
  }

  /* ---------- shared helpers ---------- */

  // Deep query: pierces shadow roots, which document.querySelectorAll cannot see.
  // If ChatGPT/Claude render chat in web components, plain selectors find nothing.
  function deepQueryAll(root, selector, out) {
    out = out || [];
    try {
      var found = root.querySelectorAll(selector);
      for (var i = 0; i < found.length; i++) out.push(found[i]);
    } catch (e) { /* bad selector for this root */ }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      var el = walker.currentNode;
      if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
    }
    return out;
  }

  function deepQuerySelector(root, selector) {
    var all = deepQueryAll(root, selector);
    return all.length ? all[0] : null;
  }

  function countShadowRoots() {
    var n = 0;
    var walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      if (walker.currentNode.shadowRoot) n++;
    }
    return n;
  }

  function cleanText(root) {
    var clone = root.cloneNode(true);
    var junk = clone.querySelectorAll(
      'button, svg, script, style, [aria-hidden="true"], ' +
      '[data-testid="copy-turn-action-button"], [data-testid*="feedback"]'
    );
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var text = (clone.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  function extractCodeBlocks(root) {
    var out = [];
    var pres = root.querySelectorAll('pre code');
    for (var i = 0; i < pres.length && out.length < 12; i++) {
      var c = pres[i];
      var lang = 'code';
      var m = (c.className || '').match(/language-([\w+-]+)/);
      if (m) lang = m[1];
      var code = c.textContent || '';
      if (code.trim().length > 20) out.push({ lang: lang, code: code });
    }
    return out;
  }

  function validMessages(msgs) {
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m && (m.role === 'user' || m.role === 'assistant') && m.text && m.text.length > 1) {
        out.push({ role: m.role, text: m.text, codeBlocks: m.codeBlocks || [] });
      }
    }
    // Drop consecutive exact duplicates (parser overlap safety).
    return out.filter(function (m, i) {
      return i === 0 || m.text !== out[i - 1].text || m.role !== out[i - 1].role;
    });
  }

  function tryStrategies(strategies, site) {
    for (var i = 0; i < strategies.length; i++) {
      try {
        var msgs = validMessages(strategies[i]());
        log(site + ' strategy ' + (i + 1) + ': ' + msgs.length + ' messages');
        if (msgs.length >= 2) return { messages: msgs, strategy: i + 1 };
      } catch (e) {
        log(site + ' strategy ' + (i + 1) + ' threw: ' + e.message);
      }
    }
    return { messages: [], strategy: 0 };
  }

  /* ---------- ChatGPT ---------- */

  function gptByRoleAttr() {
    var nodes = deepQueryAll(document,
      '[data-message-author-role="user"], [data-message-author-role="assistant"]'
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      out.push({
        role: n.getAttribute('data-message-author-role'),
        text: cleanText(n),
        codeBlocks: extractCodeBlocks(n),
      });
    }
    return out;
  }

  function gptByArticles() {
    var main = deepQuerySelector(document, 'main');
    if (!main) return [];
    var scope = main.shadowRoot || main;
    var articles = deepQueryAll(scope, 'article');
    var out = [];
    for (var i = 0; i < articles.length; i++) {
      var a = articles[i];
      var text = cleanText(a);
      if (text.length < 2) continue;
      var roleAttr = a.querySelector('[data-message-author-role]');
      var role = roleAttr ? roleAttr.getAttribute('data-message-author-role') : null;
      if (!role) {
        var hasAssistantUI = a.querySelector(
          'button[aria-label*="Copy" i], button[aria-label*="Read aloud" i], ' +
          '[data-testid="copy-turn-action-button"]'
        );
        role = hasAssistantUI ? 'assistant' : 'user';
      }
      if (role !== 'user' && role !== 'assistant') continue;
      out.push({ role: role, text: text, codeBlocks: extractCodeBlocks(a) });
    }
    return out;
  }

  function gptByTurnTestIds() {
    var turns = deepQueryAll(document, '[data-testid^="conversation-turn"]');
    var out = [];
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      var text = cleanText(t);
      if (text.length < 2) continue;
      var inner = t.querySelector('[data-message-author-role]');
      var role = inner ? inner.getAttribute('data-message-author-role') : null;
      if (!role) {
        role = t.querySelector('button[aria-label*="Copy" i]') ? 'assistant' : 'user';
      }
      if (role !== 'user' && role !== 'assistant') continue;
      out.push({ role: role, text: text, codeBlocks: extractCodeBlocks(t) });
    }
    return out;
  }

  function gptByAlternation() {
    // Last resort: find message-like blocks and use strict user/assistant
    // alternation to assign roles.
    var candidates = deepQueryAll(document, '[data-message-author-role]').map(function (el) {
      return { el: el, role: el.getAttribute('data-message-author-role') };
    }).filter(function (c) { return c.role === 'user' || c.role === 'assistant'; });
    if (candidates.length >= 2) {
      return candidates.map(function (c) {
        return { role: c.role, text: cleanText(c.el), codeBlocks: extractCodeBlocks(c.el) };
      });
    }
    return [];
  }

  function parseChatGPT() {
    return tryStrategies(
      [gptByRoleAttr, gptByArticles, gptByTurnTestIds, gptByAlternation],
      'chatgpt'
    );
  }

  /* ---------- Claude ---------- */

  function claudeByUserTestIds() {
    var userEls = deepQueryAll(document, '[data-testid="user-message"]');
    if (userEls.length === 0) return [];
    var out = [];
    for (var i = 0; i < userEls.length; i++) {
      var u = userEls[i];
      var utext = cleanText(u);
      if (utext) out.push({ role: 'user', text: utext, codeBlocks: extractCodeBlocks(u) });
      // Assistant reply: siblings until the next user message.
      var nextUser = userEls[i + 1] || null;
      var buf = '';
      var codeBlocks = [];
      var el = u.nextElementSibling;
      var guard = 0;
      while (el && el !== nextUser && guard < 500) {
        guard++;
        if (el.querySelectorAll) {
          var cbs = extractCodeBlocks(el);
          for (var k = 0; k < cbs.length; k++) codeBlocks.push(cbs[k]);
        }
        var t = cleanText(el);
        // Skip UI chrome: model picker labels, timestamps, empty wrappers.
        if (t && t.length > 1 && !/^(Claude|Sonnet|Opus|Haiku)\b/.test(t)) {
          buf += (buf ? '\n\n' : '') + t;
        }
        el = el.nextElementSibling;
      }
      if (buf.trim()) out.push({ role: 'assistant', text: buf.trim(), codeBlocks: codeBlocks });
    }
    return out;
  }

  function claudeByMessageGroups() {
    // Newer Claude UI groups turns in containers; look for role markers.
    var groups = deepQueryAll(document, '[data-testid*="message"], [data-message-role], [data-role]');
    var out = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g.closest && g.closest('[data-testid="user-message"]')) continue;
      var role = g.getAttribute('data-message-role') || g.getAttribute('data-role');
      if (!role) continue;
      role = role.toLowerCase();
      if (role !== 'user' && role !== 'assistant') continue;
      var text = cleanText(g);
      if (text.length > 1) out.push({ role: role, text: text, codeBlocks: extractCodeBlocks(g) });
    }
    return out;
  }

  function claudeByMain() {
    var main = deepQuerySelector(document, 'main');
    if (!main) return [];
    // Split the conversation root on user-message markers.
    var users = deepQueryAll(main.shadowRoot || main, '[data-testid="user-message"]');
    if (users.length === 0) return [];
    return claudeByUserTestIds();
  }

  function parseClaude() {
    return tryStrategies(
      [claudeByUserTestIds, claudeByMessageGroups, claudeByMain],
      'claude'
    );
  }

  function parseThread() {
    DEBUG = [];
    var host = location.hostname;
    var res = host.indexOf('chatgpt.com') !== -1 ? parseChatGPT() : parseClaude();
    res.debug = DEBUG.join('\n') + '\nshadow roots on page: ' + countShadowRoots();
    res.host = host;
    return res;
  }

  /* ---------- extractive handoff builder (unchanged logic) ---------- */

  function firstSentences(text, n) {
    var parts = text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim().length > 0; });
    return parts.slice(0, n).join(' ');
  }

  function scoreAssistant(m) {
    var s = m.text.length;
    s += m.codeBlocks.length * 800;
    if (/^(\s*[-*]\s+|\s*\d+\.\s+)/m.test(m.text)) s += 200;
    if (/(decided|decision|conclusion|summary|recommend|important|note that|key (point|takeaway))/i.test(m.text)) s += 300;
    return s;
  }

  function buildHandoff(messages) {
    var users = messages.filter(function (m) { return m.role === 'user'; });
    var assistants = messages.filter(function (m) { return m.role === 'assistant'; });
    var title = (document.title || '').replace(/ [-–] (Claude|ChatGPT)$/, '').trim() || 'Untitled thread';

    var goal = users.length ? firstSentences(users[0].text, 3) : '(no user messages found)';

    var ranked = assistants.slice().sort(function (a, b) { return scoreAssistant(b) - scoreAssistant(a); });
    var keyPoints = ranked.slice(0, 5).map(function (m) { return firstSentences(m.text, 2); });

    var decisionRe = /([^.!?]*\b(decided|decision|we('ll| will)|agreed|going with|final answer|conclusion)\b[^.!?]*[.!?])/gi;
    var decisions = [];
    assistants.forEach(function (m) {
      var match;
      while ((match = decisionRe.exec(m.text)) && decisions.length < 6) {
        var s = match[1].trim();
        if (s.length > 20 && s.length < 400 && decisions.indexOf(s) === -1) decisions.push(s);
      }
    });

    var artifacts = [];
    messages.forEach(function (m) {
      m.codeBlocks.forEach(function (cb) {
        if (artifacts.length < 8 && cb.code.trim().length > 20) {
          var lines = cb.code.trim().split('\n');
          artifacts.push({
            lang: cb.lang,
            preview: lines.slice(0, 8).join('\n'),
            truncated: lines.length > 8,
            totalLines: lines.length,
          });
        }
      });
    });

    var openQuestions = [];
    for (var i = users.length - 1; i >= 0 && openQuestions.length < 5; i--) {
      var t = users[i].text.trim();
      if (/\?\s*$/.test(t)) {
        var q = firstSentences(t, 2);
        if (q.length > 15 && openQuestions.indexOf(q) === -1) openQuestions.push(q);
      }
    }

    var lines = [];
    lines.push('# Relay handoff: ' + title);
    lines.push('');
    lines.push('_' + new Date().toLocaleString() + ' | ' + messages.length + ' messages (' + users.length + ' you, ' + assistants.length + ' AI)_');
    lines.push('');
    lines.push('## Original goal');
    lines.push(goal);
    lines.push('');
    if (keyPoints.length) {
      lines.push('## Key points so far');
      keyPoints.forEach(function (k) { lines.push('- ' + k); });
      lines.push('');
    }
    if (decisions.length) {
      lines.push('## Decisions made');
      decisions.forEach(function (d) { lines.push('- ' + d); });
      lines.push('');
    }
    if (artifacts.length) {
      lines.push('## Code & artifacts (' + artifacts.length + ')');
      artifacts.forEach(function (a, i) {
        lines.push('### ' + (i + 1) + '. ' + a.lang + (a.truncated ? ' (' + a.totalLines + ' lines, preview)' : ''));
        lines.push('```' + a.lang);
        lines.push(a.preview);
        lines.push('```');
      });
      lines.push('');
    }
    if (openQuestions.length) {
      lines.push('## Still open');
      openQuestions.forEach(function (q) { lines.push('- ' + q); });
      lines.push('');
    }
    lines.push('---');
    lines.push('_Paste this into a fresh chat and continue. Built with Relay._');
    return lines.join('\n');
  }

  /* ---------- panel UI ---------- */

  function ensureUI() {
    if (document.getElementById('relay-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'relay-btn';
    btn.textContent = '⚡ Handoff';
    btn.title = 'Build a handoff doc for this thread (Relay v2)';
    btn.addEventListener('click', onHandoff);
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'relay-panel';
    panel.innerHTML =
      '<div id="relay-panel-head">' +
      '<span>⚡ Relay handoff</span>' +
      '<div><button id="relay-copy">Copy</button>' +
      '<button id="relay-new">New chat</button>' +
      '<button id="relay-close">✕</button></div></div>' +
      '<pre id="relay-doc"></pre>';
    document.body.appendChild(panel);
    panel.querySelector('#relay-close').addEventListener('click', function () {
      panel.classList.remove('open');
    });
    panel.querySelector('#relay-copy').addEventListener('click', function () {
      var doc = panel.querySelector('#relay-doc').innerText;
      navigator.clipboard.writeText(doc).then(function () {
        var b = panel.querySelector('#relay-copy');
        b.textContent = 'Copied ✓';
        setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      });
    });
    panel.querySelector('#relay-new').addEventListener('click', function () {
      var host = location.hostname;
      var url = host.indexOf('chatgpt.com') !== -1 ? 'https://chatgpt.com/' : 'https://claude.ai/new';
      window.open(url, '_blank');
    });
  }

  function onHandoff() {
    var res = parseThread();
    var panel = document.getElementById('relay-panel');
    var docEl = panel.querySelector('#relay-doc');
    if (res.messages.length < 2) {
      docEl.innerText =
        'Relay could not find a conversation on this page.\n\n' +
        '--- diagnostics ---\n' + res.debug + '\n' + res.host + '\n\n' +
        'If this keeps happening, run the diagnostic snippet from the README\n' +
        'and send me the output so I can fix the parser for this layout.';
    } else {
      docEl.innerText = buildHandoff(res.messages);
    }
    panel.classList.add('open');
    panel.querySelector('#relay-doc').scrollTop = 0;
  }

  window.__relay = { parseThread: parseThread, buildHandoff: buildHandoff, version: '2.0.0' };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }
})();
