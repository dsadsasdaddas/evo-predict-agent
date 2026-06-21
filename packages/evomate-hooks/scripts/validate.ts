import assert from 'node:assert/strict';
import {
  createMobileChatEvent,
  createWebChatEvent,
  normalizeHookInput,
  toAgentObservePayload,
  toAgentOutcomePayload
} from '../src/index.js';

const mobile = normalizeHookInput(createMobileChatEvent({
  eventKind: 'user_message',
  content: '帮我总结这段聊天，但先别乱改任何设置。',
  sessionId: 'mobile-demo',
  device: 'ios'
}));
assert.equal(mobile.ok, true);
assert.equal(mobile.events[0].channel, 'mobile-chat');
assert.equal(mobile.events[0].route, 'advisor');
assert.equal(toAgentObservePayload(mobile.events[0]).source, 'mobile-chat');

const web = normalizeHookInput(createWebChatEvent({
  eventKind: 'copy',
  content: '用户复制了答案',
  score: 0.9,
  sessionId: 'web-demo'
}));
assert.equal(web.ok, true);
assert.equal(web.events[0].route, 'outcome');
assert.equal(toAgentOutcomePayload(web.events[0]).kind, 'accepted');

const batch = normalizeHookInput({
  events: [
    { source: 'browser-extension', event: 'regenerate', channel: 'browser-extension', content: '用户要求重试' },
    { source: 'codex', event: 'UserPromptSubmit', content: '看一下项目结构' }
  ]
});
assert.equal(batch.ok, true);
assert.equal(batch.events.length, 2);
assert.equal(batch.events[0].route, 'outcome');
assert.equal(batch.events[1].route, 'advisor');

const passiveWeb = normalizeHookInput({
  source: 'browser-extension:gemini',
  channel: 'browser-extension',
  eventKind: 'user_message',
  route: 'observe',
  content: '这是一条被动监听到的网页端用户消息，应该快速入库，不触发 advisor。'
});
assert.equal(passiveWeb.ok, true);
assert.equal(passiveWeb.events[0].eventKind, 'user_message');
assert.equal(passiveWeb.events[0].route, 'observe');

console.log('evomate hook protocol validation ok');
