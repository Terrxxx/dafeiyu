import test from 'node:test';
import assert from 'node:assert/strict';
import { Personality } from '../src/personality.js';
import { Agent } from '../src/agent.js';
import { Bilibili, videoSummary } from '../src/bilibili.js';

const store = () => ({ data: {}, save() {}, audit() {} });
test('兴趣积累需多次阅读，重复视频不改变偏好，重建实例保留结果', () => {
  const s = store(); const p = new Personality(s);
  p.rateVideo({ bvid: 'a', category: '音乐' }, 1);
  assert.equal(p.rateVideo({ bvid: 'a', category: '音乐' }, -1).skipped, true);
  assert.ok(!p.prompt('a').includes('音乐'));
  p.rateVideo({ bvid: 'b', category: '音乐' }, 1);
  p.rateVideo({ bvid: 'c', category: '音乐' }, 1);
  assert.ok(new Personality(s).prompt('a').includes('音乐'));
  assert.equal(p.data.interests[0].samples, 3);
  assert.ok(p.data.interests[0].score < 0.4);
});
test('表达调整要求原话证据，每项最多0.05，隔离不同会话', () => {
  const p = new Personality(store());
  const messages = [{ role: 'user', content: '短一点，别写那么多；少问问题' }];
  p.applyReflection('a', [
    { trait: 'brevity', direction: 1, evidence: '短一点' },
    { trait: 'brevity', direction: 1, evidence: '别写那么多' },
  ], messages);
  assert.equal(p.conversation('a').style.brevity, 0.85);
  assert.equal(p.conversation('b').style.brevity, 0.8);
  p.applyReflection('a', [{ trait: 'questions', direction: 1, evidence: '多问问题' }], messages);
  assert.equal(p.conversation('a').style.questions, 0.2);
  assert.ok(!p.prompt('b').includes('短一点'));
  for (let i = 0; i < 8; i++) assert.equal(p.observe('a', '消息'), false);
});
test('自动兴趣复盘只接受本轮实际读取的视频，禁用工具与历史写入', async () => {
  const a = new Agent({}, store(), {});
  a.run = async (scope, prompt, tools, options) => {
    assert.equal(tools, false); assert.equal(options.remember, false);
    return JSON.stringify({ ratings: [{ bvid: 'real', rating: 1 }, { bvid: 'invented', rating: 1 }] });
  };
  await a.reflectVideos(new Map([['real', { bvid: 'real', category: '音乐' }]]));
  assert.deepEqual(a.personality.data.videoVotes, ['real']);
});
test('B站统计保留零值，清理搜索高亮，评论去重限量且只读', async () => {
  const summary = videoSummary({ title: '<em>测试</em>', stat: { view: 0, like: 0 } });
  assert.equal(summary.title, '测试'); assert.equal(summary.stats.views, 0);
  const bili = new Bilibili(''); const calls = [];
  const replies = Array.from({ length: 30 }, (_, i) => ({ rpid: i + 1, content: { message: '评论' } }));
  bili.api = async (endpoint, params, post) => {
    calls.push(endpoint); assert.ok(!post);
    return endpoint.endsWith('/view') ? { aid: 1, stat: { like: 2 } } : { hots: replies.slice(0, 2), replies, page: { count: 100 } };
  };
  const result = await bili.comments('BV1234567890');
  assert.equal(result.comments.length, 20);
  assert.equal(new Set(result.comments.map(x => x.id)).size, 20);
  await bili.stats('BV1234567890');
  assert.ok(calls.every(x => !x.includes('history')));
  await assert.rejects(() => bili.related('bad'));
  await assert.rejects(() => bili.search(''));
});
