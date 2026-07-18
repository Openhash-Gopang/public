import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

describe('public/desktop.html — chatSend() 프록시 경유 수정 확인', () => {
  let dom, requests;

  before(() => {
    requests = [];
    dom = new JSDOM(`<!doctype html><html><body>
      <div id="chat-body"></div>
      <input id="chat-input">
      <button id="chat-send-btn"></button>
    </body></html>`, { runScripts: 'outside-only', url: 'https://public.hondi.net/desktop.html' });

    dom.window.fetch = async (url, opts) => {
      requests.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '민원 처리 안내입니다.' } }] }) };
    };

    const html = fs.readFileSync(new URL('../desktop.html', import.meta.url), 'utf-8');
    const lines = html.split('\n');
    const start = lines.findIndex(l => l.startsWith('const SYS='));
    const end   = lines.findIndex((l, i) => i > start && l.trim() === '}' && lines[i-1]?.includes('return id;'));
    if (start < 0 || end < 0) throw new Error('desktop.html 구조가 바뀌어 대상 코드를 못 찾음');
    dom.window.eval(lines.slice(start, end + 1).join('\n'));
  });

  after(() => { dom.window.close(); });

  test('취약점 수정 확인: api.anthropic.com을 실제로 호출하는 코드가 없다', () => {
    const html = fs.readFileSync(new URL('../desktop.html', import.meta.url), 'utf-8');
    assert.equal(/fetch\(\s*['"]https:\/\/api\.anthropic\.com/.test(html), false);
  });

  test('chatSend()가 /chat/completions를 올바른 페이로드로 호출한다', async () => {
    dom.window.document.getElementById('chat-input').value = '전입신고는 어디서 하나요?';
    await dom.window.chatSend();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://hondi-proxy.tensor-city.workers.dev/chat/completions');
    assert.equal(requests[0].body.messages[0].role, 'system');
    assert.equal(requests[0].body.messages.at(-1).content, '전입신고는 어디서 하나요?');
  });

  test('응답이 채팅창에 정상 렌더링된다', () => {
    const body = dom.window.document.getElementById('chat-body').innerHTML;
    assert.match(body, /민원 처리 안내입니다/);
  });
});
