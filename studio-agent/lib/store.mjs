// 데이터 저장소 — data/db.json 하나에 모든 상태를 담습니다.
// 규모가 작은 1인 스튜디오용이라 DB 서버 없이 파일 하나로 충분합니다.
// 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔서(원자적 교체) 중간에 꺼져도 파일이 깨지지 않습니다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Vault } from './vault.mjs';
import { defaultStaff, normalizeStaff } from './staff.mjs';
import { DEFAULT_CONTRACT } from './contract.mjs';

export const COLLECTIONS = [
  'clients', 'projects', 'messages', 'designs', 'quotes', 'invoices',
  'approvals', 'jobs', 'activity', 'leads', 'alerts', 'usage', 'accounts', 'lessons',
  'staff', 'reports', 'contracts',
];

const ACTIVITY_LIMIT = 3000;

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function defaultSettings() {
  return {
    apiKey: '',
    model: 'claude-opus-5-5',
    agentEffort: 'medium',
    designEffort: 'high',
    dailyBudgetUsd: 10,
    paused: false,
    publicUrl: 'http://localhost:4300',
    inboundToken: crypto.randomBytes(18).toString('base64url'),
    profile: {
      ownerName: '',
      ownerEmail: '',
      studioName: '',
      title: '프리랜서 디자이너',
      bio: '',
      specialties: '브랜드 아이덴티티, 로고, SNS 콘텐츠, 상세페이지, 포스터',
      languages: '한국어, English',
      tone: '친절하고 전문적인 존댓말. 짧고 명확하게. 과장하지 않음.',
      portfolio: '',
      workingHours: '평일 10:00–19:00 (KST)',
      signature: '',
    },
    services: [
      { id: 'logo', name: '로고 디자인', description: '시안 2종 + 수정 2회, AI/SVG/PNG 원본 제공', basePrice: 500000, minPrice: 350000, days: 7, revisions: 2 },
      { id: 'sns', name: 'SNS 콘텐츠 (5장 세트)', description: '인스타그램 피드·카드뉴스 5장', basePrice: 250000, minPrice: 180000, days: 4, revisions: 2 },
      { id: 'banner', name: '배너 · 썸네일', description: '웹/광고 배너 1종 (사이즈 3개까지)', basePrice: 120000, minPrice: 80000, days: 2, revisions: 2 },
      { id: 'poster', name: '포스터 · 전단', description: 'A2/A3 인쇄용 1종', basePrice: 300000, minPrice: 220000, days: 5, revisions: 2 },
      { id: 'detail', name: '상세페이지', description: '쇼핑몰 상세페이지 1종 (HTML/이미지)', basePrice: 700000, minPrice: 500000, days: 10, revisions: 2 },
    ],
    policy: {
      currency: 'KRW',
      depositPercent: 50,
      requireDeposit: true,
      rushFeePercent: 30,
      extraRevisionPrice: 50000,
      conceptsPerRound: 2,
      paymentInfo: '',
      businessInfo: '',
      retention: '프로젝트 종료 후 3년 (분쟁 대응 목적), 이후 지체 없이 파기',
      outreachDailyLimit: 20,
      extraInstructions: '',
    },
    autonomy: {
      client_reply: 'auto',
      quote: 'auto',
      delivery: 'auto',
      invoice: 'auto',
      outreach: 'approve',
    },
    design: { selfReview: true, maxReworks: 2 },
    company: {
      requireContract: true,
      contractTemplate: DEFAULT_CONTRACT,
      standupHour: 9,
      overdueReminderDays: 3,
    },
    auth: { passwordHash: '' },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 저장된 설정에 새 기본값을 채워 넣습니다(버전이 올라가 항목이 늘어나도 안전).
export function mergeDefaults(defaults, saved) {
  if (!isPlainObject(saved)) return structuredClone(defaults);
  const out = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in saved)) out[k] = structuredClone(v);
    else if (isPlainObject(v) && isPlainObject(saved[k])) out[k] = mergeDefaults(v, saved[k]);
    else out[k] = saved[k];
  }
  for (const [k, v] of Object.entries(saved)) if (!(k in out)) out[k] = v;
  return out;
}

export class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.vault = new Vault(dir);
    this.load();
    // 처음 실행하면 기본 직원들을 채용합니다.
    if (!this.data.staff.length) {
      this.data.staff = defaultStaff().map((x) => ({ ...x, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
      this.save();
    }
    if (this.data.staff.some((x) => !x.dept || !x.position)) {
      this.data.staff = this.data.staff.map(normalizeStaff);
      this.save();
    }
  }

  load() {
    let raw = {};
    if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.data = { settings: mergeDefaults(defaultSettings(), raw.settings) };
    for (const c of COLLECTIONS) this.data[c] = Array.isArray(raw[c]) ? raw[c] : [];
    this.save();
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    // API 키가 들어 있으므로 본인만 읽을 수 있게(0600) 저장합니다.
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    // 객체는 항목별로 합치고, 배열(서비스 목록 등)은 통째로 바꿉니다.
    deepAssign(this.data.settings, patch);
    this.save();
    this.emit('change', { collection: 'settings' });
    return this.data.settings;
  }

  all(col) {
    return this.data[col];
  }

  get(col, id) {
    return this.data[col].find((x) => x.id === id) ?? null;
  }

  find(col, pred) {
    return this.data[col].filter(pred);
  }

  findOne(col, pred) {
    return this.data[col].find(pred) ?? null;
  }

  insert(col, obj) {
    const now = new Date().toISOString();
    const row = { id: newId(col.slice(0, 3)), createdAt: now, updatedAt: now, ...obj };
    this.data[col].push(row);
    this.save();
    this.emit('change', { collection: col, id: row.id, op: 'insert' });
    return row;
  }

  update(col, id, patch) {
    const row = this.get(col, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    this.save();
    this.emit('change', { collection: col, id, op: 'update' });
    return row;
  }

  remove(col, id) {
    const i = this.data[col].findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.data[col].splice(i, 1);
    this.save();
    this.emit('change', { collection: col, id, op: 'remove' });
    return true;
  }

  // 활동 기록 — 대시보드의 실시간 피드에 그대로 나옵니다.
  log(kind, text, meta = {}) {
    const row = this.insert('activity', { kind, text, ...meta });
    if (this.data.activity.length > ACTIVITY_LIMIT) {
      this.data.activity.splice(0, this.data.activity.length - ACTIVITY_LIMIT);
      this.save();
    }
    this.emit('activity', row);
    return row;
  }

  alert(level, text, meta = {}) {
    const row = this.insert('alerts', { level, text, dismissed: false, ...meta });
    this.log('alert', text, meta);
    this.emit('alert', row);
    return row;
  }
}

function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(target[k])) deepAssign(target[k], v);
    else target[k] = v;
  }
}
