/* Relay live-page diagnostics (paste into the console on chatgpt.com, F12).
 * Mirrors the exact DOM signals Relay v2's content.js strategies use, plus the
 * "zero everything" checks: is the extension even running here, is the page
 * actually logged in, is the chat inside an iframe, and what does <main>
 * really contain. Send the printed output back.
 * Style: ES5 (var only) so it runs in any console.
 */
(function () {
  var out = [];
  function line(s) { out.push(s); }

  /* 1. Page + extension state */
  line('host: ' + location.hostname);
  line('url: ' + location.href);
  line('readyState: ' + document.readyState);
  line('relay content script loaded (__relayLoaded): ' + !!window.__relayLoaded);
  line('window.__relay: ' + (window.__relay ? 'v' + window.__relay.version : 'ABSENT (content script never ran on this page)'));

  /* 2. Login wall? (a logged-out page explains zero selectors) */
  var bodyText = (document.body && document.body.innerText || '').slice(0, 400);
  var loginish = /log in|sign up|welcome to chatgpt/i.test(bodyText);
  line('possible login wall: ' + loginish);
  if (loginish) line('body head: ' + bodyText.replace(/\n+/g, ' | ').slice(0, 200));

  /* 3. Iframes: is the chat app nested where the content script cannot see it? */
  var frames = document.querySelectorAll('iframe');
  line('iframes on page: ' + frames.length);
  for (var fi = 0; fi < Math.min(frames.length, 5); fi++) {
    var f = frames[fi], accessible = false, fRoles = '?';
    try { fRoles = f.contentDocument.querySelectorAll('[data-message-author-role]').length; accessible = true; }
    catch (e) { /* cross-origin */ }
    line('  iframe[' + fi + '] src=' + (f.src || '(none)').slice(0, 60) +
         ' accessible=' + accessible + ' roleMarkers=' + fRoles);
  }

  /* 4. Shadow roots (v2.0.1 theory) */
  var shadows = 0, walked = 0;
  try {
    var walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode() && walked < 20000) {
      walked++;
      if (walker.currentNode.shadowRoot) shadows++;
    }
  } catch (e) { line('shadow walk threw: ' + e.message); }
  line('shadow roots found: ' + shadows + ' (walked ' + walked + ' elements)');

  /* 5. Per-strategy raw signal counts (document scope, same as content.js) */
  function q(sel) {
    try { return document.querySelectorAll(sel).length; }
    catch (e) { return 'BAD-SELECTOR'; }
  }
  line('--- strategy signals ---');
  var roles = document.querySelectorAll('[data-message-author-role]');
  var roleDist = {};
  for (var ri = 0; ri < roles.length; ri++) {
    var r = roles[ri].getAttribute('data-message-author-role');
    roleDist[r] = (roleDist[r] || 0) + 1;
  }
  line('S1 [data-message-author-role]: ' + roles.length + ' ' + JSON.stringify(roleDist));
  var main = document.querySelector('main');
  line('S2 <main> present: ' + !!main +
       (main ? ', articles inside: ' + q('main article') : ''));
  line('S3 [data-testid^="conversation-turn"]: ' + q('[data-testid^="conversation-turn"]'));
  line('S4 alt [data-message-author-role] (dup of S1): ' + roles.length);
  line('claude [data-testid="user-message"]: ' + q('[data-testid="user-message"]'));
  line('assistant UI heuristics: copy-turn buttons=' + q('[data-testid="copy-turn-action-button"]') +
       ', aria Copy buttons=' + q('button[aria-label*="Copy" i]'));

  /* 6. <main> census: what does the conversation root actually hold? */
  if (main) {
    var kids = main.children, tags = {};
    for (var ki = 0; ki < kids.length; ki++) {
      var t = kids[ki].tagName.toLowerCase();
      tags[t] = (tags[t] || 0) + 1;
    }
    line('main direct children: ' + JSON.stringify(tags));
    /* 7. Biggest text block under main: where the messages probably are */
    var best = null, bestLen = 0;
    var all = main.querySelectorAll('*');
    for (var ai = 0; ai < Math.min(all.length, 5000); ai++) {
      var el = all[ai];
      if (el.children.length > 40) continue; /* skip containers */
      var len = (el.innerText || '').length;
      if (len > bestLen) { bestLen = len; best = el; }
    }
    if (best) {
      var path = [], p = best;
      while (p && p !== main && path.length < 6) {
        var cls = (p.className && typeof p.className === 'string') ? p.className.split(' ')[0] : '';
        path.unshift(p.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        p = p.parentElement;
      }
      line('biggest leaf text block (' + bestLen + ' chars): <' + path.join(' < ') + '>');
      var sib = best.parentElement;
      if (sib) line('its parent <' + sib.tagName.toLowerCase() + '> has ' + sib.children.length + ' children');
    }
  } else {
    line('NO <main> on page at all');
  }

  var report = out.join('\n');
  try { console.log(report); } catch (e) {}
  return report;
})();
