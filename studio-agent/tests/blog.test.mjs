// 글 자동 작성 — 인스타 카드뉴스용 글을 가짜 Claude로 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, json, msg, text, SVG } from './helpers.mjs';
import { composeBlogPost, keepBlogQueue, coverSvg, blogImagePng, blogAiLine } from '../lib/blog.mjs';
import { maintenance } from '../lib/pm.mjs';

const writer = (body) => {
  const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  if (props.includes('sections')) {
    return json({ topic: '카페 로고 준비', title: '카페 로고 디자인 맡기기 전 준비할 5가지', intro: '카페 로고를 맡기기 전에 준비하면 좋은 것을 정리했어요.', sections: [
      { heading: '어디에 쓸지 먼저 정하기', body: '간판, 컵, 인스타그램 프로필처럼 쓰는 곳을 정하면 형태가 정해집니다.\n\n모모카페처럼 작은 공간은 간판 크기를 먼저 재 보세요.' },
      { heading: '색 고르기', body: '따뜻한 색 두 가지면 충분합니다.' },
      { heading: '예산과 수정 횟수', body: '로고는 50만 원부터, 수정 2회가 포함됩니다.' },
    ], outro: '궁금한 점은 댓글로 남겨 주세요.', tags: ['로고디자인', '카페로고', '#망원동', '브랜딩'] });
  }
  return msg([text('완료')]);
};

test('글: 동의한 작업은 사례 글로, 업체명은 동의 없으면 지우고, AI 표시와 표지 · 시안 이미지를 넣습니다', async () => {
  const { ctx } = makeCtx(writer);
  const { store } = ctx;
  const c = store.insert('clients', { name: '김사장', email: 'k@x.kr', company: '모모카페' });
  const p = store.insert('projects', { clientId: c.id, title: '모모카페 로고', serviceId: 'logo', status: 'completed', portfolioConsent: true, portfolioNamed: false, brief: '카페 로고' });
  const d = store.insert('designs', { projectId: p.id, title: '모모 피치', rationale: '복숭아', format: 'svg', code: SVG, approved: true });
  const post = await composeBlogPost(ctx, {});
  assert.equal(post.kind, 'case');
  assert.equal(post.projectId, p.id);
  assert.ok(!JSON.stringify(post).includes('모모카페'), '업체명 비공개');
  assert.equal(post.blocks[0].source, 'cover');
  assert.ok(post.blocks.some((b) => b.type === 'img' && b.designId === d.id), '확정 시안 이미지');
  assert.equal(post.blocks.at(-1).text, blogAiLine(store.settings));
  assert.deepEqual(post.tags, ['로고디자인', '카페로고', '망원동', '브랜딩']);
  assert.equal(blogImagePng(store, post, 0).readUInt32BE(0), 0x89504e47, '표지 PNG');
  assert.equal(blogImagePng(store, post, 1).readUInt32BE(0), 0x89504e47, '시안 PNG');
  const next = await composeBlogPost(ctx, {});
  assert.equal(next.kind, 'topic', '같은 작업은 다시 쓰지 않고 주제 글로');
  store.update('projects', p.id, { simulation: true });
  assert.equal(await composeBlogPost(ctx, { projectId: p.id }), null, '연습 프로젝트는 쓰지 않음');
});

test('인스타그램이 연결되면 글을 정한 수만큼 미리 써 둡니다', async () => {
  const { ctx } = makeCtx(writer);
  const { store } = ctx;
  keepBlogQueue(store);
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'blog_compose'), '연결 전에는 쓰지 않음');
  store.updateSettings({ social: { enabled: true }, blog: { keepReady: 2 } });
  store.insert('accounts', { kind: 'instagram', enabled: true, status: 'ok' });
  maintenance(store);
  assert.ok(store.findOne('jobs', (j) => j.kind === 'blog_compose' && j.status === 'queued'));
  maintenance(store);
  assert.equal(store.find('jobs', (j) => j.kind === 'blog_compose').length, 1, '중복 예약 없음');
  assert.ok(coverSvg(store.settings, '아주 긴 제목이 여러 줄로 나뉘어 들어가는지 확인하는 테스트 제목').includes('<text'));
});