export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    const body = await request.json();

    // Convert OpenAI-style messages to Gemini format
    const messages = body.messages || [];
    const parts = [];
    for (const msg of messages) {
      const content = msg.content;
      if (typeof content === 'string') {
        parts.push({ text: content });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          }
        }
      }
    }

    const geminiBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: body.max_tokens || 600, temperature: 0.1 },
    };

    const model = 'gemini-2.0-flash';
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      }
    );

    const data = await upstream.json();

    // Convert Gemini response to OpenAI-style so app code doesn't change
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: data.error || data }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const openAIShape = {
      choices: [{ message: { role: 'assistant', content: text } }],
    };

    return new Response(JSON.stringify(openAIShape), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
