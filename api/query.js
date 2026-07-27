import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

async function askClaude(question, context) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a policy assistant for Knightingale staff. Answer the question using only the policy excerpts below. If the excerpts don't contain the answer, say you don't know and suggest checking with management. Be concise.\n\nPolicy excerpts:\n${context}`,
      messages: [{ role: 'user', content: question }],
    }),
  });
  const data = await res.json();
  if (!data.content) throw new Error(`Claude error: ${JSON.stringify(data)}`);
  return data.content.map((c) => c.text || '').join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question } = req.body || {};
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const queryEmbedding = await getEmbedding(question);

    const { data: matches, error } = await supabase.rpc('match_policy_chunks', {
      query_embedding: queryEmbedding,
      match_count: 5,
    });

    const { data: chunkCount, error: countError } = await supabase.rpc('debug_chunk_count');
    const { data: listedChunks, error: listError } = await supabase.rpc('debug_list_chunks');

    const context = (matches || [])
      .map((m) => `[${m.document_name}]\n${m.chunk_text}`)
      .join('\n\n---\n\n');

    const answer = await askClaude(question, context || 'No matching policy content found.');

    return res.status(200).json({
      answer,
      sources: (matches || []).map((m) => m.document_name),
      debug: {
        rpcError: error,
        matchCount: matches ? matches.length : null,
        embeddingLength: queryEmbedding.length,
        supabaseUrlUsed: process.env.SUPABASE_URL,
        chunkCount,
        countError,
        listedChunks,
        listError,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
