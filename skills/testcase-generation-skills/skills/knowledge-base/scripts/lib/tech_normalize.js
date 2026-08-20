/**
 * Demand 6.3 — URL / API 规范化与敏感值检测（契约层 helper）
 */
'use strict';

const SENSITIVE_KEY =
  /(token|access_token|refresh_token|authorization|cookie|sign|signature|password|passwd|secret|api[_-]?key)/i;
const REAL_ID_QUERY = /(tenant|user|order|bill|shop|store)[_-]?(id)?=/i;

function normalizeMethod(method) {
  if (method == null || method === '') return null;
  const m = String(method).trim().toUpperCase();
  const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS', 'NONE', 'PENDING']);
  return allowed.has(m) ? m : null;
}

function stripHost(urlOrPath) {
  const s = String(urlOrPath || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.pathname + (u.search || '');
    } catch {
      return s;
    }
  }
  return s;
}

function placeholderizePath(pathLike) {
  let p = stripHost(pathLike);
  // 常见数字/UUID 段 → {id}
  p = p.replace(/\/[0-9]{2,}(?=\/|$)/g, '/{id}');
  p = p.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
    '/{id}'
  );
  // query 敏感或实值
  if (p.includes('?')) {
    const [base, qs] = p.split('?');
    const kept = [];
    for (const part of qs.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      if (SENSITIVE_KEY.test(k)) continue;
      if (v && !/^\{.+\}$/.test(v) && (/^\d+$/.test(v) || v.length > 24)) {
        kept.push(`${k}={${k}}`);
      } else if (v) {
        kept.push(`${k}=${v}`);
      } else {
        kept.push(k);
      }
    }
    p = kept.length ? `${base}?${kept.join('&')}` : base;
  }
  return p;
}

function findSensitiveIssues(text) {
  const issues = [];
  const s = String(text || '');
  if (/localhost|127\.0\.0\.1/i.test(s)) issues.push('contains_localhost');
  if (SENSITIVE_KEY.test(s) && /=/.test(s)) issues.push('contains_sensitive_query_or_header');
  if (/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(s)) issues.push('contains_bearer_token');
  if (REAL_ID_QUERY.test(s) && !/\{/.test(s)) issues.push('contains_real_business_id_query');
  return issues;
}

function normalizePageUrl(input) {
  const raw = typeof input === 'string' ? input : input && input.template;
  if (!raw) return { ok: false, errors: ['page_url.empty'] };
  const issues = findSensitiveIssues(raw);
  if (issues.length) return { ok: false, errors: issues };
  const absolute = /^https?:\/\//i.test(raw);
  if (absolute && /localhost|127\.0\.0\.1/i.test(raw)) {
    return { ok: false, errors: ['page_url.localhost_forbidden'] };
  }
  const template = absolute ? placeholderizePath(raw) : placeholderizePath(raw.startsWith('/') ? raw : `/${raw}`);
  // absolute 时仍存 path 模板，标记 absolute=false（可组合）；若需保留绝对可共享环境地址，仅当无敏感且非 localhost
  const keepAbsolute = absolute && !/localhost|127\.0\.0\.1/i.test(raw);
  return {
    ok: true,
    value: {
      template: keepAbsolute ? placeholderizePath(new URL(raw).pathname + (new URL(raw).search || '')) : template,
      absolute: false
    }
  };
}

function normalizeBackendApi(input) {
  const method = normalizeMethod(input && input.method);
  if (!method) return { ok: false, errors: ['backend_api.invalid_method'] };
  if (method === 'NONE' || method === 'PENDING') {
    return {
      ok: true,
      value: { method, path: method === 'NONE' ? '无后端调用（纯前端）' : '待确认', operation: input.operation || '' }
    };
  }
  const pathRaw = input.path || input.target || '';
  const issues = findSensitiveIssues(pathRaw);
  if (issues.length) return { ok: false, errors: issues };
  if (/^https?:\/\//i.test(pathRaw) || /:\d{2,5}/.test(pathRaw)) {
    // 允许带 host 输入，但规范化后只保留 path
  }
  const path = placeholderizePath(pathRaw);
  if (!path.startsWith('/') && method !== 'WS') {
    return { ok: false, errors: ['backend_api.path_must_start_with_slash'] };
  }
  return {
    ok: true,
    value: {
      method,
      path,
      operation: input.operation ? String(input.operation).slice(0, 20) : undefined
    }
  };
}

function selfTest() {
  const cases = [];
  const u1 = normalizePageUrl('/sales/order/12345');
  cases.push(['url placeholder', u1.ok && u1.value.template.includes('{id}')]);
  const u2 = normalizePageUrl('https://x.com/a?token=abc');
  cases.push(['url reject token', !u2.ok]);
  const a1 = normalizeBackendApi({ method: 'get', path: 'https://api.x.com/api/v1/orders/99' });
  cases.push(['api strip host', a1.ok && a1.value.method === 'GET' && a1.value.path === '/api/v1/orders/{id}']);
  const a2 = normalizeBackendApi({ method: 'POST', path: '/api?access_token=1' });
  cases.push(['api reject secret', !a2.ok]);
  const a3 = normalizeBackendApi({ method: 'NONE' });
  cases.push(['pure frontend', a3.ok && a3.value.method === 'NONE']);
  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('tech_normalize self-test failed:', failed.map(([n]) => n));
    process.exit(1);
  }
  console.log('✓ tech_normalize self-test');
}

module.exports = {
  normalizeMethod,
  normalizePageUrl,
  normalizeBackendApi,
  findSensitiveIssues,
  placeholderizePath,
  selfTest
};

if (require.main === module) selfTest();
