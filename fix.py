#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix.py — public(K-Public/kgov) 저장소 전용.

갭: webapp.html의 BYOK(사용자 본인 키) 경로(_govCallRaw 내부)는
/llm/relay로 직행하는데, /llm/relay는 메시지를 그대로 통과시켜 서버 강제
주입이 없다(worker.js 주석에 이미 명시된 설계). 이 경로는 그래서
클라이언트가 직접 공통 규칙을 system 메시지 앞에 붙이도록 만들어져 있는데
(_fetchKPublicCommonClient), 실제로는 K-Public_common만 붙이고
UNIVERSAL-INTEGRITY/UNIVERSAL-common은 안 붙인다(실사로 확인) — 무료
경로(/gov/relay, 서버가 두 레이어 다 강제 주입)와 BYOK 경로가 상속하는
레이어가 다르다.

조치:
  1) UNIVERSAL-INTEGRITY_v1_0.md + UNIVERSAL-common_v1_1.md를 함께 fetch해
     캐싱하는 _fetchUniversalLayerClient() 함수를 _fetchKPublicCommonClient
     바로 뒤에 신설(같은 실패 허용 패턴 그대로 따름 — 실패해도 K-Public
     common+agencyPrompt만으로 서비스 지속).
  2) _govCallRaw의 BYOK 분기에서 kPublicCommon과 병렬로 이 레이어도 가져와
     [UNIVERSAL-INTEGRITY+UNIVERSAL-common] → [K-Public_common] →
     [AGENCY_PROMPT] 순서로 조립.

실행 위치: public 저장소 루트에서 실행. webapp.html이 그 자리에 있어야 한다.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "webapp.html"

ANCHOR_FETCH_FN = """  } catch(e) { console.warn('[BYOK] K-Public 공통 규칙 로드 실패:', e.message); }
  return ''; // 실패해도 agencyPrompt만으로 서비스 지속
}
"""

UNIVERSAL_FETCH_FN = """
// 2026-07-07: BYOK 경로도 무료 경로(/gov/relay, 서버 강제 주입)와 동일하게
// UNIVERSAL-INTEGRITY+UNIVERSAL-common을 상속해야 한다(SP-CATALOG_v1_0.md
// §① 감사에서 발견 — 지금까지는 K-Public_common만 붙고 이 레이어는
// 빠져 있었다). /llm/relay는 서버 강제 주입이 없으므로 K-Public_common과
// 동일하게 클라이언트에서 직접 fetch해 붙인다.
const UNIVERSAL_INTEGRITY_RAW_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/UNIVERSAL-INTEGRITY_v1_0.md';
const UNIVERSAL_COMMON_RAW_URL    = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/UNIVERSAL-common_v1_1.md';
let _universalLayerClientCache = null;
async function _fetchUniversalLayerClient() {
  if (_universalLayerClientCache !== null) return _universalLayerClientCache;
  try {
    const [ri, rc] = await Promise.all([
      fetch(UNIVERSAL_INTEGRITY_RAW_URL, { cache: 'no-cache' }),
      fetch(UNIVERSAL_COMMON_RAW_URL,    { cache: 'no-cache' }),
    ]);
    const parts = [];
    if (ri.ok) parts.push(await ri.text());
    if (rc.ok) parts.push(await rc.text());
    _universalLayerClientCache = parts.join('\\n\\n---\\n\\n');
  } catch(e) {
    console.warn('[BYOK] UNIVERSAL 레이어 로드 실패:', e.message);
    _universalLayerClientCache = '';
  }
  return _universalLayerClientCache;
}
"""

OLD_GOVCALLRAW = """  const byok = _activeByok();
  if (byok) {
    const kPublicCommon = await _fetchKPublicCommonClient();
    const systemContent = kPublicCommon ? `${kPublicCommon}\\n\\n---\\n\\n${AGENCY_PROMPT}` : AGENCY_PROMPT;
    try {"""

NEW_GOVCALLRAW = """  const byok = _activeByok();
  if (byok) {
    const [universalLayer, kPublicCommon] = await Promise.all([
      _fetchUniversalLayerClient(), _fetchKPublicCommonClient(),
    ]);
    const systemLayers  = [universalLayer, kPublicCommon, AGENCY_PROMPT].filter(Boolean);
    const systemContent = systemLayers.join('\\n\\n---\\n\\n');
    try {"""


def main():
    if not TARGET.exists():
        print(f"[FAIL] 대상 파일 없음: {TARGET}")
        sys.exit(1)

    text = TARGET.read_text(encoding="utf-8")

    if "_fetchUniversalLayerClient" in text:
        print("[FAIL] 이미 패치된 것으로 보임(중복 실행 의심) — 변경 없이 종료")
        sys.exit(1)

    if ANCHOR_FETCH_FN not in text:
        print("[FAIL] 함수 삽입 지점(anchor 1)을 찾지 못함 — 원본이 변경된 것으로 보임. "
              "수동 확인 필요.")
        sys.exit(1)
    if text.count(ANCHOR_FETCH_FN) != 1:
        print(f"[FAIL] anchor 1이 {text.count(ANCHOR_FETCH_FN)}번 발견됨(1번이어야 함).")
        sys.exit(1)

    if OLD_GOVCALLRAW not in text:
        print("[FAIL] _govCallRaw BYOK 분기(anchor 2)를 찾지 못함 — 원본이 변경된 것으로 "
              "보임. 수동 확인 필요.")
        sys.exit(1)
    if text.count(OLD_GOVCALLRAW) != 1:
        print(f"[FAIL] anchor 2가 {text.count(OLD_GOVCALLRAW)}번 발견됨(1번이어야 함).")
        sys.exit(1)

    text = text.replace(ANCHOR_FETCH_FN, ANCHOR_FETCH_FN + UNIVERSAL_FETCH_FN, 1)
    text = text.replace(OLD_GOVCALLRAW, NEW_GOVCALLRAW, 1)

    TARGET.write_text(text, encoding="utf-8")

    check = TARGET.read_text(encoding="utf-8")
    ok = (
        "_fetchUniversalLayerClient" in check
        and "UNIVERSAL_INTEGRITY_RAW_URL" in check
        and "const systemLayers  = [universalLayer, kPublicCommon, AGENCY_PROMPT]" in check
    )
    if not ok:
        print("[FAIL] 검증 실패 — 파일은 써졌으나 내용이 기대와 다름.")
        sys.exit(1)

    print("[OK] webapp.html — BYOK 경로에 UNIVERSAL-INTEGRITY/UNIVERSAL-common 추가 완료")
    print("[OK] 검증 통과")


if __name__ == "__main__":
    main()
