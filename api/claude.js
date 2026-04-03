export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    // If career page URLs are passed, fetch them server-side and inject into prompt
    if (body.careerUrls && Array.isArray(body.careerUrls) && body.basePrompt) {
      const fetched = await fetchCareerPages(body.careerUrls);

      const pageContent = fetched
        .map(p => p.success && p.text
          ? `=== ${p.company} (${p.url}) ===\n${p.text}`
          : `=== ${p.company}: could not fetch page ===`)
        .join('\n\n');

      // Inject fetched content into the prompt
      const enrichedPrompt = body.basePrompt.replace(
        'TARGET CAREER PAGES:',
        `LIVE CAREER PAGE CONTENT (fetched now — extract real job listings from this):\n\n${pageContent}\n\nTARGET CAREER PAGES:`
      );

      body.messages = [{ role: 'user', content: enrichedPrompt }];
      delete body.careerUrls;
      delete body.basePrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens,
        messages: body.messages,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
}

async function fetchCareerPages(urls) {
  const results = await Promise.allSettled(
    urls.map(async ({ company, url }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });
        clearTimeout(timeout);

        const html = await res.text();

        // Strip scripts, styles, and tags — keep readable text
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 5000); // ~5k chars per company keeps prompt manageable

        return { company, url, text, success: true };
      } catch (err) {
        return { company, url, text: '', success: false, error: err.message };
      }
    })
  );

  return results.map(r => r.status === 'fulfilled' ? r.value : { ...r.reason, success: false });
}
