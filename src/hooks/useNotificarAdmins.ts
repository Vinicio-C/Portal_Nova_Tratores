import { supabase } from '@/lib/supabase'

/**
 * Notifica todos os admins do portal via portal_notificacoes.
 * Uso client-side (sem server import).
 */
export async function notificarAdminsClient(
  tipo: string,
  titulo: string,
  descricao?: string,
  link?: string
) {
  try {
    const { data: admins } = await supabase
      .from('portal_permissoes')
      .select('user_id')
      .eq('is_admin', true)

    if (!admins || admins.length === 0) return

    await supabase.from('portal_notificacoes').insert(
      admins.map((a: { user_id: string }) => ({
        user_id: a.user_id,
        tipo,
        titulo,
        descricao: descricao || null,
        link: link || null,
      }))
    )
  } catch (e) {
    console.error('[notificarAdmins] Erro:', e)
  }
}
