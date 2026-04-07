/**
 * Script de migração: importa emails antigos de revisão do Gmail para a tabela revisao_emails.
 *
 * Uso:  node scripts/migrar-emails-revisao.js
 *
 * Pré-requisitos:
 *   - Tabela revisao_emails já criada no Supabase
 *   - npm install imapflow @supabase/supabase-js  (já estão no projeto)
 */

const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');

// ── Config ──────────────────────────────────────────────────────────
const GMAIL_USER = 'posvendas.novatratores@gmail.com';
const GMAIL_PASS = 'vuak yzex ycpm mydd';
const SUPABASE_URL = 'https://citrhumdkfivdzbmayde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJodW1ka2ZpdmR6Ym1heWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDgyNzUsImV4cCI6MjA4NDY4NDI3NX0.83x3-NrKoJgtIuSE7Jjsaj0zH-b-XJ3Z8i3XkBkwVoU';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Parse subject (mesma lógica que existia no endpoint IMAP) ───────
function parseSubject(subject) {
  const clean = subject.replace(/^(Fwd?:|Re:)\s*/gi, '').trim();

  const horasMatch = clean.match(/revis[aã]o\s+(?:de\s+)?(?:[-–]\s*)?(\d+)\s*(?:hrs?|horas?)?/i);
  const horas = horasMatch ? horasMatch[1] : null;

  let chassisFinal = null;
  const chassisPatterns = [
    /CHASSI\s+(?:MDI\w+)?(\d{3,})/i,
    /FINAL\s+(?:CHASSI\s+)?(\d{3,})/i,
    /[-,\/]\s*(\d{3,})\s*[.\-]?\s*$/,
    /[-,]\s*(\d{3,})\s*$/,
    /\s(\d{4,})\s*[.\-]?\s*$/,
  ];
  for (const pat of chassisPatterns) {
    const m = clean.match(pat);
    if (m) { chassisFinal = m[1].replace(/^0+/, '0'); break; }
  }
  if (!chassisFinal) {
    const allNums = [...clean.matchAll(/(\d{3,})/g)];
    const candidates = allNums.filter(m => m[1] !== horas);
    if (candidates.length > 0) {
      chassisFinal = candidates[candidates.length - 1][1];
    }
  }

  let modelo = null;
  if (horas) {
    const afterHoras = clean.replace(
      /^.*?revis[aã]o\s+(?:de\s+)?(?:[-–]\s*)?\d+\s*(?:hrs?|horas?)?\s*[-,]?\s*/i,
      ''
    );
    if (afterHoras) {
      let m = afterHoras
        .replace(/\bTRATOR\b/gi, '')
        .replace(/\bMAHINDRA\b/gi, '')
        .replace(/\bCHASSI\b/gi, '')
        .replace(/\bFINAL\b/gi, '')
        .replace(/[-,\/]\s*\d{3,}\s*[.\-]?\s*$/, '')
        .replace(/\s+\d{3,}\s*$/, '')
        .replace(/\bMDI\w+/gi, '')
        .trim()
        .replace(/^[-,\/\s]+|[-,\/\s]+$/g, '')
        .trim();
      if (m && m.length > 1) modelo = m;
    }
  }

  return { horas, modelo, chassisFinal };
}

// ── Extrair texto do body structure ─────────────────────────────────
function findTextPart(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.childNodes && Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      const found = findTextPart(child);
      if (found) return found;
    }
    return null;
  }
  const type = (node.type || '').toLowerCase();
  const subtype = (node.subtype || '').toLowerCase();
  if (type === 'text' && (subtype === 'plain' || subtype === 'html')) {
    return node.part || '1';
  }
  return null;
}

// ── Extrair destinatários do envelope ───────────────────────────────
function extractDestinatarios(envelope) {
  const dests = [];
  for (const field of [envelope.to, envelope.cc]) {
    if (!field) continue;
    for (const addr of field) {
      if (addr.address) dests.push(addr.address);
    }
  }
  return dests;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('Conectando ao Gmail...');
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
  });

  await client.connect();

  const pastasEnviados = [
    '[Gmail]/Sent Mail',
    '[Gmail]/E-mails enviados',
    '[Gmail]/Enviados',
    'INBOX.Sent',
    'Sent',
  ];

  let lock;
  let pastaUsada = '';
  for (const pasta of pastasEnviados) {
    try {
      lock = await client.getMailboxLock(pasta);
      pastaUsada = pasta;
      break;
    } catch {}
  }

  if (!lock) {
    console.error('Nenhuma pasta de enviados encontrada.');
    await client.logout();
    process.exit(1);
  }

  console.log('Pasta:', pastaUsada);

  try {
    // Buscar todos os emails da pasta de enviados e filtrar por subject
    console.log('Buscando todos os emails da pasta de enviados...');
    const emails = [];
    const textParts = new Map();

    const messages = client.fetch('1:*', {
      envelope: true,
      bodyStructure: true,
      uid: true,
    });

    let total = 0;
    for await (const msg of messages) {
      total++;
      const subject = msg.envelope?.subject || '';
      if (!/cheque de revis/i.test(subject)) continue;

      const parsed = parseSubject(subject);
      const textPart = msg.bodyStructure ? findTextPart(msg.bodyStructure) : null;
      if (textPart) textParts.set(msg.uid, textPart);

      const destinatarios = msg.envelope ? extractDestinatarios(msg.envelope) : [];

      emails.push({
        subject,
        date: msg.envelope?.date || new Date(),
        uid: msg.uid,
        destinatarios,
        body: '',
        ...parsed,
      });

      if (total % 500 === 0) console.log(`  Escaneados: ${total} emails...`);
    }

    console.log(`Escaneados ${total} emails, encontrados ${emails.length} de revisão`);

    console.log('Metadados carregados:', emails.length, 'emails');

    // Baixar corpo dos emails
    let downloaded = 0;
    for (const email of emails) {
      const partNumber = textParts.get(email.uid);
      if (!partNumber) continue;

      try {
        const { content } = await client.download(String(email.uid), partNumber, { uid: true });
        if (content) {
          const chunks = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
            const totalSize = chunks.reduce((s, c) => s + c.length, 0);
            if (totalSize > 4000) break;
          }
          email.body = Buffer.concat(chunks).toString('utf-8').substring(0, 4000);
          downloaded++;
        }
      } catch (err) {
        console.error(`  Erro ao baixar corpo UID ${email.uid}:`, err.message);
      }
    }

    console.log('Corpos baixados:', downloaded);

    // Verificar emails já migrados (para evitar duplicatas)
    const { data: existentes } = await supabase
      .from('revisao_emails')
      .select('assunto, enviado_em');
    const existentesSet = new Set(
      (existentes || []).map(e => `${e.assunto}|${new Date(e.enviado_em).toISOString()}`)
    );

    // Inserir no banco
    let inseridos = 0;
    let pulados = 0;
    const BATCH = 50;

    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      const rows = [];

      for (const e of batch) {
        const dateStr = new Date(e.date).toISOString();
        const key = `${e.subject}|${dateStr}`;
        if (existentesSet.has(key)) {
          pulados++;
          continue;
        }

        rows.push({
          chassis: e.chassisFinal || '',
          chassis_final: e.chassisFinal ? e.chassisFinal.slice(-4) : '',
          horas: e.horas || '',
          modelo: e.modelo || null,
          cliente: null, // não temos essa info no email
          assunto: e.subject,
          destinatarios: e.destinatarios,
          corpo: e.body || null,
          pdf_url: null, // PDFs antigos não estão no Storage
          enviado_por: null,
          enviado_em: dateStr,
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('revisao_emails').insert(rows);
        if (error) {
          console.error('Erro ao inserir batch:', error.message);
        } else {
          inseridos += rows.length;
        }
      }

      console.log(`  Progresso: ${Math.min(i + BATCH, emails.length)}/${emails.length} processados`);
    }

    console.log('\n=== Migração concluída ===');
    console.log(`Inseridos: ${inseridos}`);
    console.log(`Pulados (já existiam): ${pulados}`);
    console.log(`Total processados: ${emails.length}`);

  } finally {
    lock.release();
    await client.logout();
    console.log('Desconectado do Gmail.');
  }
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
