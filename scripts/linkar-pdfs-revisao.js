/**
 * Liga os PDFs do Supabase Storage aos emails migrados na tabela revisao_emails.
 * Estratégia:
 *   1. Buscar URLs de PDF da tabela tratores (colunas "50h PDF", "300h PDF", etc.)
 *   2. Listar arquivos no bucket "revisoes" do Storage
 *   3. Cruzar com os emails na revisao_emails por chassis_final + horas
 *   4. Atualizar pdf_url nos registros correspondentes
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://citrhumdkfivdzbmayde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJodW1ka2ZpdmR6Ym1heWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDgyNzUsImV4cCI6MjA4NDY4NDI3NX0.83x3-NrKoJgtIuSE7Jjsaj0zH-b-XJ3Z8i3XkBkwVoU';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const REVISOES = ['50', '300', '600', '900', '1200', '1500', '1800', '2100', '2400', '2700', '3000'];

async function main() {
  // 1. Buscar todos os tratores que têm PDF salvo
  console.log('Buscando tratores com PDFs...');
  const { data: tratores, error: errTrat } = await supabase
    .from('tratores')
    .select('*');

  if (errTrat) {
    console.error('Erro ao buscar tratores:', errTrat.message);
    process.exit(1);
  }

  // Montar mapa: chassis_final + horas -> pdf_url
  // Um trator pode ter vários PDFs (um por revisão)
  const pdfMap = new Map(); // key: "chassisFinal|horas" -> { url, data }
  let totalPdfs = 0;

  for (const t of tratores) {
    if (!t.Chassis) continue;
    const chassisFinal = t.Chassis.slice(-4);

    for (const h of REVISOES) {
      const url = t[`${h}h PDF`];
      const data = t[`${h}h Data`];
      if (!url) continue;

      totalPdfs++;
      const key = `${chassisFinal}|${h}`;
      // Se já tem, pega o mais recente
      if (!pdfMap.has(key) || (data && data > (pdfMap.get(key).data || ''))) {
        pdfMap.set(key, { url, data, chassis: t.Chassis });
      }
    }
  }

  console.log(`Encontrados ${totalPdfs} PDFs em ${tratores.length} tratores`);

  // 2. Também listar arquivos no bucket "revisoes" para pegar PDFs que não estão na tabela tratores
  console.log('Listando arquivos no bucket revisoes...');
  const storagePdfs = new Map(); // key: "chassisFinal|horas" -> url

  // Listar pastas (cada pasta é um chassis)
  const { data: folders } = await supabase.storage.from('revisoes').list('', { limit: 1000 });

  if (folders) {
    for (const folder of folders) {
      if (!folder.name || folder.id) continue; // é arquivo na raiz, não pasta
      // Listar arquivos dentro da pasta
      const { data: files } = await supabase.storage.from('revisoes').list(folder.name, { limit: 100 });
      if (!files) continue;

      const chassisFinal = folder.name.slice(-4);

      for (const file of files) {
        if (!file.name) continue;
        // Pattern: {horas}h_{timestamp}.pdf
        const match = file.name.match(/^(\d+)h_/);
        if (!match) continue;

        const horas = match[1];
        const key = `${chassisFinal}|${horas}`;
        const { data: urlData } = supabase.storage.from('revisoes').getPublicUrl(`${folder.name}/${file.name}`);

        if (!storagePdfs.has(key)) {
          storagePdfs.set(key, urlData.publicUrl);
        }
      }
    }
  }

  console.log(`Encontrados ${storagePdfs.size} PDFs no Storage`);

  // 3. Buscar emails sem pdf_url
  const { data: emails, error: errEmails } = await supabase
    .from('revisao_emails')
    .select('id, chassis_final, horas')
    .is('pdf_url', null);

  if (errEmails) {
    console.error('Erro ao buscar emails:', errEmails.message);
    process.exit(1);
  }

  console.log(`${emails.length} emails sem PDF linkado`);

  // 4. Cruzar e atualizar
  let atualizados = 0;
  let semMatch = 0;

  for (const email of emails) {
    if (!email.chassis_final || !email.horas) {
      semMatch++;
      continue;
    }

    const key = `${email.chassis_final}|${email.horas}`;

    // Prioridade: tabela tratores > Storage
    let url = pdfMap.get(key)?.url || storagePdfs.get(key) || null;

    if (!url) {
      semMatch++;
      continue;
    }

    const { error } = await supabase
      .from('revisao_emails')
      .update({ pdf_url: url })
      .eq('id', email.id);

    if (error) {
      console.error(`  Erro ao atualizar email ${email.id}:`, error.message);
    } else {
      atualizados++;
    }
  }

  console.log('\n=== Resultado ===');
  console.log(`Emails atualizados com PDF: ${atualizados}`);
  console.log(`Emails sem PDF correspondente: ${semMatch}`);
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
