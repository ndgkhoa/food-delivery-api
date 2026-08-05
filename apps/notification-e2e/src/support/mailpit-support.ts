const MAILPIT_BASE_URL = process.env.MAILPIT_BASE_URL ?? 'http://localhost:8025';

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitFullMessage {
  Subject: string;
  Text: string;
}

export async function pollMailpitMessageTo(
  recipient: string,
  timeoutMs = 20_000,
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listRes = await fetch(`${MAILPIT_BASE_URL}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) as MailpitMessagesResponse;
    const match = list.messages.find((message) =>
      message.To.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
    );
    if (match) {
      const fullRes = await fetch(`${MAILPIT_BASE_URL}/api/v1/message/${match.ID}`);
      const full = (await fullRes.json()) as MailpitFullMessage;
      return { subject: full.Subject, text: full.Text };
    }
    if (Date.now() >= deadline) {
      throw new Error(`no Mailpit message to "${recipient}" within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
