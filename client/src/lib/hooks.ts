import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => n === seq.current && setData(d))
      .catch((e) => n === seq.current && setError(e.message))
      .finally(() => n === seq.current && setLoading(false));
  }, [path]);

  useEffect(load, [load]);
  return { data, error, loading, reload: load, setData };
}

export interface Lookups {
  regions: { id: number; name: string }[];
  clients: { id: number; name: string; code: string; region_id: number }[];
  sites: { id: number; name: string; code: string; client_id: number; region_id: number; client_name: string }[];
  items: { id: number; code: string; name: string; category: string; uom: string; min_order_qty: number; reorder_level: number;
    std_purchase_rate: number; std_sale_rate: number; mrp: number | null; gst_rate: number }[];
  vendors: { id: number; code: string; name: string; vendor_type: string; payment_terms_days: number; lead_time_days: number }[];
  warehouses: { id: number; code: string; name: string }[];
  employees: { id: number; code: string; name: string; designation: string }[];
}

let lookupCache: Promise<Lookups> | null = null;
export function invalidateLookups() {
  lookupCache = null;
}
export function useLookups() {
  const [data, setData] = useState<Lookups | null>(null);
  useEffect(() => {
    if (!lookupCache) lookupCache = api<Lookups>('/lookups');
    let alive = true;
    lookupCache.then((d) => alive && setData(d)).catch(() => (lookupCache = null));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** State mirrored into the URL query string (so filters survive refresh and links work) */
export function useQueryState(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const values: Record<string, string> = { ...defaults };
  sp.forEach((v, k) => (values[k] = v));
  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );
  return [values, set] as const;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}
