// GET    /api/guests            → { guests: [...] }
// POST   /api/guests  {id,...}  → 저장 (같은 id면 덮어쓰기)
// DELETE /api/guests  {id}      → 삭제
// 저장소: Upstash Redis (Vercel Marketplace 연동 시 환경변수가 자동으로 들어와요)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'chuseok2026:guests';
const MAX_GUESTS = 200;

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis error');
  return j.result;
}

const CATS = ['main', 'side', 'drink'];
const STATUSES = ['yes', 'maybe', 'no'];

function clean(b) {
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name || !/^g_[0-9a-f]{2,160}$/.test(String(b.id))) return null;
  const away = b.status === 'no';
  return {
    name,
    status: STATUSES.includes(b.status) ? b.status : 'yes',
    arrive: !away && /^\d{1,2}:\d{2}$/.test(b.arrive || '') ? b.arrive : null,
    party: away ? 0 : Math.min(8, Math.max(1, parseInt(b.party, 10) || 1)),
    dishes: away ? [] : (Array.isArray(b.dishes) ? b.dishes : []).slice(0, 8)
      .map((d) => ({ t: String((d && d.t) || '').trim().slice(0, 30), c: CATS.includes(d && d.c) ? d.c : 'main' }))
      .filter((d) => d.t),
    updatedAt: Date.now(),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'storage not configured' });
  try {
    if (req.method === 'GET') {
      const flat = (await redis('HGETALL', KEY)) || [];
      const guests = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { guests.push({ ...JSON.parse(flat[i + 1]), id: flat[i] }); } catch (e) { /* skip bad row */ }
      }
      return res.status(200).json({ guests });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (req.method === 'POST') {
      const g = clean(body);
      if (!g) return res.status(400).json({ error: 'bad input' });
      const exists = await redis('HEXISTS', KEY, body.id);
      if (!exists && (await redis('HLEN', KEY)) >= MAX_GUESTS) return res.status(429).json({ error: 'full' });
      await redis('HSET', KEY, body.id, JSON.stringify(g));
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!/^g_[0-9a-f]{2,160}$/.test(String(body.id))) return res.status(400).json({ error: 'bad id' });
      await redis('HDEL', KEY, body.id);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
