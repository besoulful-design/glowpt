exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const { prompt } = JSON.parse(event.body)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await response.json()
    console.log('Anthropic response:', JSON.stringify(data))
    const text = data.content?.[0]?.text || "You showed up today — and that's everything."

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ response: text })
    }
  } catch (err) {
    console.log('Function error:', err.message)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    }
  }
}
