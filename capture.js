(() => {
  'use strict';

  const key = '__discordLocalChannelCaptureV1';
  const match = location.pathname.match(/^\/channels\/(\d+|@me)\/(\d+)\/?$/);
  if (!['discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(location.hostname) || !match) {
    alert('Open a server channel, DM, or group DM on discord.com, then click this bookmark again.');
    return;
  }
  if (window[key]) {
    window[key].show();
    return;
  }

  const path = location.pathname;
  const guildSegment = match[1];
  const isDM = guildSegment === '@me';
  const guildId = isDM ? null : guildSegment;
  const channelId = match[2];
  const channelUrl = `https://discord.com/channels/${guildSegment}/${channelId}`;
  const channelTitle = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*Discord$/, '');
  const captured = new Map();
  let anchorId = null;
  let target = 200;
  let running = false;
  let collectionRun = 0;
  let closed = false;
  let channelChanged = false;
  let notice = 'Start at the bottom of the chat, then collect older messages.';
  let scheduled = null;

  const host = document.createElement('div');
  host.id = 'discord-local-capture-panel';
  host.style.cssText = 'position:fixed;top:82px;right:20px;z-index:2147483647;width:330px;max-width:calc(100vw - 40px);color-scheme:dark;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:dark} *{box-sizing:border-box}
    section{font:14px/1.45 system-ui,sans-serif;background:#20232b;color:#f3f4f7;border:1px solid #565d6d;border-radius:12px;padding:18px;box-shadow:0 12px 42px #0009}
    h2{font-size:17px;line-height:1.3;margin:0 0 5px} p{margin:8px 0;color:#c7cbd5}
    .channel{font-size:12px;overflow-wrap:anywhere;margin-bottom:12px}
    label{display:flex;align-items:center;gap:8px;margin:12px 0}
    input{width:76px;padding:5px;border:1px solid #777f90;border-radius:5px;background:#13161c;color:#fff;font:inherit}
    output{display:block;font-size:24px;font-weight:700;margin:10px 0 0}
    .status{font-size:12px;min-height:36px;white-space:pre-line}
    button{font:600 13px system-ui;cursor:pointer;background:#3c4352;color:#fff;border:1px solid #687286;border-radius:6px;padding:9px 10px}
    button:disabled{opacity:.5;cursor:default} button:hover:enabled{filter:brightness(1.18)}
    .primary{width:100%;background:#4757c4;border-color:#7381e6;margin:6px 0 10px}
    .buttons{display:flex;gap:6px;flex-wrap:wrap}.foot{font-size:11px;margin:12px 0}
    .close{background:transparent;width:100%;padding:5px;color:#c7cbd5}
  `;
  shadow.append(style);
  const panel = document.createElement('section');
  shadow.append(panel);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  panel.append(element('h2', isDM ? 'Capture this DM' : 'Capture this channel'));
  panel.append(element('p', channelTitle || `${isDM ? 'DM' : 'Channel'} ${channelId}`, 'channel'));
  const label = element('label', 'Messages to keep');
  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.min = '1';
  limitInput.max = '500';
  limitInput.value = String(target);
  label.append(limitInput);
  panel.append(label);
  const count = element('output', '0 / 200');
  const status = element('p', notice, 'status');
  status.setAttribute('role', 'status');
  panel.append(count, status);
  const collectButton = element('button', 'Collect older messages', 'primary');
  collectButton.type = 'button';
  const actions = element('div', undefined, 'buttons');
  const textButton = element('button', 'Download .txt');
  const jsonButton = element('button', 'Download .json');
  const copyButton = element('button', 'Copy text');
  for (const button of [textButton, jsonButton, copyButton]) {
    button.type = 'button';
    actions.append(button);
  }
  const closeButton = element('button', 'Close and clear capture', 'close');
  closeButton.type = 'button';
  panel.append(collectButton, actions,
    element('p', 'Captures the loaded chat. Files and media are saved as links. Download before refreshing or leaving this tab.', 'foot'), closeButton);
  document.documentElement.append(host);

  const compareIds = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
  const ordered = () => Array.from(captured.values()).sort((a, b) => compareIds(a.id, b.id));
  const unknown = 'Unknown author (header not loaded)';
  const currentChannel = () => location.pathname === path;

  function render() {
    count.textContent = `${captured.size} / ${target}`;
    status.textContent = notice;
    collectButton.textContent = running ? 'Stop collecting' : captured.size >= target ? 'Target reached' : 'Collect older messages';
    collectButton.disabled = channelChanged || (!running && captured.size >= target);
    limitInput.disabled = running || channelChanged;
    for (const button of [textButton, jsonButton, copyButton]) button.disabled = !captured.size;
  }

  function textOf(node) {
    if (!node) return '';
    const blocks = new Set(['DIV', 'P', 'PRE', 'BLOCKQUOTE', 'LI', 'H1', 'H2', 'H3', 'H4']);
    function walk(part) {
      if (part.nodeType === Node.TEXT_NODE) return part.textContent;
      if (part.nodeType !== Node.ELEMENT_NODE || part.hidden || part.getAttribute('aria-hidden') === 'true') return '';
      if (['SCRIPT', 'STYLE', 'BUTTON'].includes(part.tagName)) return '';
      if (part.tagName === 'BR') return '\n';
      if (part.tagName === 'IMG') return part.getAttribute('alt') || '';
      const content = Array.from(part.childNodes, walk).join('');
      return blocks.has(part.tagName) ? `\n${content}\n` : content;
    }
    return walk(node).replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function messageId(row) {
    const parts = row.id.match(/^chat-messages-(?:(\d+)-)?(\d+)$/);
    return parts && (!parts[1] || parts[1] === channelId) ? parts[2] : null;
  }

  function chatList() {
    for (const list of document.querySelectorAll('[data-list-id="chat-messages"]')) {
      if (Array.from(list.querySelectorAll('[id^="chat-messages-"]')).some(row => messageId(row))) return list;
    }
    for (const row of document.querySelectorAll('li[id^="chat-messages-"]')) {
      if (messageId(row)) return row.closest('ol,[role="log"],[role="list"]') || row.parentElement;
    }
    return null;
  }

  function trim() {
    const entries = ordered();
    for (const entry of entries.slice(0, Math.max(0, entries.length - target))) captured.delete(entry.id);
  }

  function scan() {
    if (closed || !currentChannel() || channelChanged) return;
    const list = chatList();
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('[id^="chat-messages-"]'))
      .map(row => ({ row, id: messageId(row) })).filter(item => item.id)
      .sort((a, b) => compareIds(a.id, b.id));
    if (!rows.length) return;
    if (anchorId === null) anchorId = rows[rows.length - 1].id;
    let previousAuthor = null;
    for (const { row, id } of rows) {
      const content = row.querySelector(`[id="message-content-${id}"]`);
      const username = row.querySelector(`[id="message-username-${id}"]`)
        || row.querySelector('h3 [class*="username"]');
      const explicitAuthor = textOf(username && (username.querySelector('[class*="username"]') || username));
      const existing = captured.get(id);
      let author = explicitAuthor || (existing && existing.author !== unknown ? existing.author : null) || previousAuthor || unknown;
      const system = !content && !username && !!row.querySelector('[class*="systemMessage"],[class*="systemMessageContent"]');
      if (system) author = 'System';
      previousAuthor = system ? null : author === unknown ? null : author;
      if (compareIds(id, anchorId) > 0) continue;
      const time = row.querySelector('time[datetime]');
      const timestamp = time ? time.getAttribute('datetime') : new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
      const text = textOf(content) || (system ? textOf(row.querySelector('[class*="systemMessageContent"]') || row) : '');
      const embedSelector = '[class*="embedWrapper"],[class*="embedFull"]';
      const embeds = Array.from(row.querySelectorAll(embedSelector))
        .filter(node => !node.parentElement.closest(embedSelector) && !node.closest('[class*="repliedMessage"]'))
        .map(textOf).filter(Boolean);
      const attachments = new Set();
      for (const node of row.querySelectorAll('a[href],img[src],video[src],audio[src],source[src]')) {
        if (node.closest('[class*="repliedMessage"]')) continue;
        const link = node.getAttribute('href') || node.getAttribute('src');
        if (!link) continue;
        try {
          const url = new URL(link, location.origin);
          if (['cdn.discordapp.com', 'media.discordapp.net', 'cdn.discord.com'].includes(url.hostname)
              && /^\/(attachments|ephemeral-attachments|stickers)\//.test(url.pathname)) attachments.add(url.href);
        } catch { /* Ignore malformed non-message URLs. */ }
      }
      captured.set(id, {
        id, author, timestamp, text,
        embeds: Array.from(new Set(embeds)), attachments: Array.from(attachments),
        url: `${channelUrl}/${id}`,
        ...(text || embeds.length || attachments.size ? {} : { note: 'No readable text or attachment link was found for this message.' })
      });
    }
    trim();
    if (captured.size >= target && running) {
      running = false;
      notice = `Captured ${captured.size} messages. Ready to download.`;
    }
    render();
  }

  function scrollerFor(list) {
    for (let node = list; node && node !== document.documentElement; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 5 && /auto|scroll/.test(overflow)) return node;
    }
    return null;
  }

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function collectOlder() {
    if (running) {
      collectionRun++;
      running = false;
      notice = 'Stopped. You can download the messages collected so far.';
      render();
      return;
    }
    scan();
    if (captured.size >= target || !currentChannel()) return;
    running = true;
    const thisRun = ++collectionRun;
    notice = 'Loading older messages. You can stop at any time.';
    render();
    let stalled = 0;
    for (let step = 0; running && thisRun === collectionRun && !closed && currentChannel() && step < 240; step++) {
      const list = chatList();
      const scroller = list && scrollerFor(list);
      if (!scroller) {
        notice = 'Scroll upward in the chat to load messages. They will be captured as they appear.';
        break;
      }
      const beforeCount = captured.size;
      const beforeTop = scroller.scrollTop;
      scroller.scrollBy({ top: -Math.max(250, scroller.clientHeight * 0.7), behavior: 'instant' });
      await sleep(950);
      if (thisRun !== collectionRun) return;
      if (!running || closed || !currentChannel()) break;
      scan();
      if (captured.size !== beforeCount || Math.abs(scroller.scrollTop - beforeTop) > 1) stalled = 0;
      else stalled++;
      if (stalled >= 8) {
        notice = `Stopped at ${captured.size} messages. No older messages loaded; try scrolling upward manually.`;
        break;
      }
    }
    if (running) {
      notice = captured.size >= target ? `Captured ${captured.size} messages. Ready to download.` : notice;
      if (notice.startsWith('Loading older')) notice = 'Collection paused. Download what was captured or continue scrolling upward.';
    }
    running = false;
    render();
  }

  function packageData() {
    scan();
    const messages = ordered();
    return {
      channel: { title: channelTitle, type: isDM ? 'dm' : 'server_channel', guild_id: guildId, channel_id: channelId, url: channelUrl },
      exported_at: new Date().toISOString(),
      requested_messages: target,
      captured_messages: messages.length,
      target_reached: messages.length >= target,
      scope: 'Messages rendered by the Discord web app at or before the newest message loaded when capture started. This is not proof of complete conversation history.',
      notes: 'Attachments are links, not downloaded files. Deleted, inaccessible, and unloaded messages are not available. Review unknown authors and blank messages.',
      messages
    };
  }

  function transcript() {
    const data = packageData();
    const header = [data.channel.title, data.channel.url,
      `Exported: ${data.exported_at}`, `Captured: ${data.captured_messages} / ${data.requested_messages} requested messages`,
      data.scope, data.notes].join('\n');
    const body = data.messages.map(message => [
      `[${message.timestamp}] ${message.author}`,
      message.text,
      ...message.embeds.map(embed => `Embed:\n${embed}`),
      ...message.attachments.map(link => `Attachment: ${link}`),
      message.note || '',
      message.url
    ].filter(Boolean).join('\n')).join('\n\n');
    return `${header}\n\n${body}\n`;
  }

  function download(content, extension, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `discord-${isDM ? 'dm' : 'channel'}-${channelId}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.documentElement.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice = `Download started. ${captured.size} messages in the file.`;
    render();
  }

  limitInput.addEventListener('change', () => {
    target = Math.min(500, Math.max(1, Math.trunc(Number(limitInput.value)) || 200));
    limitInput.value = String(target);
    trim();
    notice = captured.size >= target ? 'Target reached. Ready to download.' : 'Collect older messages or scroll upward manually.';
    scan();
    render();
  });
  collectButton.addEventListener('click', () => {
    collectOlder().catch(() => {
      running = false;
      notice = 'Automatic scrolling stopped. Scroll upward manually, then download the captured messages.';
      render();
    });
  });
  textButton.addEventListener('click', () => download(transcript(), 'txt', 'text/plain;charset=utf-8'));
  jsonButton.addEventListener('click', () => download(JSON.stringify(packageData(), null, 2), 'json', 'application/json'));
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(transcript());
      notice = 'Transcript copied. Paste it into your text editor or another app.';
    } catch {
      notice = 'Clipboard access was blocked. Use Download .txt instead.';
    }
    render();
  });

  const observer = new MutationObserver(() => {
    if (scheduled !== null || closed || channelChanged) return;
    scheduled = setTimeout(() => { scheduled = null; scan(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const timer = setInterval(() => {
    if (!currentChannel() && !channelChanged) {
      channelChanged = true;
      collectionRun++;
      running = false;
      observer.disconnect();
      notice = 'Chat changed. Capture stopped; downloads still contain only the original chat. Close and run the bookmark again for another chat.';
      render();
    } else if (!channelChanged) scan();
  }, 1200);
  window[key] = { show: () => { host.style.display = 'block'; } };
  closeButton.addEventListener('click', () => {
    if (captured.size && !confirm('Close the helper and clear its captured messages? Download first if you want to keep them.')) return;
    closed = true;
    running = false;
    observer.disconnect();
    clearInterval(timer);
    if (scheduled !== null) clearTimeout(scheduled);
    captured.clear();
    host.remove();
    delete window[key];
  });
  scan();
  render();
})();
