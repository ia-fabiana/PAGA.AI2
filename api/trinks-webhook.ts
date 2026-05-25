import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';

const RELAY_URL = 'https://ia-agendamento.vercel.app/api/webhooks/trinks';
const RELAY_TIMEOUT_MS = 8000;
const ESTABLISHMENT_ID = process.env.VITE_TRINKS_ESTABLISHMENT_ID ?? '';

function getDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin.firestore();
}

// Trinks envia via Amazon SNS: Type=Notification com Message como string JSON (double-parse)
function parseSnsMessage(body: Record<string, unknown>): Record<string, unknown> {
  if (String(body?.Type ?? '') === 'Notification' && body?.Message) {
    try { return JSON.parse(String(body.Message)); } catch { /* sem envelope SNS */ }
  }
  return body;
}

function extractAppointment(message: Record<string, unknown>): Record<string, unknown> {
  return (message?.Agendamento ?? message?.agendamento ?? message?.data ?? message) as Record<string, unknown>;
}

function extractDate(appt: Record<string, unknown>): string {
  const raw = String(appt?.dataHoraInicio ?? appt?.dataHora ?? appt?.inicio ?? appt?.dataReferencia ?? '');
  return raw.slice(0, 10);
}

async function saveToFirestore(
  message: Record<string, unknown>,
  tipoDeEvento: number,
  action: number,
): Promise<string> {
  const db = getDb();
  const appt = extractAppointment(message);
  const id = appt?.id ?? appt?.agendamentoId ?? Date.now();
  const date = extractDate(appt);
  const docId = `trinks_${ESTABLISHMENT_ID}_${id}`;

  await db.collection('trinks_transactions').doc(docId).set(
    { ...appt, date, tipoDeEvento, action, syncedAt: new Date().toISOString(), estabelecimentoId: ESTABLISHMENT_ID },
    { merge: true },
  );
  return docId;
}

async function relay(
  rawBody: string,
  incomingHeaders: Record<string, string | string[] | undefined>,
): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  const forwardHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const key of ['x-amz-sns-message-type', 'x-amz-sns-topic-arn', 'x-trinks-signature', 'x-webhook-signature']) {
    const val = incomingHeaders[key];
    if (val && typeof val === 'string') forwardHeaders[key] = val;
  }

  try {
    const response = await fetch(RELAY_URL, { method: 'POST', headers: forwardHeaders, body: rawBody, signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body as Record<string, unknown>;
  const snsType = String(body?.Type ?? '');
  const rawBody = JSON.stringify(body);
  const log: Record<string, unknown> = {};

  // Passo 1: confirmar assinatura SNS (obrigatório para ativar o webhook no Trinks)
  if (snsType === 'SubscriptionConfirmation') {
    const subscribeUrl = String(body?.SubscribeURL ?? '');
    if (subscribeUrl) {
      console.log('[trinks-webhook] Confirmando assinatura SNS:', subscribeUrl);
      fetch(subscribeUrl).catch((e) => console.error('[trinks-webhook] SNS confirm error:', e.message));
    }
    relay(rawBody, req.headers as Record<string, string>).catch(() => {});
    return res.json({ received: true, type: 'subscription_confirmed' });
  }

  // Passo 2: extrair evento do envelope SNS (double-parse de Message)
  const message = parseSnsMessage(body);
  const tipoDeEvento = Number(message?.TipoDeEvento ?? message?.tipoDeEvento ?? 0);
  const action = Number(message?.Action ?? message?.action ?? 0);
  log.tipoDeEvento = tipoDeEvento;
  log.action = action;

  // Passo 3: salvar no Firestore — apenas eventos de agendamento (11=criação, 12=alteração, 13=exclusão)
  const isAppointmentEvent = tipoDeEvento >= 11 && tipoDeEvento <= 13;
  if (isAppointmentEvent) {
    try {
      const docId = await saveToFirestore(message, tipoDeEvento, action);
      log.firestore = `ok (${docId})`;
    } catch (err) {
      log.firestore = `error: ${String(err)}`;
      console.error('[trinks-webhook] Firestore error:', err);
    }
  } else {
    log.firestore = `skipped (tipoDeEvento=${tipoDeEvento})`;
  }

  // Passo 4: relay para ia-agendamento (não bloqueia mesmo em falha)
  try {
    const result = await relay(rawBody, req.headers as Record<string, string>);
    log.relay = result.ok ? `ok (${result.status})` : `http-${result.status}`;
    if (!result.ok) console.warn('[trinks-webhook] Relay status não-ok:', result.status);
  } catch (err) {
    log.relay = `error: ${String(err)}`;
    console.error('[trinks-webhook] Relay error:', err);
  }

  return res.status(200).json({ received: true, ...log });
}
