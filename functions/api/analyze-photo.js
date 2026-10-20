// Cloudflare Pages Function: /api/analyze-photo
// 업로드된 사진을 OpenAI Vision 모델로 분석해 체형/피부톤/스타일 힌트를 반환합니다.
// API 키는 Cloudflare 대시보드의 환경변수(OPENAI_API_KEY)로만 관리하며, 이 코드에는 포함하지 않습니다.

const ALLOWED = {
  shoulder: ['wide', 'normal', 'narrow'],
  torso: ['thin', 'normal', 'belly'],
  lower: ['thin', 'normal', 'thick'],
  tone: ['warm', 'cool', 'unknown'],
  style: ['casual', 'street', 'minimal', 'amekaji', 'dandy', 'unknown']
};

const SYSTEM_PROMPT = `너는 패션 스타일링을 위한 시각 분석 도우미다.
사용자가 올린 사진(전신 또는 상반신)을 보고, 아래 JSON 형식으로만 답한다. 코드블록이나 설명 문구 없이 JSON만 출력한다.

{
  "shoulder": "wide" | "normal" | "narrow",
  "torso": "thin" | "normal" | "belly",
  "lower": "thin" | "normal" | "thick",
  "tone": "warm" | "cool" | "unknown",
  "style": "casual" | "street" | "minimal" | "amekaji" | "dandy" | "unknown",
  "summary": "한국어 1~2문장으로 분석 느낌을 설명"
}

규칙:
- shoulder/torso/lower는 보이는 체형 비율과 옷맵시를 근거로 판단한다.
- tone은 피부 혈색/톤을 근거로 판단하되 확실하지 않으면 "unknown"으로 답한다.
- style은 현재 입고 있는 옷의 분위기를 근거로 판단하되 애매하면 "unknown"으로 답한다.
- 외모 평가, 체중·다이어트 관련 언급, 비하 표현을 절대 하지 않는다.
- 사람이 명확히 보이지 않으면 모든 항목을 "normal" 또는 "unknown"으로 하고 summary에 이유를 적는다.`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

function normalize(obj) {
  const out = {};
  for (const key of Object.keys(ALLOWED)) {
    out[key] = ALLOWED[key].includes(obj[key]) ? obj[key] : (key === 'tone' || key === 'style' ? 'unknown' : 'normal');
  }
  out.summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 300) : '';
  return out;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const apiKey = env.OPENAI_API_KEY;

    if (!apiKey) {
      return json({ error: 'missing_api_key' }, 500);
    }

    const body = await request.json().catch(() => null);
    const image = body && body.image;

    if (!image || typeof image !== 'string' || !image.startsWith('data:image')) {
      return json({ error: 'invalid_image' }, 400);
    }

    const payload = {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '이 사진을 분석해서 지정된 JSON 형식으로만 답해줘.' },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ]
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return json({ error: 'openai_error', detail: detail.slice(0, 300) }, 502);
    }

    const data = await resp.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = extractJson(raw);

    if (!parsed) {
      return json({ error: 'parse_error' }, 502);
    }

    return json({ result: normalize(parsed) }, 200);
  } catch (err) {
    return json({ error: 'server_error', detail: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: 'method_not_allowed' }, 405);
}
