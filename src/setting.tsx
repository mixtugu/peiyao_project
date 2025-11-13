import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

/**
 * /setting 페이지
 * - 20개의 프레임을 자유 배치(드래그) + 리사이즈 가능
 * - 각 프레임의 (x,y,w,h)를 Supabase 테이블(setting_layouts)에 저장/복원
 * - 배경/프레임은 모두 흰색, 평소엔 테두리 없음, 호버 시 연한 회색 테두리
 */

// Vite 환경변수
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// lockeddata 행 타입 (사용하는 필드만)
type LockedRow = { id: string; nfc_id: string | null; created_at: string | null };

// 레이아웃 테이블 행 타입
export type SettingLayoutRow = {
  id: string;      // frame-1 ~ frame-20 고정 ID
  x: number;
  y: number;
  w: number;
  h: number;
  updated_at?: string | null;
};

export default function SettingPage() {
  const [views, setViews] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number; // 프레임 내에서 클릭 지점 x 오프셋
    offsetY: number; // 프레임 내에서 클릭 지점 y 오프셋
    canvasLeft: number; // 캔버스 화면상의 좌표 기준 (getBoundingClientRect)
    canvasTop: number;
    scrollLeft: number; // 캔버스 스크롤 보정
    scrollTop: number;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [topId, setTopId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resizeObservers = useRef<Record<string, ResizeObserver>>({});

  // 1) Supabase에서 기존 레이아웃 로드 → views 초기화
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('setting_layouts')
          .select('id,x,y,w,h');

        if (error) throw error;

        const map: Record<string, { x: number; y: number; w: number; h: number }> = {};
        if (Array.isArray(data)) {
          for (const it of data as SettingLayoutRow[]) {
            if (it && it.id) {
              map[it.id] = { x: Number(it.x), y: Number(it.y), w: Number(it.w), h: Number(it.h) };
            }
          }
        }
        setViews(map); // ❗️기본 배치 채우지 않음
      } catch (e: any) {
        console.error('[setting_layouts select] error:', e);
        setStatusMsg(`[로드 실패] ${e?.message ?? e}`);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // 2) views 변화 디바운스 저장 (Supabase upsert)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const entries = Object.entries(views);
        if (entries.length === 0) return; // 저장할 항목 없음
        const payload: SettingLayoutRow[] = entries.map(([id, v]) => ({
          id,
          x: Math.round(v.x),
          y: Math.round(v.y),
          w: Math.round(v.w),
          h: Math.round(v.h),
        }));
        const { error } = await supabase
          .from('setting_layouts')
          .upsert(payload, { onConflict: 'id' });
        if (error) {
          console.error('[setting_layouts upsert] error:', error);
          setStatusMsg(`[저장 실패] ${error.message ?? error}`);
        }
      } catch (e: any) {
        console.error(e);
        setStatusMsg(`[저장 예외] ${e?.message ?? e}`);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [views]);

  // 3) 전역 마우스 핸들러 (드래그 이동)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const { id, offsetX, offsetY, canvasLeft, canvasTop, scrollLeft, scrollTop } = dragging;
      setViews((prev) => {
        const cur = prev[id] ?? { x: 0, y: 0, w: 260, h: 180 };
        const nextX = e.clientX - canvasLeft + scrollLeft - offsetX;
        const nextY = e.clientY - canvasTop + scrollTop - offsetY;
        if (Math.round(cur.x) === Math.round(nextX) && Math.round(cur.y) === Math.round(nextY)) return prev;
        return { ...prev, [id]: { ...cur, x: nextX, y: nextY } };
      });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // 4) 리사이즈 감지: 각 프레임에 ResizeObserver 부착하여 w/h 반영
  const setItemRef = (id: string, el: HTMLDivElement | null) => {
    if (resizeObservers.current[id]) {
      try { resizeObservers.current[id].disconnect(); } catch {}
      delete resizeObservers.current[id];
    }
    itemRefs.current[id] = el;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setViews((prev) => {
        const cur = prev[id] ?? { x: 0, y: 0, w: rect.width, h: rect.height };
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (Math.round(cur.w) === w && Math.round(cur.h) === h) return prev;
        return { ...prev, [id]: { ...cur, w, h } };
      });
    });
    ro.observe(el);
    resizeObservers.current[id] = ro;
  };

  // 언마운트 시 옵저버 정리
  useEffect(() => {
    return () => {
      Object.values(resizeObservers.current).forEach((ro) => {
        try { ro.disconnect(); } catch {}
      });
      resizeObservers.current = {};
      itemRefs.current = {};
    };
  }, []);

  // ===== Cleanup handler: currentdata 전체 삭제 + lockeddata 중복(nfc_id)에서 최신(더 새로운) 행 삭제 =====
  const handleCleanup = async () => {
    try {
      setStatusMsg('정리 중...');

      // 1) currentdata: 모든 행 삭제 (id 목록을 읽어와 in(...) 삭제)
      const { data: currentIds, error: curSelErr } = await supabase
        .from('currentdata')
        .select('id');
      if (curSelErr) throw curSelErr;
      const curIdList = (currentIds ?? []).map((r: any) => r.id).filter(Boolean);
      if (curIdList.length > 0) {
        const { error: curDelErr } = await supabase
          .from('currentdata')
          .delete()
          .in('id', curIdList);
        if (curDelErr) throw curDelErr;
      }

      // 2) lockeddata: 같은 nfc_id 내에서 "더 새로운(created_at 최신)" 행들을 삭제 → 가장 오래된 행만 보존
      const { data: lockedRows, error: lockedSelErr } = await supabase
        .from('lockeddata')
        .select('id, nfc_id, created_at');
      if (lockedSelErr) throw lockedSelErr;

      const byNfc: Record<string, LockedRow[]> = {};
      (lockedRows as LockedRow[] | null)?.forEach((row) => {
        const key = String(row.nfc_id ?? '');
        if (!byNfc[key]) byNfc[key] = [];
        byNfc[key].push(row);
      });

      const idsToDelete: string[] = [];
      Object.values(byNfc).forEach((rows) => {
        if (rows.length <= 1) return;
        // created_at 내림차순(최신 먼저) → 최신들을 모두 삭제하고, 가장 오래된(마지막)만 보존
        rows.sort((a, b) => {
          const ta = a.created_at ? Date.parse(a.created_at) : 0;
          const tb = b.created_at ? Date.parse(b.created_at) : 0;
          return tb - ta; // desc
        });
        // 삭제 대상: 인덱스 0..length-2 (최신 것들)
        rows.slice(0, rows.length - 1).forEach((r) => r.id && idsToDelete.push(r.id));
      });

      if (idsToDelete.length > 0) {
        // Supabase in(...) 최대 개수 제한을 고려해 배치 삭제
        const chunkSize = 500;
        for (let i = 0; i < idsToDelete.length; i += chunkSize) {
          const chunk = idsToDelete.slice(i, i + chunkSize);
          const { error: delErr } = await supabase
            .from('lockeddata')
            .delete()
            .in('id', chunk);
          if (delErr) throw delErr;
        }
      }

      setStatusMsg(`정리 완료: currentdata ${curIdList.length}건 삭제, lockeddata ${idsToDelete.length}건 삭제`);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`[정리 실패] ${e?.message ?? e}`);
    }
  };

  // 렌더
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#ffffff' }}>
      {/* 절대(고정) 위치 정리 버튼: 다른 요소 레이아웃에 영향 없음 */}
      <button
        type="button"
        onClick={handleCleanup}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 2000,
          padding: '6px 10px',
          fontSize: 12,
          color: '#fff',
          background: '#ef4444',
          border: 'none',
          borderRadius: 6,
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
          cursor: 'pointer',
        }}
        title="currentdata 전체 삭제 / lockeddata 중복 최신 삭제"
      >
        clear
      </button>
      {statusMsg && (
        <div style={{ position: 'absolute', top: 48, left: 8, padding: '6px 8px', fontSize: 12, background: 'rgba(248,250,252,0.95)', border: '1px solid #e2e8f0', borderRadius: 6, color: '#0f172a' }}>
          {statusMsg}
        </div>
      )}
      <div
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#ffffff' }}
      >
        {isLoading ? null : (Object.keys(views).length === 0 && (
          <div style={{ position: 'absolute', top: 24, left: 24, color: '#64748b', fontSize: 13 }}>
            저장된 프레임 배치가 없습니다. (Supabase: setting_layouts)
          </div>
        ))}
        <div style={{ position: 'relative', minWidth: 1200, minHeight: 800 }}>
          {Object.entries(views).map(([id, v]) => (
            <div
              key={id}
              ref={(el) => setItemRef(id, el)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered((prev) => (prev === id ? null : prev))}
              onMouseDown={(e) => {
                setTopId(id);
                if (e.button !== 0) return;
                const el = canvasRef.current;
                if (!el) return;
                const parentRect = el.getBoundingClientRect();
                const cardEl = e.currentTarget as HTMLDivElement;
                const cardRect = cardEl.getBoundingClientRect();
                const gripThreshold = 18;
                const nearRight = cardRect.right - e.clientX <= gripThreshold;
                const nearBottom = cardRect.bottom - e.clientY <= gripThreshold;
                const isResizeGrip = nearRight && nearBottom;
                if (isResizeGrip) return;
                setDragging({
                  id,
                  offsetX: e.clientX - cardRect.left,
                  offsetY: e.clientY - cardRect.top,
                  canvasLeft: parentRect.left,
                  canvasTop: parentRect.top,
                  scrollLeft: el.scrollLeft,
                  scrollTop: el.scrollTop,
                });
              }}
              title={`${id}`}
              style={{
                position: 'absolute',
                left: Number(v.x),
                top: Number(v.y),
                width: Number(v.w),
                height: Number(v.h),
                border: hovered === id ? '1px solid #64748b' : '1px solid #cbd5e1',
                borderRadius: 8,
                background: '#ffffff',
                boxShadow: '0 0 0 rgba(0,0,0,0)',
                overflow: 'hidden',
                resize: 'both',
                cursor: hovered === id ? (dragging?.id === id ? 'grabbing' : 'grab') : 'default',
                userSelect: 'none',
                zIndex: topId === id ? 1000 : 1,
              }}
            >
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
                {id}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
