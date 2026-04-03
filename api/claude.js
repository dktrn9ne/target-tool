export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    // Extract our custom fields before sending to Anthropic
    const { careerUrls, basePrompt, ...anthropicBody } = body;

    // If career URLs provided, fetch them and inject into the prompt
    if (careerUrls && Array.isArray(careerUrls) && careerUrls.length > 0) {
      const fetched = await fetchCareerPages(careerUrls);

      const pageContent = fetched
        .map(p =>
          p.success && p.text
            ? `=== ${p.company} ===\n${p.text}`
            : `=== ${p.company}: fetch failed ===`
        )
        .join('\n\n');

      // Replace the last user message content with enriched version
      const originalPrompt = anthropicBody.messages?.[0]?.content || '';
      const enrichedPrompt = `LIVE CAREER PAGE DATA (fetched right now):\n\n${pageContent}\n\n---\n\n${originalPrompt}`;
      anthropicBody.messages = [{ role: 'user', content: enrichedPrompt }];
    }

    // Ensure required Anthropic fields are present
    const payload = {
      model: anthropicBody.model || 'claude-sonnet-4-20250514',
      max_tokens: anthropicBody.max_tokens || 4000,
      messages: anthropicBody.messages,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
}

async function fetchCareerPages(urls) {
  const results = await Promise.allSettled(
    urls.map(async ({ company, url }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(timeout);

        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 4000);

        return { company, url, text, success: true };
      } catch (err) {
        return { company, url, text: '', success: false };
      }
    })
  );

  return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, text: '' });
}
