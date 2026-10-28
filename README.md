# ⚡ Relay

**Your Claude or ChatGPT thread got long and sloppy? One click builds a clean handoff doc. Copy, new chat, keep going.**

Long AI conversations degrade. The model forgets your goal, repeats itself, burns context. The standard advice is a manual ritual: beg the AI for a summary, copy it, paste it into a fresh chat, hope nothing got lost.

Relay does it in one click. No API key. No account. Everything runs locally in your browser, your chats never leave your machine.

## The 20-second demo

1. Open any long Claude or ChatGPT thread
2. Click the orange **⚡ Handoff** button (bottom right)
3. A panel slides in with your handoff doc: original goal, key points, decisions made, code artifacts, still-open questions
4. Hit **Copy**, hit **New chat**, paste, continue like nothing happened

## What goes into the handoff

- **Original goal** — your first message, so the new chat knows what this was about
- **Key points** — the most substantive AI responses, condensed
- **Decisions made** — explicit decisions detected in the thread
- **Code & artifacts** — every code block, labeled by language with previews
- **Still open** — your unanswered questions, so nothing drops

## Install (30 seconds)

1. Download the latest `relay.zip` from [Releases](../../releases)
2. Unzip it
3. Go to `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked**, select the unzipped folder
5. Open any thread on claude.ai or chatgpt.com and look for the orange button

## Privacy

Relay is fully local. It reads the page DOM to build your handoff and never sends anything anywhere. No servers, no analytics, no API keys.

## Roadmap

- [ ] AI-polished handoffs (optional, bring your own API key)
- [ ] Firefox support
- [ ] Gemini / Grok thread parsing
- [ ] Handoff history: save and browse past handoffs

## Troubleshooting

If the Handoff button cannot find your conversation, open the browser console (F12) on the chat page and paste this, then send me the output:

```js
(() => {
  const out = [];
  out.push('role markers: ' + document.querySelectorAll('[data-message-author-role]').length);
  out.push('articles in main: ' + document.querySelectorAll('main article').length);
  out.push('turn testids: ' + document.querySelectorAll('[data-testid^="conversation-turn"]').length);
  const first = document.querySelector('[data-message-author-role]');
  if (first) out.push('first marker: <' + first.tagName.toLowerCase() + '> role=' + first.getAttribute('data-message-author-role'));
  out.push('relay: ' + (window.__relay ? window.__relay.version : 'not loaded'));
  return out.join('\n');
})()
```

## License

MIT
