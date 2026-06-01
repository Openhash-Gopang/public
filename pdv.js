/**
 * pdv.js — K-Public PDV 기록 모듈 v2.0
 * gopang-proxy /pdv/report 엔드포인트 연동
 * school/report.js 의 sendToPDV() 패턴 준수
 */

const PROXY   = 'https://gopang-proxy.tensor-city.workers.dev';
const SVC_ID  = 'public';
const PDV_VER = '1.0';

function _getUserIpv6() {
  try {
    const s = JSON.parse(sessionStorage.getItem('gopang_sso_token') || 'null');
    return s?.ipv6 || 'anonymous';
  } catch { return 'anonymous'; }
}

async function _hashReport(obj) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(JSON.stringify(obj))
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

async function _sendToPDV(reportPayload) {
  try {
    const res = await fetch(`${PROXY}/pdv/report`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ report: reportPayload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `PDV HTTP ${res.status}`);
    }
    const ack = await res.json();
    console.info('[K-Public PDV] 기록 완료:', ack.pdv_entry);
    return ack;
  } catch(e) {
    console.warn('[K-Public PDV] 전송 실패 (로컬 백업):', e.message);
    _localBackup(reportPayload);
    return null;
  }
}

function _localBackup(payload) {
  try {
    const key  = 'kpublic_pdv_pending';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push({ payload, failedAt: new Date().toISOString() });
    if (list.length > 200) list.splice(0, list.length - 200);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

async function _flushPending() {
  try {
    const key  = 'kpublic_pdv_pending';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    if (!list.length) return;
    const failed = [];
    for (const item of list) {
      const ack = await _sendToPDV(item.payload);
      if (!ack) failed.push(item);
    }
    localStorage.setItem(key, JSON.stringify(failed));
  } catch {}
}

// ═══════════════════════════════════════════════════════════
const PDV = {

  /**
   * AI 공무원 상담 기록
   * @param {object} opts — { userMsg, aiMsg, requestType }
   */
  async writeConsult({ userMsg = '', aiMsg = '', requestType = 'general' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-consult-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_consult',
      id,
      content_hash: await _hashReport({ id, userMsg, requestType, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: 'K-Public AI 공무원 상담' },
      what: {
        summary:      userMsg.slice(0, 200) || `행정 상담: ${requestType}`,
        request_type: requestType,
        ai_response:  aiMsg.slice(0, 300),
      },
      how:  { method: 'K-Public AI 공무원 상담 + 법령 실시간 조회' },
      why:  { goal: '공공 행정 서비스 접근성 향상', triggered: 'public_consult' },
    });
  },

  /**
   * 민원 서류 발급 기록
   * @param {object} opts — { docType, agency, purpose, refNo }
   */
  async writeCivil({ docType = '', agency = '', purpose = '', refNo = '' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-civil-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_civil',
      id,
      content_hash: await _hashReport({ id, docType, agency, refNo, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: agency },
      what: {
        summary:  `민원 서류 발급: ${docType} — ${purpose}`,
        doc_type: docType,
        agency,
        purpose,
        ref_no:   refNo,
      },
      how:  { method: 'K-Public AI 공무원 서류 자동 작성·제출 대행' },
      why:  { goal: '민원 행정 기록 보관 (전자정부법 준수)', triggered: 'public_civil' },
      analysis: { risk_level: 'medium' },
    });
  },

  /**
   * 인허가 신청 기록
   * @param {object} opts — { permitType, agency, description, status, refNo }
   */
  async writePermit({ permitType = '', agency = '', description = '', status = 'submitted', refNo = '' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-permit-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_permit',
      id,
      content_hash: await _hashReport({ id, permitType, agency, refNo, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: agency },
      what: {
        summary:     `인허가 신청: ${permitType} — ${description.slice(0, 100)}`,
        permit_type: permitType,
        agency,
        description,
        status,
        ref_no:      refNo,
      },
      how:  { method: 'K-Public AI 공무원 인허가 서류 작성·제출 대행' },
      why:  { goal: '인허가 신청 기록 보관', triggered: 'public_permit' },
      analysis: { risk_level: 'high' },
    });
  },

  /**
   * 공공 시설 신고 기록
   * @param {object} opts — { reportType, location, description, agency, ticketNo }
   */
  async writeReport({ reportType = '', location = '', description = '', agency = '', ticketNo = '' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-report-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_facility_report',
      id,
      content_hash: await _hashReport({ id, reportType, location, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: location },
      what: {
        summary:     `시설 신고: ${reportType} — ${location}`,
        report_type: reportType,
        location,
        description,
        agency,
        ticket_no:   ticketNo,
      },
      how:  { method: 'K-Public AI 공무원 담당 부서 자동 배정 + 추적' },
      why:  { goal: '공공 시설 개선 및 신고 기록 보관', triggered: 'public_facility_report' },
    });
  },

  /**
   * 복지·지원금 신청 기록
   * @param {object} opts — { serviceName, agency, amount, status, refNo }
   */
  async writeWelfare({ serviceName = '', agency = '', amount = '', status = 'applied', refNo = '' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-welfare-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_welfare',
      id,
      content_hash: await _hashReport({ id, serviceName, agency, refNo, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: agency },
      what: {
        summary:      `복지 신청: ${serviceName} — ${amount}`,
        service_name: serviceName,
        agency,
        amount,
        status,
        ref_no:       refNo,
      },
      how:  { method: 'K-Public AI 공무원 PDV 기반 맞춤 복지 탐색·신청 대행' },
      why:  { goal: '복지 수혜 기록 보관', triggered: 'public_welfare' },
      analysis: { risk_level: 'medium' },
    });
  },

  /**
   * 세금·과태료 기록
   * @param {object} opts — { taxType, amount, agency, status, refNo }
   */
  async writeTax({ taxType = '', amount = 0, agency = '', status = 'paid', refNo = '' } = {}) {
    const ipv6 = _getUserIpv6();
    const now  = new Date().toISOString();
    const id   = `RPT-public-tax-${Date.now()}`;

    return _sendToPDV({
      svc:          SVC_ID,
      type:         'public_tax',
      id,
      content_hash: await _hashReport({ id, taxType, amount, refNo, now }),
      who:  { ipv6, role: 'citizen', recipients: ['gopang-pdv'] },
      when: { generated_at: now, period_start: now, period_end: now },
      where: { svc_url: 'https://public.gopang.net', label: agency },
      what: {
        summary:  `세금·과태료: ${taxType} — ${amount.toLocaleString()}원`,
        tax_type: taxType,
        amount,
        agency,
        status,
        ref_no:   refNo,
      },
      how:  { method: 'K-Public AI 공무원 세금 조회·납부 안내' },
      why:  { goal: '납세 기록 보관 (지방세기본법 준수)', triggered: 'public_tax' },
      analysis: { risk_level: 'high' },
    });
  },

  flushPending: _flushPending,
};

window.addEventListener('load', () => setTimeout(_flushPending, 3000));
window.PDV = PDV;
export { PDV };
