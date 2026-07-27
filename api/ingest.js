import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CHUNK_SIZE = 1500;   // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks so context isn't cut mid-thought

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(Boolean);
}

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });
  const data = await res.json();
  if (!data.data) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return data.data[0].embedding;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { document_name, text } = req.body || {};
  if (!document_name || !text) {
    return res.status(400).json({ error: 'document_name and text are required' });
  }

  try {
    const chunks = chunkText(text);
    const rows = [];

    for (const chunk of chunks) {
      const embedding = await getEmbedding(chunk);
      rows.push({ document_name, chunk_text: chunk, embedding });
    }

    const { error } = await supabase.from('policy_chunks').insert(rows);
    if (error) throw error;

    return res.status(200).json({ success: true, chunks_inserted: rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
