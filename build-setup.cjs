'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'capture.js'), 'utf8').replace(/\r\n/g, '\n');
const bookmarklet = 'javascript:' + encodeURIComponent(source + '\nvoid 0;');
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord chat capture setup</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#202532;font:16px/1.65 system-ui,sans-serif}main{max-width:760px;margin:60px auto;padding:36px;background:white;border:1px solid #d7dce7;border-radius:16px}h1{font-size:30px;line-height:1.2;margin-top:0}h2{font-size:20px;margin-top:30px}p,li{max-width:650px}li{margin:14px 0}.bookmark{display:inline-block;padding:14px 20px;border-radius:9px;background:#4757c4;color:#fff;text-decoration:none;font-weight:700}.hint{font-size:14px;color:#4f5a70}textarea{width:100%;height:160px;font:12px/1.4 monospace;padding:10px;border:1px solid #bdc5d4;border-radius:6px}button{font:600 14px system-ui;padding:10px 16px;border:1px solid #bdc5d4;border-radius:6px;cursor:pointer}summary{cursor:pointer;font-weight:600}code{background:#eef0f6;padding:2px 5px;border-radius:4px}#feedback{min-height:24px}@media(max-width:800px){main{margin:15px;padding:24px}}
</style></head><body><main>
<h1>Save about 200 Discord messages</h1>
<p>This helper works with Discord server channels, one-to-one DMs, and group DMs. It saves a transcript of the chat you choose to your computer. You can choose fewer messages in its panel.</p>
<p class="hint"><strong>Updating your existing bookmark?</strong> Remove the old capture bookmark and drag the updated button below onto your bar. Close any existing capture panel before running the updated bookmark.</p>
<h2>1. Add the capture bookmark</h2>
<p>Press <strong>Ctrl + Shift + B</strong> to show your browser's favorites or bookmarks bar. Drag this button onto that bar:</p>
<p><a class="bookmark" id="bookmark" href="${escape(bookmarklet)}">Capture Discord chat</a></p>
<p class="hint">Drag it to the browser bar above the page. Clicking it on this setup page does not capture Discord.</p>
<h2>2. Open your chat in Discord</h2>
<p>Go to <a href="https://discord.com/channels/@me" target="_blank" rel="noopener">Discord in your browser</a>, log in normally, and open the server channel, DM, or group DM you want. Open the actual conversation, rather than the Friends page. Scroll to the bottom to start with the newest messages. You can also start from an older part of the chat.</p>
<h2>3. Capture and download</h2>
<ol>
<li>While viewing the Discord chat, click the <strong>Capture Discord chat</strong> bookmark you added.</li>
<li>A small panel appears. Leave the target at <strong>200</strong> or choose a smaller number, then click <strong>Collect older messages</strong>. Keep the Discord tab open while it scrolls.</li>
<li>Click <strong>Download .txt</strong>. The filename starts with <code>discord-channel-</code> for a server channel or <code>discord-dm-</code> for a DM or group DM. Open the file in a text editor, or use <strong>Copy text</strong> and paste the transcript into another app.</li>
</ol>
<p>If automatic scrolling stops early, scroll upward inside the chat yourself. The counter updates as messages load. You can download fewer than 200 whenever you have enough.</p>
<p class="hint">The helper reads messages from all participants loaded in this one chat. It does not read passwords, cookies, or account tokens, make API calls, post messages, or send the transcript anywhere. Attachments are saved as links. Edited messages reflect what the page shows during capture. Deleted or inaccessible messages cannot be captured. Download before refreshing the page.</p>
<details><summary>If dragging a bookmark does not work</summary>
<p>Create a bookmark with <strong>Ctrl + D</strong>. Name it <strong>Capture Discord chat</strong> and save it to the bookmarks bar. Open its <strong>Edit</strong> option, replace the URL with the complete text below, and save. Then click that bookmark while viewing your Discord chat.</p>
<button id="copy-bookmark" type="button">Copy bookmark URL</button><p id="feedback" class="hint" role="status"></p>
<textarea id="bookmark-url" readonly spellcheck="false" aria-label="Bookmark URL">${escape(bookmarklet)}</textarea>
<p>Source code for inspection or use in the browser developer console:</p>
<textarea readonly spellcheck="false" aria-label="Capture source code">${escape(source)}</textarea>
</details>
</main><script>
document.getElementById('copy-bookmark').addEventListener('click',async()=>{
  const field=document.getElementById('bookmark-url');
  try{await navigator.clipboard.writeText(field.value);document.getElementById('feedback').textContent='Copied. Paste this into the bookmark URL field.';}
  catch{field.focus();field.select();document.getElementById('feedback').textContent='Press Ctrl + C to copy the selected bookmark URL.';}
});
</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'setup.html'), html);
console.log('Created setup.html; bookmark URL is ' + bookmarklet.length + ' characters.');
