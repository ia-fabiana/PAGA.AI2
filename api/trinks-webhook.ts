import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ESTABLISHMENT_ID = process.env.VITE_TRINKS_ESTABLISHMENT_ID ?? '';

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
      }),
    });
  }
  return getFirestore();
}

interface IaAgendamentoPayload {
  source: 'ia-agendamento';
  eventType: 'create' | 'reschedule' | 'cancel';
  tipoDeEvento: number;
  action: number;
  tenantCode: string;
  establishmentId: string;
  appointmentId: string | number | null;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  professionalName: string;
  date: string;
  time: string;
  valor: number;
}

async function saveAppointmentToFirestore(payload: IaAgendamentoPayload): Promise<string> {
  const db = getDb();
  const id = payload.appointmentId ?? Date.now();
  const docId = `trinks_${payload.establishmentId || ESTABLISHMENT_ID}_${id}`;

  await db.collection('trinks_transactions').doc(docId).set(
    {
      ...payload,
      syncedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return docId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body as Record<string, unknown>;
  const relaySource = req.headers['x-relay-source'];

  if (relaySource === 'ia-agendamento' || body?.source === 'ia-agendamento') {
    try {
      const payload = body as unknown as IaAgendamentoPayload;
      const docId = await saveAppointmentToFirestore(payload);
      console.log(`[trinks-webhook] recebido de ia-agendamento: ${payload.eventType} / ${payload.serviceName} / ${payload.date} → ${docId}`);
      return res.status(200).json({ received: true, source: 'ia-agendamento', docId });
    } catch (err) {
      console.error('[trinks-webhook] erro ao salvar do ia-agendamento:', err);
      return res.status(200).json({ received: true, error: String(err) });
    }
  }

  const snsType = String(body?.Type ?? '');
  if (snsType === 'SubscriptionConfirmation') {
    const subscribeUrl = String(body?.SubscribeURL ?? '');
    if (subscribeUrl) fetch(subscribeUrl).catch(() => {});
    return res.json({ received: true, type: 'subscription_confirmed' });
  }

  return res.status(200).json({ received: true, note: 'formato nao reconhecido' });
}
