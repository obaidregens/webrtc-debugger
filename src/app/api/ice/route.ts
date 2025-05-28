import { NextResponse } from 'next/server'

export async function POST(): Promise<NextResponse> {
  try {
    const response = await fetch(process.env.CLOUDFLARE_FETCH_TURN_SERVERS_URL ?? "", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_FETCH_TURN_SERVERS_AUTH}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: 86400 })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}
