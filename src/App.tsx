import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';


// Vite 환경변수 (.env)
// VITE_SUPABASE_URL=...
// VITE_SUPABASE_ANON_KEY=...
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Supabase 클라이언트
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type UnlockedRow = {
  id: string;
  image_url: string | null;
  created_at?: string | null;
};

type FrameLayout = {
  id: string; // 'frame-1' ~ 'frame-20'
  x: number;
  y: number;
  w: number;
  h: number;
};

function App() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [frames, setFrames] = useState<FrameLayout[]>([]);

  const [rows, setRows] = useState<UnlockedRow[]>([]);

  // 1) 초기 로드
  useEffect(() => {
    const fetchImages = async () => {
      try {
        const { data, error } = await supabase
          .from('unlockeddata')
          .select('id, image_url, created_at')
          .order('created_at', { ascending: false })
          .limit(16);

        if (error) throw error;

        const cleaned =
          (data ?? [])
            .filter((r) => !!r.image_url)
            .map((r) => ({
              id: r.id as string,
              image_url: r.image_url as string,
              created_at: r.created_at ?? null,
            }));

        setRows(cleaned.slice(0, 16));
      } catch (e: any) {
        console.error(e?.message ?? '데이터를 불러오는 중 오류가 발생했습니다.');
      }
    };

    fetchImages();
  }, []);

  // 1-2) 프레임 레이아웃 로드 (setting_layouts)
  useEffect(() => {
    const loadFrames = async () => {
      try {
        const { data, error } = await supabase
          .from('setting_layouts')
          .select('id,x,y,w,h');
        if (error) throw error;
        const list = (data ?? []).map((r: any) => ({
          id: String(r.id),
          x: Number(r.x),
          y: Number(r.y),
          w: Number(r.w),
          h: Number(r.h),
        })) as FrameLayout[];
        // id의 숫자 부분으로 정렬: frame-1, frame-2, ...
        list.sort((a, b) => {
          const na = parseInt(a.id.split('-')[1] || '0', 10);
          const nb = parseInt(b.id.split('-')[1] || '0', 10);
          return na - nb;
        });
        setFrames(list.slice(0, 16));
      } catch (e: any) {
        console.error(e);
        setFrames([]);
      }
    };
    loadFrames();
  }, []);

  // 2) Realtime 구독 (INSERT / UPDATE / DELETE)
  useEffect(() => {
    const channel = supabase
      .channel('realtime-unlockeddata')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'unlockeddata' },
        (payload: any) => {
          const newRow = payload.new as UnlockedRow;
          if (!newRow?.image_url) return;
          setRows((prev) => {
            // 같은 id가 있으면 교체, 없으면 앞에 추가 후 16개로 제한
            const withoutDup = prev.filter((r) => r.id !== newRow.id);
            return ([{ ...newRow }, ...withoutDup]).slice(0, 16);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'unlockeddata' },
        (payload: any) => {
          const updated = payload.new as UnlockedRow;
          setRows((prev) =>
            prev.map((r) =>
              r.id === updated.id ? { ...r, ...updated } : r
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'unlockeddata' },
        (payload: any) => {
          const deleted = payload.old as UnlockedRow;
          setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        }
      )
      .subscribe(() => {
        // 필요 시 상태 확인 가능 (SUBSCRIBED 등)
        // console.log('realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 이미지(스토리지) + DB 행 삭제 (상태 메시지 표시)
  const handleDelete = async (row: UnlockedRow) => {
    if (!row?.id) return;
    setDeleting((prev) => ({ ...prev, [row.id]: true }));
    try {
      setStatusMsg(`삭제 시작: id=${row.id}`);
      // DB 삭제 (unlockeddata)
      const { error: delErr } = await supabase.from('unlockeddata').delete().eq('id', row.id);
      if (delErr) {
        setStatusMsg((m) => m + `\n[에러] DB 삭제 실패: ${delErr.message ?? delErr}`);
        alert(`DB 삭제 실패:\n${delErr.message ?? delErr}`);
        return;
      }
      // 레이아웃도 함께 정리 삭제 라인 제거
      setStatusMsg((m) => m + `\nDB 삭제 성공`);
      // 로컬 상태 반영
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setStatusMsg((m) => m + `\n완료 ✅ (Storage 파일은 유지됨)`);
    } catch (e: any) {
      console.error(e);
      setStatusMsg((m) => m + `\n[예외] ${e?.message ?? e}`);
      alert('삭제 중 예외가 발생했습니다.\n콘솔을 확인해 주세요.');
    } finally {
      setDeleting((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  // 최신이 1번 슬롯, 그 다음이 2번 ... 최대 16번까지 (17번째 이후는 보이지 않음)
  const desc = [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta; // 최신 우선
  });
  
  const slotToRow: Record<number, UnlockedRow | undefined> = {};
  for (let slot = 1; slot <= 16; slot++) {
    const item = desc[slot - 1]; // 1번 슬롯 = desc[0] (최신)
    if (item) slotToRow[slot] = item;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#ffffff' }}>
      {statusMsg && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          padding: '6px 8px', fontSize: 12, color: '#0f172a',
          background: 'rgba(248,250,252,0.9)', border: '1px solid #e2e8f0', borderRadius: 6,
          maxWidth: 420, whiteSpace: 'pre-wrap'
        }}>
          {statusMsg}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          background: '#ffffff',
        }}
      >
        {(() => {
          // 프레임 또는 기본 배치로 박스 계산
          const getBox = (idx: number) => {
            const f = frames[idx];
            if (f) return f;
            const baseW = 320, baseH = 220, margin = 16, cols = 4;
            const col = idx % cols; const r = Math.floor(idx / cols);
            return { x: col * (baseW + margin), y: r * (baseH + margin), w: baseW, h: baseH };
          };

          // 이미지가 배정된 슬롯만 렌더 (비어있는 프레임은 숨김)
          const visibleIdx = Array.from({ length: 16 }, (_, i) => i).filter((i) => !!slotToRow[i + 1]);
          const boxes = visibleIdx.map((i) => getBox(i));

          const canvasW = Math.max(1200, ...(boxes.length ? boxes.map(b => Number(b.x) + Number(b.w) + 32) : [0]));
          const canvasH = Math.max(800,  ...(boxes.length ? boxes.map(b => Number(b.y) + Number(b.h) + 32) : [0]));

          return (
            <div style={{ position: 'relative', minWidth: canvasW, minHeight: canvasH }}>
              {visibleIdx.map((idx) => {
                const slotNum = idx + 1;
                const row = slotToRow[slotNum]!; // visibleIdx로 필터되어 있어 존재 보장
                const box = getBox(idx);
                const hoverKey = row.id;
                return (
                  <div
                    key={`frame-${slotNum}`}
                    title={row.image_url ?? ''}
                    style={{
                      position: 'absolute',
                      left: Number(box.x),
                      top: Number(box.y),
                      width: Number(box.w),
                      height: Number(box.h),
                      border: hovered === hoverKey ? '1px solid #94a3b8' : '1px solid transparent',
                      borderRadius: 8,
                      background: '#ffffff',
                      overflow: 'hidden',
                      resize: 'none',
                      cursor: 'default',
                    }}
                    onMouseEnter={() => setHovered(hoverKey)}
                    onMouseLeave={() => setHovered((prev) => (prev === hoverKey ? null : prev))}
                  >
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
                      <img
                        src={row.image_url ?? ''}
                        alt={`frame-${slotNum}`}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                        loading="lazy"
                        draggable={false}
                      />
                    </div>
                    {hovered === hoverKey && row.image_url && (
                      <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, padding: '6px 8px', fontSize: 12, color: '#ffffff', background: 'rgba(0,0,0,0.55)', borderRadius: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                        {row.image_url}
                      </div>
                    )}
                    {hovered === hoverKey && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleDelete(row); }}
                        disabled={!!deleting[row.id]}
                        style={{ position: 'absolute', top: 8, right: 8, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0', background: deleting[row.id] ? '#f1f5f9' : '#ef4444', color: '#ffffff', cursor: deleting[row.id] ? 'not-allowed' : 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
                        title="이 이미지를 목록에서 제거합니다 (DB만)"
                      >
                        {deleting[row.id] ? 'Deleting…' : 'X'}
                      </button>
                    )}
                  </div>
                );
              })}

              {rows.length === 0 && (
                <div style={{ position: 'absolute', left: 24, top: 24, fontSize: 14, color: '#64748b' }}>
                  불러온 이미지가 없습니다.
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default App;
