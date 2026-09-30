// Kmong marketer: title rules, contact-info guard, audit, funnel diagnosis, stats file, brief/export, CLI smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as K from '../tools/lib/kmong.mjs';
import { loadContent } from '../tools/lib/content.mjs';
import { makeProject, work, write, fakePng, REPO } from './helpers.mjs';

const priced = (over = {}) =>
  K.normalizeGig({
    title: '영상 색보정 해 드립니다',
    keywords: ['색보정', '컬러그레이딩', '영상 색보정', '컬러리스트', '다빈치 리졸브'],
    packages: [
      { tier: 'STANDARD', name: 'S', price: 100000, days: 3, revisions: 1, includes: ['a'] },
      { tier: 'DELUXE', name: 'D', price: 200000, days: 5, revisions: 2, includes: ['a', 'b'] },
      { tier: 'PREMIUM', name: 'P', price: 400000, days: 7, revisions: 3, includes: ['a', 'b', 'c'] },
    ],
    ...over,
  });

const byId = (audit, id) => audit.items.filter((i) => i.id === id);

test('title length ignores spaces; special characters and emoji are flagged', () => {
  assert.equal(K.titleLength('영상 색보정 컬러그레이딩 DI 해 드립니다'), 18);
  assert.deepEqual(K.titleBadChars('영상 색보정 해 드립니다'), []);
  assert.deepEqual(K.titleBadChars('색보정! ✨ · 전문'), ['!', '✨', '·']);
});

test('contact info and external links are detected, ordinary copy is not', () => {
  const labels = (t) => K.findContactInfo(t).map((x) => x.label);
  assert.deepEqual(labels('문의는 crafttone3@gmail.com'), ['이메일 주소']);
  assert.deepEqual(labels('010-1234-5678 로 연락'), ['휴대폰 번호']);
  assert.deepEqual(labels('포트폴리오 https://tonecraft.kr 참고'), ['외부 링크']);
  assert.deepEqual(labels('카톡 주세요'), ['메신저 연락처']);
  assert.deepEqual(labels('ProRes 422 HQ · H.264 납품, 타임코드 00:00:12'), []);
});

test('the shipped content/kmong.mjs loads and passes the hard rules', async () => {
  const { gig, error } = await K.loadGig(REPO);
  assert.equal(error, null);
  assert.ok(K.titleLength(gig.title) <= gig.rules.titleMaxChars);
  assert.deepEqual(K.titleBadChars(gig.title), []);
  for (const t of gig.titleCandidates) assert.ok(K.titleLength(t) <= gig.rules.titleMaxChars && !K.titleBadChars(t).length, t);
  const { site, works } = await loadContent(REPO);
  const audit = await K.auditGig(gig, { site, works, root: REPO });
  assert.equal(byId(audit, 'contact')[0].level, 'ok', 'no contact info in the listing');
  assert.equal(byId(audit, 'hype')[0].level, 'ok');
  assert.equal(byId(audit, 'tpl-inquiryReply')[0].level, 'ok');
});

test('audit: complete listing scores higher than an empty one; missing prices are a fail', async () => {
  const empty = await K.auditGig(K.normalizeGig({}), {});
  const full = await K.auditGig(priced(), { works: ['a', 'b', 'c'].map((s) => work(s)) });
  assert.ok(full.score > empty.score, `${full.score} > ${empty.score}`);
  const noPrice = await K.auditGig(priced({ packages: [{ tier: 'STANDARD', price: null }] }), {});
  assert.equal(byId(noPrice, 'price')[0].level, 'fail');
  assert.equal(byId(noPrice, 'packages')[0].level, 'warn');
});

test('audit: title over the limit, prices out of order, contact info → fail', async () => {
  const a = await K.auditGig(
    priced({
      title: '영상 색보정 컬러그레이딩 뮤직비디오 광고 전문 해 드립니다',
      description: { intro: '메일 a@b.co 로 문의' },
      packages: [
        { tier: 'STANDARD', price: 300000 },
        { tier: 'DELUXE', price: 200000 },
        { tier: 'PREMIUM', price: 400000 },
      ],
    }),
    {},
  );
  assert.equal(byId(a, 'title-length')[0].level, 'fail');
  assert.equal(byId(a, 'price-order')[0].level, 'fail');
  assert.equal(byId(a, 'contact')[0].level, 'fail');
  assert.equal(K.topFixes(a.items)[0].level, 'fail');
});

test('audit: portfolio may only list public, consented works', async () => {
  const works = [work('ok-1'), work('ok-2'), work('ok-3'), work('secret', { consent: 'pending' }), work('draft', { publish: false })];
  const a = await K.auditGig(priced({ portfolio: ['ok-1', 'secret', 'draft'] }), { works });
  const f = byId(a, 'portfolio-consent')[0];
  assert.equal(f.level, 'fail');
  assert.match(f.msg, /secret, draft/);
  const b = await K.auditGig(priced({ portfolio: ['ok-1', 'ok-2'] }), { works });
  assert.equal(byId(b, 'portfolio-consent').length, 0);
  assert.equal(byId(b, 'portfolio')[0].level, 'ok');
});

test('audit: main image size is read from the file', async () => {
  const root = await makeProject();
  await write(path.join(root, 'marketing', 'good.png'), fakePng(652, 488));
  await write(path.join(root, 'marketing', 'big.png'), fakePng(1304, 976));
  await write(path.join(root, 'marketing', 'wide.png'), fakePng(1200, 630));
  const level = async (f) => byId(await K.auditGig(priced({ mainImage: f }), { root }), 'image')[0].level;
  assert.equal(await level('marketing/good.png'), 'ok');
  assert.equal(await level('marketing/big.png'), 'warn');
  assert.equal(await level('marketing/wide.png'), 'fail');
  assert.equal(await level('marketing/missing.png'), 'fail');
});

test('weekStart → Monday; isDate rejects impossible dates', () => {
  assert.equal(K.weekStart(new Date(2026, 8, 30)), '2026-09-28'); // Wed
  assert.equal(K.weekStart(new Date(2026, 8, 28)), '2026-09-28'); // Mon
  assert.equal(K.weekStart(new Date(2026, 9, 4)), '2026-09-28'); // Sun
  assert.ok(K.isDate('2026-02-28'));
  assert.ok(!K.isDate('2026-02-30'));
  assert.ok(!K.isDate('2026-9-1'));
});

test('diagnose: finds the leaking stage and ignores tiny samples', () => {
  let s = K.emptyStats();
  s = K.upsertWeek(s, '2026-09-21', { impressions: 2000, clicks: 20, inquiries: 2, orders: 1 });
  let d = K.diagnose(s);
  assert.equal(d.findings[0].key, 'ctr', 'CTR 1% < 2%');
  assert.ok(d.lowSample.some((x) => x.startsWith('주문율')), '2 inquiries is too few to judge');

  s = K.upsertWeek(s, '2026-09-28', { impressions: 150, clicks: 2, inquiries: 0 });
  d = K.diagnose(s);
  assert.equal(d.week, '2026-09-28');
  assert.equal(d.findings[0].key, 'impressions');
  assert.ok(!d.findings.some((f) => f.key === 'inquiryRate'), '0 of 2 clicks is noise');
  assert.equal(d.change.impressions, -1850);

  // merging keeps earlier metrics of the same week
  s = K.upsertWeek(s, '2026-09-28', { orders: 0 });
  assert.equal(s.weeks.at(-1).impressions, 150);
  assert.equal(s.weeks.at(-1).orders, 0);
  assert.equal(K.diagnose(K.emptyStats()), null);
});

test('stats round-trip through marketing/stats.json', async () => {
  const root = await makeProject();
  assert.deepEqual(await K.loadStats(root), K.emptyStats());
  let s = K.upsertWeek(K.emptyStats(), '2026-09-21', { impressions: 10 });
  s = K.addNote(s, '2026-09-23', '제목 교체');
  await K.saveStats(root, s);
  const back = await K.loadStats(root);
  assert.equal(back.weeks[0].impressions, 10);
  assert.equal(back.notes[0].text, '제목 교체');
});

test('export and brief include the listing; the brief never includes non-public works', async () => {
  const gig = priced({ description: { intro: '소개 문장', recommendFor: ['추천 1'] } });
  const works = [work('open-work', { title: '공개 작품' }), work('hidden', { title: '비밀 작품', consent: 'pending' })];
  const text = K.renderListing(gig, { faq: [{ q: '질문?', a: '답.' }], process: [{ title: '단계', body: '' }] });
  assert.match(text, /영상 색보정 해 드립니다/);
  assert.match(text, /■ 이런 분께 추천합니다\n\n· 추천 1/);
  assert.match(text, /\[DELUXE\] D\n가격: 200,000원/);
  assert.match(text, /Q\. 질문\?\nA\. 답\./);
  const brief = K.buildBrief('reply', { gig, site: { brand: { name: 'TONECRAFT' } }, works, audit: null, stats: null, input: '색보정 문의드립니다' });
  assert.match(brief, /공개 작품/);
  assert.doesNotMatch(brief, /비밀 작품/);
  assert.match(brief, /색보정 문의드립니다/);
  assert.throws(() => K.buildBrief('nope', { gig }), /알 수 없는 작업/);
});

test('CLI: log → report → export → brief in a temp project (marketing/ only)', async () => {
  const root = await makeProject({ works: [work('a')] });
  await fsp.copyFile(path.join(REPO, 'content', 'kmong.mjs'), path.join(root, 'content', 'kmong.mjs'));
  const run = (...a) => spawnSync(process.execPath, [path.join(REPO, 'tools', 'marketer.mjs'), '--root', root, ...a], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

  let r = run('log', '--impressions', '1,200', '--clicks', '10', '--inquiries', '1', '--revenue', '150,000원', '--week', '2026-09-24');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2026-09-21 주/);
  r = run('note', '메인', '이미지', '교체', '--date', '2026-09-25');
  assert.equal(r.status, 0, r.stderr);
  r = run('report', '--json');
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.weeks[0].revenue, 150000);
  assert.equal(rep.notes[0].text, '메인 이미지 교체');
  assert.equal(rep.diagnosis.findings[0].key, 'ctr');

  r = run('audit', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).score > 0);
  r = run('export');
  assert.equal(r.status, 0, r.stderr);
  assert.match(await fsp.readFile(path.join(root, 'marketing', 'out', 'kmong-listing.txt'), 'utf8'), /검색 키워드/);
  r = run('brief', 'weekly');
  assert.equal(r.status, 0, r.stderr);
  assert.match(await fsp.readFile(path.join(root, 'marketing', 'out', 'brief-weekly.md'), 'utf8'), /최근 주간 통계/);

  assert.equal(run('log', '--clicks', '-3').status, 2);
  assert.equal(run('log', '--week', '2026-13-01', '--clicks', '1').status, 2);
  assert.equal(run('brief', 'nope').status, 2);
  assert.equal(run('wat').status, 2);
});
