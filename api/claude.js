export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  try {
    // Parse body — Vercel doesn't auto-parse for plain functions
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
 
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Anthropic proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}
 
