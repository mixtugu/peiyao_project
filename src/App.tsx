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

function App() {
  const [rows, setRows] = useState<UnlockedRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 1) 초기 로드
  useEffect(() => {
    const fetchImages = async () => {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from('unlockeddata')
          .select('id, image_url, created_at')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const cleaned =
          (data ?? [])
            .filter((r) => !!r.image_url)
            .map((r) => ({
              id: r.id as string,
              image_url: r.image_url as string,
              created_at: r.created_at ?? null,
            }));

        setRows(cleaned);
      } catch (e: any) {
        setError(e?.message ?? '데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
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
            // 같은 id가 있으면 교체, 없으면 앞에 추가
            const withoutDup = prev.filter((r) => r.id !== newRow.id);
            return [{ ...newRow }, ...withoutDup];
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
      .subscribe((status) => {
        // 필요 시 상태 확인 가능 (SUBSCRIBED 등)
        // console.log('realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 16 }}>Unlocked Images (Realtime)</h1>

      {loading && <p>불러오는 중…</p>}
      {error && (
        <p style={{ color: 'crimson' }}>
          오류: {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p>표시할 이미지가 없습니다.</p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {rows.map((row, idx) => (
          <div
            key={row.id ?? idx}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 8,
              background: 'white',
            }}
          >
            <img
              src={row.image_url ?? ''}
              alt={`unlocked-${idx}`}
              style={{
                width: '100%',
                height: 220,
                objectFit: 'cover',
                borderRadius: 6,
                display: 'block',
              }}
              loading="lazy"
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', wordBreak: 'break-all' }}>
              {row.image_url}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
