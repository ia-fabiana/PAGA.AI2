export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { _path, ...params } = req.query as Record<string, string>;
  const trinkPath = _path || '/v1/transacoes';

  const url = new URL(`https://api.trinks.com${trinkPath}`);
  Object.entries(params).forEach(([k, v]) => {
    if (typeof v === 'string') url.searchParams.set(k, v);
  });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-API-KEY': process.env.VITE_TRINKS_API_KEY || '',
        'estabelecimentoId': process.env.VITE_TRINKS_ESTABLISHMENT_ID || '',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy error', message: String(error) });
  }
}
