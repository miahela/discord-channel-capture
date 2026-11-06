'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');
const source = fs.readFileSync(path.join(__dirname, 'capture.js'), 'utf8').replace(/\r\n/g, '\n');
const firstId = 1200000000000000000n;
const id = index => String(firstId + BigInt(index));

function fixture(indices, automatic = false, title = 'general | Example Server | Discord') {
  return `<!doctype html><html><head><title>${title}</title><style>
    body{font-family:Arial;margin:0}#scroll{height:240px;overflow-y:auto;width:650px}ol{padding:0;margin:0}li{min-height:55px;list-style:none;border-bottom:1px solid #ddd}h3{margin:0;font-size:12px}
    </style></head><body><main id="scroll"><ol data-list-id="chat-messages"></ol></main><script>
    const base=1200000000000000000n;
    function row(i,channel='456'){
      const id=String(base+BigInt(i));
      const names=['Alice','Bob','Charlie'];
      const header=(i-1)%3===0?'<h3 id="message-username-'+id+'"><span class="username">'+names[Math.floor((i-1)/3)%3]+'</span><span>APP</span></h3>':'';
      return '<li id="chat-messages-'+channel+'-'+id+'">'+header+'<time datetime="2026-11-05T10:00:00.000Z"></time>'+
      '<div class="repliedMessage"><span class="username">Wrong Reply Author</span><div id="message-content-reply">Reply preview must not be captured.</div></div>'+
      '<div id="message-content-'+id+'">Message '+i+'<br>Second line <img alt=":wave:" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>'+
      (i===12?'<a href="https://cdn.discordapp.com/attachments/456/789/example.pdf">example.pdf</a><div class="embedWrapper"><div class="embedFull">Example embed</div></div>':'')+'</li>';
    }
    window.draw=(values)=>{document.querySelector('ol').innerHTML=values.map(i=>row(i)).join('')+row(999,'987');};
    window.draw(${JSON.stringify(indices)});
    const scroll=document.getElementById('scroll');scroll.scrollTop=scroll.scrollHeight;
    ${automatic ? `let oldest=${Math.min(...indices)};let busy=false;
      scroll.addEventListener('scroll',()=>{
        if(busy||oldest<=1||scroll.scrollTop>500)return;busy=true;
        setTimeout(()=>{
          const before=scroll.scrollHeight;const stop=oldest;oldest=Math.max(1,oldest-20);
          document.querySelector('ol').insertAdjacentHTML('afterbegin',Array.from({length:stop-oldest},(_,n)=>row(oldest+n)).join(''));
          scroll.scrollTop+=scroll.scrollHeight-before;setTimeout(()=>busy=false,50);
        },100);
      });` : ''}
    </script></body></html>`;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CAPTURE_BROWSER_CHANNEL ? { channel: process.env.CAPTURE_BROWSER_CHANNEL } : {})
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const requests = [];
    const page = await context.newPage();
    page.on('request', request => requests.push(request.url()));
    let html = fixture(Array.from({ length: 12 }, (_, n) => n + 1));
    await context.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().url().startsWith('https://discord.com/')) {
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (route.request().url().startsWith('file:')) return route.continue();
      return route.abort();
    });
    await page.goto('https://discord.com/channels/123/456');
    await page.evaluate(source);
    await page.getByLabel('Messages to keep').fill('8');
    await page.getByLabel('Messages to keep').dispatchEvent('change');
    async function jsonDownload() {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download .json', exact: true }).click();
      return JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
    }
    const data = await jsonDownload();
    assert.equal(data.captured_messages, 8);
    assert.deepEqual(data.messages.map(message => message.id), Array.from({ length: 8 }, (_, n) => id(n + 5)));
    assert.equal(data.messages[0].author, 'Bob');
    assert.equal(data.messages[0].text, 'Message 5\nSecond line :wave:');
    assert.equal(data.messages[7].author, 'Alice');
    assert.deepEqual(data.messages[7].embeds, ['Example embed']);
    assert.deepEqual(data.messages[7].attachments, ['https://cdn.discordapp.com/attachments/456/789/example.pdf']);
    assert.ok(!JSON.stringify(data).includes('Wrong Reply Author'));
    assert.ok(!data.messages.some(message => message.id === id(999)));
    await page.evaluate(() => window.draw(Array.from({ length: 13 }, (_, n) => n + 1)));
    await page.waitForTimeout(350);
    assert.ok(!(await jsonDownload()).messages.some(message => message.id === id(13)), 'New arrivals should not move the capture boundary.');
    await page.evaluate(() => history.pushState({}, '', '/channels/123/987'));
    await page.waitForFunction(() => document.querySelector('#discord-local-capture-panel').shadowRoot.textContent.includes('Chat changed.'));
    assert.deepEqual((await jsonDownload()).messages.map(message => message.id), data.messages.map(message => message.id));
    assert.ok(await page.getByRole('button', { name: 'Target reached' }).isDisabled());
    assert.equal(requests.filter(url => !url.startsWith('data:')).length, 1, 'The helper must not make network requests.');
    console.log('PASS: message limit, chronological order, authors, multiline text, emoji, embeds, attachment links, thread exclusion, new arrivals, and channel lock.');

    html = fixture([5, 6, 7]);
    await page.goto('https://discord.com/channels/123/456');
    await page.evaluate(source);
    assert.equal((await jsonDownload()).messages[0].author, 'Unknown author (header not loaded)');
    await page.evaluate(() => window.draw([4, 5, 6, 7]));
    await page.waitForTimeout(350);
    const resolved = (await jsonDownload()).messages;
    assert.equal(resolved[1].author, 'Bob');
    assert.equal(resolved[2].author, 'Bob');
    assert.equal(resolved[3].author, 'Charlie');
    console.log('PASS: grouped author headers are resolved when earlier messages load.');

    html = fixture([1, 2, 3, 4, 5, 6], false, 'Bob | Discord');
    await page.goto('https://discord.com/channels/@me/456');
    await page.evaluate(source);
    const dm = await jsonDownload();
    assert.equal(dm.channel.type, 'dm');
    assert.equal(dm.channel.guild_id, null);
    assert.equal(dm.channel.url, 'https://discord.com/channels/@me/456');
    assert.equal(dm.captured_messages, 6);
    assert.deepEqual(Array.from(new Set(dm.messages.map(message => message.author))), ['Alice', 'Bob']);
    assert.ok(dm.messages.every(message => message.url === `https://discord.com/channels/@me/456/${message.id}`));
    const textDownloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .txt', exact: true }).click();
    const textDownload = await textDownloadEvent;
    assert.ok(textDownload.suggestedFilename().startsWith('discord-dm-456-'));
    const dmText = fs.readFileSync(await textDownload.path(), 'utf8');
    assert.ok(dmText.includes('[2026-11-05T10:00:00.000Z] Alice'));
    assert.ok(dmText.includes('[2026-11-05T10:00:00.000Z] Bob'));
    assert.ok(dmText.includes('https://discord.com/channels/@me/456/'));
    assert.ok(!dmText.includes('/channels/null/'));
    await page.evaluate(() => history.pushState({}, '', '/channels/123/456'));
    await page.waitForFunction(() => document.querySelector('#discord-local-capture-panel').shadowRoot.textContent.includes('Chat changed.'));
    assert.deepEqual((await jsonDownload()).messages, dm.messages);
    console.log('PASS: both participants in a DM, private message links, null guild metadata, TXT filename/content, and stopping when leaving the DM.');

    html = fixture([1, 2, 3, 4, 5, 6, 7, 8, 9], false, 'Weekend plans | Discord');
    await page.goto('https://discord.com/channels/@me/456');
    await page.evaluate(source);
    const group = await jsonDownload();
    assert.equal(group.channel.title, 'Weekend plans');
    assert.equal(group.channel.type, 'dm');
    assert.equal(group.channel.guild_id, null);
    assert.deepEqual(Array.from(new Set(group.messages.map(message => message.author))), ['Alice', 'Bob', 'Charlie']);
    assert.equal(group.captured_messages, 9);
    console.log('PASS: group DM with three distinct authors.');

    await page.goto('https://discord.com/channels/@me');
    let rejectedMessage = '';
    page.once('dialog', async dialog => { rejectedMessage = dialog.message(); await dialog.dismiss(); });
    await page.evaluate(source);
    assert.ok(rejectedMessage.includes('Open a server channel, DM, or group DM'));
    assert.equal(await page.locator('#discord-local-capture-panel').count(), 0);
    console.log('PASS: Friends page is rejected until an actual conversation is open.');

    html = fixture(Array.from({ length: 20 }, (_, n) => n + 281), true);
    await page.goto('https://discord.com/channels/123/456');
    await page.evaluate(source);
    await page.getByLabel('Messages to keep').fill('60');
    await page.getByLabel('Messages to keep').dispatchEvent('change');
    await page.getByRole('button', { name: 'Collect older messages', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#discord-local-capture-panel').shadowRoot.querySelector('output').textContent === '60 / 60', undefined, { timeout: 25000 });
    const autoData = await jsonDownload();
    assert.deepEqual(autoData.messages.map(message => message.id), Array.from({ length: 60 }, (_, n) => id(n + 241)));
    assert.ok(autoData.target_reached);
    console.log('PASS: automatic scrolling collects a bounded, continuous transcript as older messages load.');

    const guide = await context.newPage();
    await guide.goto(pathToFileURL(path.join(__dirname, 'setup.html')).href);
    const bookmarklet = await guide.locator('#bookmark').getAttribute('href');
    assert.ok(bookmarklet.startsWith('javascript:'));
    assert.ok(decodeURIComponent(bookmarklet.slice('javascript:'.length)).startsWith(source));
    assert.equal(await guide.locator('#bookmark-url').inputValue(), bookmarklet);
    console.log('PASS: setup guide embeds the exact capture code and a usable bookmark URL.');
    if (process.argv.includes('--screenshot')) {
      html = fs.readFileSync(path.join(__dirname, 'docs', 'demo.html'), 'utf8');
      await page.setViewportSize({ width: 1360, height: 820 });
      await page.goto('https://discord.com/channels/123/456');
      await page.evaluate(source);
      await page.screenshot({ path: path.join(__dirname, 'docs', 'screenshot.png') });
      console.log('Created docs/screenshot.png from fictional messages.');
    }
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
