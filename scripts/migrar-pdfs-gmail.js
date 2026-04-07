/**
 * Baixa os PDFs anexados nos emails de revisão do Gmail e sobe pro Supabase Storage,
 * depois atualiza a tabela revisao_emails com a URL do PDF.
 */

const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');

const GMAIL_USER = 'posvendas.novatratores@gmail.com';
const GMAIL_PASS = 'vuak yzex ycpm mydd';
const SUPABASE_URL = 'https://citrhumdkfivdzbmayde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJodW1ka2ZpdmR6Ym1heWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDgyNzUsImV4cCI6MjA4NDY4NDI3NX0.83x3-NrKoJgtIuSE7Jjsaj0zH-b-XJ3Z8i3XkBkwVoU';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseSubject(subject) {
  const clean = subject.replace(/^(Fwd?:|Re:)\s*/gi, '').trim();
  const horasMatch = clean.match(/revis[aã]o\s+(?:de\s+)?(?:[-–]\s*)?(\d+)\s*(?:hrs?|horas?)?/i);
  const horas = horasMatch ? horasMatch[1] : null;

  let chassisFinal = null;
  const patterns = [
    /CHASSI\s+(?:MDI\w+)?(\d{3,})/i,
    /FINAL\s+(?:CHASSI\s+)?(\d{3,})/i,
    /[-,\/]\s*(\d{3,})\s*[.\-]?\s*$/,
    /[-,]\s*(\d{3,})\s*$/,
    /\s(\d{4,})\s*[.\-]?\s*$/,
  ];
  for (const pat of patterns) {
    const m = clean.match(pat);
    if (m) { chassisFinal = m[1].replace(/^0+/, '0'); break; }
  }
  if (!chassisFinal) {
    const allNums = [...clean.matchAll(/(\d{3,})/g)];
    const candidates = allNums.filter(m => m[1] !== horas);
    if (candidates.length > 0) chassisFinal = candidates[candidates.length - 1][1];
  }

  return { horas, chassisFinal };
}

function findPdfParts(node) {
  const parts = [];
  function walk(part) {
    if (!part || typeof part !== 'object') return;
    if (part.childNodes && Array.isArray(part.childNodes)) {
      for (const child of part.childNodes) walk(child);
      return;
    }
    const type = (part.type || '').toLowerCase();
    const subtype = (part.subtype || '').toLowerCase();
    const disposition = (part.disposition || '').toLowerCase();
    const filename = part.dispositionParameters?.filename || part.parameters?.name || '';

    if (
      (type === 'application' && subtype === 'pdf') ||
      (filename.toLowerCase().endsWith('.pdf')) ||
      (disposition === 'attachment' && (subtype === 'pdf' || filename.toLowerCase().endsWith('.pdf')))
    ) {
      parts.push({ part: part.part || '', filename: filename || 'revisao.pdf' });
    }
  }
  walk(node);
  return parts;
}

async function conectarGmail() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
  });
  client.on('error', () => {}); // evitar crash por ECONNRESET
  await client.connect();

  const pastasEnviados = [
    '[Gmail]/Sent Mail',
    '[Gmail]/E-mails enviados',
    '[Gmail]/Enviados',
  ];
  let lock;
  for (const pasta of pastasEnviados) {
    try {
      lock = await client.getMailboxLock(pasta);
      console.log('Pasta:', pasta);
      break;
    } catch {}
  }
  if (!lock) throw new Error('Pasta de enviados não encontrada');
  return { client, lock };
}

async function main() {
  // 1. Buscar emails sem pdf_url no banco
  const { data: emailsSemPdf, error: errDb } = await supabase
    .from('revisao_emails')
    .select('id, assunto, chassis_final, horas, enviado_em')
    .is('pdf_url', null)
    .order('enviado_em', { ascending: false });

  if (errDb) {
    console.error('Erro ao buscar emails:', errDb.message);
    process.exit(1);
  }

  console.log(`${emailsSemPdf.length} emails sem PDF no banco`);
  if (emailsSemPdf.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  // 2. Conectar e escanear Gmail
  let conn = await conectarGmail();

  console.log('Buscando emails no Gmail...');
  const gmailEmails = new Map();

  const messages = conn.client.fetch('1:*', {
    envelope: true,
    bodyStructure: true,
    uid: true,
  });

  let scanned = 0;
  for await (const msg of messages) {
    scanned++;
    const subject = msg.envelope?.subject || '';
    if (!/cheque de revis/i.test(subject)) continue;

    const pdfParts = msg.bodyStructure ? findPdfParts(msg.bodyStructure) : [];
    if (pdfParts.length === 0) continue;

    const dateStr = msg.envelope?.date?.toISOString() || '';
    const key = `${subject}|${dateStr}`;
    gmailEmails.set(key, { uid: msg.uid, pdfParts });

    if (scanned % 500 === 0) console.log(`  Escaneados: ${scanned}...`);
  }

  console.log(`Escaneados ${scanned} emails, ${gmailEmails.size} com PDF anexo`);

  // 3. Cruzar e baixar PDFs
  let baixados = 0;
  let semMatch = 0;
  let erros = 0;

  for (let i = 0; i < emailsSemPdf.length; i++) {
    const dbEmail = emailsSemPdf[i];

    let gmailMatch = null;
    for (const [key, val] of gmailEmails) {
      const subj = key.substring(0, key.lastIndexOf('|'));
      const dateStr = key.substring(key.lastIndexOf('|') + 1);
      if (subj === dbEmail.assunto) {
        const d1 = new Date(dateStr).getTime();
        const d2 = new Date(dbEmail.enviado_em).getTime();
        if (Math.abs(d1 - d2) < 120000) {
          gmailMatch = val;
          break;
        }
      }
    }

    if (!gmailMatch) {
      for (const [key, val] of gmailEmails) {
        const subj = key.substring(0, key.lastIndexOf('|'));
        const parsed = parseSubject(subj);
        if (parsed.horas === dbEmail.horas && parsed.chassisFinal && parsed.chassisFinal.slice(-4) === dbEmail.chassis_final) {
          const dateStr = key.substring(key.lastIndexOf('|') + 1);
          const d1 = new Date(dateStr).getTime();
          const d2 = new Date(dbEmail.enviado_em).getTime();
          if (Math.abs(d1 - d2) < 120000) {
            gmailMatch = val;
            break;
          }
        }
      }
    }

    if (!gmailMatch) {
      semMatch++;
      continue;
    }

    const pdfPart = gmailMatch.pdfParts[0];
    try {
      const { content } = await conn.client.download(String(gmailMatch.uid), pdfPart.part, { uid: true });

      const chunks = [];
      for await (const chunk of content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length < 100) {
        erros++;
        continue;
      }

      const chassis = dbEmail.chassis_final || 'sem-chassis';
      const horas = dbEmail.horas || '0';
      const ts = new Date(dbEmail.enviado_em).getTime();
      const storagePath = `${chassis}/${horas}h_${ts}.pdf`;

      const { error: uploadErr } = await supabase.storage
        .from('revisoes')
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });

      if (uploadErr) {
        console.error(`  [${i + 1}] Erro upload:`, uploadErr.message);
        erros++;
        continue;
      }

      const { data: urlData } = supabase.storage.from('revisoes').getPublicUrl(storagePath);

      const { error: updateErr } = await supabase
        .from('revisao_emails')
        .update({ pdf_url: urlData.publicUrl })
        .eq('id', dbEmail.id);

      if (updateErr) {
        console.error(`  [${i + 1}] Erro update:`, updateErr.message);
        erros++;
      } else {
        baixados++;
        console.log(`  [${i + 1}/${emailsSemPdf.length}] OK - ${dbEmail.assunto.substring(0, 60)}`);
      }
    } catch (err) {
      console.error(`  [${i + 1}] Erro: ${err.message}, reconectando...`);
      try { conn.lock.release(); } catch {}
      try { conn.client.close().catch(() => {}); } catch {}
      conn = null;
      await new Promise(r => setTimeout(r, 5000));
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          conn = await conectarGmail();
          break;
        } catch (reconErr) {
          console.error(`  Tentativa ${attempt + 1} falhou, aguardando ${10 * (attempt + 1)}s...`);
          await new Promise(r => setTimeout(r, 10000 * (attempt + 1)));
        }
      }
      if (!conn) {
        console.error('  Impossível reconectar após 5 tentativas. Abortando.');
        break;
      }
      i--;
      continue;
    }

    // Pausa a cada 5 downloads para não sobrecarregar
    if (baixados % 5 === 0 && baixados > 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  try { conn.lock.release(); } catch {}
  try { await conn.client.logout(); } catch {}

  console.log('\n=== Resultado ===');
  console.log(`PDFs baixados e linkados: ${baixados}`);
  console.log(`Sem match no Gmail: ${semMatch}`);
  console.log(`Erros: ${erros}`);
  console.log('Desconectado do Gmail.');
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
