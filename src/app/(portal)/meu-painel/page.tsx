'use client'
import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  Calendar, Wrench, Package, Clock, Navigation, MapPin,
  Plus, X, Send, FileText, AlertTriangle, ChevronRight, ChevronLeft,
  ClipboardList, AlertOctagon
} from 'lucide-react'

interface AgendaItem {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  data_agendada: string
  turno: string | null
  hora_inicio: string | null
  hora_fim: string | null
  descricao: string | null
  endereco: string | null
  cliente: string | null
  status: string
}

interface OrdemServico {
  Id_Ordem: string
  Status: string
  Os_Cliente: string
  Os_Tecnico: string
  Os_Tecnico2: string
  Previsao_Execucao: string | null
  Serv_Solicitado: string
  Endereco_Cliente: string
  Cidade_Cliente: string
  Tipo_Servico: string
}

interface Caminho {
  id: number
  tecnico_nome: string
  destino: string
  cidade: string
  motivo: string
  data_saida: string
  status: string
}

interface Execucao {
  id: number
  id_ordem: string
  data_execucao: string
  status: string
  servico_realizado: string | null
  created_at: string
}

interface Requisicao {
  id: number
  id_ordem: string | null
  material_solicitado: string
  quantidade: string | null
  urgencia: string
  status: string
  atualizada_pelo_tecnico: boolean
  created_at: string
}

interface Ocorrencia {
  id: number
  tipo: string
  descricao: string
  data: string
  pontos_descontados: number
  id_ordem: string | null
}

interface Justificativa {
  id: number
  id_ocorrencia: number | null
  justificativa: string
  status: string
}

const STAT_CARD = {
  background: '#fff', borderRadius: 14, padding: 20,
  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
}

function getWeekDays(date: Date): Date[] {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday)
    dd.setDate(monday.getDate() + i)
    return dd
  })
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0]
}

function formatDateBR(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}`
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

const TIPO_OCORRENCIA: Record<string, { label: string; color: string }> = {
  atraso: { label: 'Atraso', color: '#F59E0B' },
  erro: { label: 'Erro', color: '#EF4444' },
  retrabalho: { label: 'Retrabalho', color: '#DC2626' },
  falta_material: { label: 'Falta Material', color: '#8B5CF6' },
  outros: { label: 'Outros', color: '#6B7280' },
}

export default function MeuPainelPage() {
  const { userProfile } = useAuth()
  const [tecnicoNome, setTecnicoNome] = useState<string | null>(null)
  const [agendaHoje, setAgendaHoje] = useState<AgendaItem[]>([])
  const [ordensHoje, setOrdensHoje] = useState<OrdemServico[]>([])
  const [caminhoAtivo, setCaminhoAtivo] = useState<Caminho | null>(null)
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [execucoes, setExecucoes] = useState<Execucao[]>([])
  const [requisicoes, setRequisicoes] = useState<Requisicao[]>([])
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [justificativas, setJustificativas] = useState<Justificativa[]>([])
  const [loading, setLoading] = useState(true)
  const [showCaminhoForm, setShowCaminhoForm] = useState(false)
  const [novoCaminho, setNovoCaminho] = useState({ destino: '', cidade: '', motivo: '' })
  const [showJustForm, setShowJustForm] = useState<number | null>(null)
  const [justTexto, setJustTexto] = useState('')
  const [semanaRef, setSemanaRef] = useState(new Date())
  const [ordensSemana, setOrdensSemana] = useState<OrdemServico[]>([])

  const hoje = new Date().toISOString().split('T')[0]
  const weekDays = useMemo(() => getWeekDays(semanaRef), [semanaRef])
  const weekStart = formatDate(weekDays[0])
  const weekEnd = formatDate(weekDays[6])

  // Identificar técnico pelo nome do usuário logado
  useEffect(() => {
    if (!userProfile?.nome) return
    const buscarTecnico = async () => {
      const { data } = await supabase
        .from('mecanico_usuarios')
        .select('tecnico_nome')
        .ilike('tecnico_nome', `%${userProfile.nome.split(' ')[0]}%`)
        .limit(1)
        .single()
      if (data) setTecnicoNome(data.tecnico_nome)
      else setTecnicoNome(userProfile.nome)
    }
    buscarTecnico()
  }, [userProfile?.nome])

  const carregar = async () => {
    if (!tecnicoNome) return
    setLoading(true)

    const [
      { data: agenda },
      { data: ordens },
      { data: ordsSemana },
      { data: cams },
      { data: execs },
      { data: reqs },
      { data: ocors },
      { data: justs },
    ] = await Promise.all([
      supabase.from('agenda_tecnico').select('*').eq('tecnico_nome', tecnicoNome).eq('data_agendada', hoje).order('hora_inicio'),
      supabase.from('Ordem_Servico').select('*')
        .or(`Os_Tecnico.eq.${tecnicoNome},Os_Tecnico2.eq.${tecnicoNome}`)
        .not('Status', 'in', '("Concluída","Cancelada")')
        .order('Previsao_Execucao', { ascending: true }),
      // Ordens da semana (todas, incluindo concluídas - para a agenda)
      supabase.from('Ordem_Servico').select('*')
        .or(`Os_Tecnico.eq.${tecnicoNome},Os_Tecnico2.eq.${tecnicoNome}`)
        .not('Previsao_Execucao', 'is', null)
        .gte('Previsao_Execucao', weekStart)
        .lte('Previsao_Execucao', weekEnd)
        .order('Previsao_Execucao', { ascending: true }),
      supabase.from('tecnico_caminhos').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false }).limit(10),
      supabase.from('os_tecnico_execucao').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false }).limit(20),
      supabase.from('mecanico_requisicoes').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false }).limit(20),
      supabase.from('tecnico_ocorrencias').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false }).limit(20),
      supabase.from('tecnico_justificativas').select('*').eq('tecnico_nome', tecnicoNome).order('created_at', { ascending: false }).limit(20),
    ])

    setAgendaHoje((agenda as AgendaItem[]) || [])
    const todasOrdens = (ordens as OrdemServico[]) || []
    setOrdensHoje(todasOrdens.filter(o => o.Previsao_Execucao === hoje))
    setOrdensSemana((ordsSemana as OrdemServico[]) || [])
    setCaminhos((cams as Caminho[]) || [])
    setCaminhoAtivo(((cams as Caminho[]) || []).find(c => c.status === 'em_transito') || null)
    setExecucoes((execs as Execucao[]) || [])
    setRequisicoes((reqs as Requisicao[]) || [])
    setOcorrencias((ocors as Ocorrencia[]) || [])
    setJustificativas((justs as Justificativa[]) || [])
    setLoading(false)
  }

  useEffect(() => { if (tecnicoNome) carregar() }, [tecnicoNome, weekStart, weekEnd])

  // Realtime
  useEffect(() => {
    if (!tecnicoNome) return
    const channels = [
      supabase.channel('meu_agenda').on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_tecnico' }, () => carregar()).subscribe(),
      supabase.channel('meu_cam').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_caminhos' }, () => carregar()).subscribe(),
      supabase.channel('meu_ocor').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_ocorrencias' }, () => carregar()).subscribe(),
      supabase.channel('meu_just').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar()).subscribe(),
    ]
    return () => { channels.forEach(c => supabase.removeChannel(c)) }
  }, [tecnicoNome])

  // ─── Notificar admins ─────────────────────────────────────────
  const notificarAdmins = async (tipo: string, titulo: string, descricao?: string) => {
    try {
      const { data: admins } = await supabase.from('portal_permissoes').select('user_id').eq('is_admin', true)
      if (!admins || admins.length === 0) return
      await supabase.from('portal_notificacoes').insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id, tipo, titulo,
          descricao: descricao || null,
          link: '/painel-mecanicos',
        }))
      )
    } catch (err) { console.error('[MeuPainel] Erro ao notificar:', err) }
  }

  // ─── Actions ──────────────────────────────────────────────────
  const salvarCaminho = async () => {
    if (!tecnicoNome || !novoCaminho.destino || !novoCaminho.cidade) return
    await supabase.from('tecnico_caminhos').insert({
      tecnico_nome: tecnicoNome,
      destino: novoCaminho.destino,
      cidade: novoCaminho.cidade,
      motivo: novoCaminho.motivo,
      status: 'em_transito',
    })
    await notificarAdmins(
      'pos',
      `${tecnicoNome} - Novo caminho`,
      `Indo para ${novoCaminho.destino} (${novoCaminho.cidade})${novoCaminho.motivo ? ` - ${novoCaminho.motivo}` : ''}`
    )
    setNovoCaminho({ destino: '', cidade: '', motivo: '' })
    setShowCaminhoForm(false)
    carregar()
  }

  const finalizarCaminho = async (id: number) => {
    const cam = caminhos.find(c => c.id === id)
    await supabase.from('tecnico_caminhos').update({ status: 'chegou' }).eq('id', id)
    if (cam) {
      await notificarAdmins('pos', `${tecnicoNome} chegou ao destino`, `${cam.destino} (${cam.cidade})`)
    }
    carregar()
  }

  const enviarJustificativa = async (ocorrenciaId: number) => {
    if (!tecnicoNome || !justTexto.trim()) return
    const oc = ocorrencias.find(o => o.id === ocorrenciaId)
    await supabase.from('tecnico_justificativas').insert({
      tecnico_nome: tecnicoNome,
      id_ordem: oc?.id_ordem || null,
      id_ocorrencia: ocorrenciaId,
      justificativa: justTexto.trim(),
      status: 'pendente',
    })
    await notificarAdmins(
      'pos',
      `Nova justificativa - ${tecnicoNome}`,
      `${justTexto.trim().substring(0, 100)}${oc?.id_ordem ? ` (OS: ${oc.id_ordem})` : ''}`
    )
    setJustTexto('')
    setShowJustForm(null)
    carregar()
  }

  // ─── Computed ─────────────────────────────────────────────────
  const pontuacao = useMemo(() => {
    let pts = 100
    ocorrencias.forEach(o => {
      const justAprovada = justificativas.find(j => j.id_ocorrencia === o.id && j.status === 'aprovada')
      if (!justAprovada) pts = Math.max(0, pts - o.pontos_descontados)
    })
    return pts
  }, [ocorrencias, justificativas])

  const pontosColor = pontuacao >= 80 ? '#10B981' : pontuacao >= 50 ? '#F59E0B' : '#EF4444'

  const reqPendentes = requisicoes.filter(r => r.status === 'aprovada' && !r.atualizada_pelo_tecnico)
  const ocorrenciasSemJust = ocorrencias.filter(o => !justificativas.some(j => j.id_ocorrencia === o.id))

  // Serviços previstos para hoje (agenda + ordens)
  const servicosHoje = useMemo(() => {
    const items: { id: string; ordem: string; cliente: string; endereco: string; tipo: string; hora?: string }[] = []
    agendaHoje.forEach(a => {
      items.push({
        id: `ag-${a.id}`,
        ordem: a.id_ordem || '',
        cliente: a.cliente || '',
        endereco: a.endereco || '',
        tipo: '',
        hora: a.hora_inicio || undefined,
      })
    })
    ordensHoje.forEach(o => {
      if (!items.some(it => it.ordem === o.Id_Ordem)) {
        items.push({
          id: `os-${o.Id_Ordem}`,
          ordem: o.Id_Ordem,
          cliente: o.Os_Cliente,
          endereco: o.Endereco_Cliente,
          tipo: o.Tipo_Servico,
        })
      }
    })
    return items
  }, [agendaHoje, ordensHoje])

  if (loading && !tecnicoNome) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Carregando...</div>
  }

  const avatarUrl = userProfile?.avatar_url

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px 16px 40px' }}>

      {/* ── Perfil ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          width: 90, height: 90, borderRadius: '50%', margin: '0 auto 12px',
          overflow: 'hidden', border: '3px solid #1E3A5F',
          background: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 36, fontWeight: 700, color: '#1E3A5F' }}>
              {(tecnicoNome || userProfile?.nome || '?').charAt(0)}
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', margin: '0 0 4px' }}>
          {tecnicoNome || userProfile?.nome}
        </h1>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: 600, color: '#6B7280',
          }}>
            Técnico de Campo
          </span>
          <span style={{
            fontSize: 14, fontWeight: 800, color: pontosColor,
            background: `${pontosColor}15`, padding: '2px 10px', borderRadius: 8,
          }}>
            {pontuacao} pts
          </span>
        </div>
      </div>

      {/* ── Agenda Semanal ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => { const d = new Date(semanaRef); d.setDate(d.getDate() - 7); setSemanaRef(d) }} style={{
            background: '#F3F4F6', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
          }}>
            <ChevronLeft size={16} />
          </button>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1F2937', margin: 0, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <Calendar size={16} color="#3B82F6" /> Semana {formatDateBR(weekStart)} - {formatDateBR(weekEnd)}
            </h2>
            <button onClick={() => setSemanaRef(new Date())} style={{
              background: 'none', border: 'none', color: '#3B82F6', fontSize: 11,
              fontWeight: 600, cursor: 'pointer', marginTop: 2,
            }}>
              Ir para semana atual
            </button>
          </div>
          <button onClick={() => { const d = new Date(semanaRef); d.setDate(d.getDate() + 7); setSemanaRef(d) }} style={{
            background: '#F3F4F6', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
          }}>
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Grid semanal */}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, minWidth: 600 }}>
            {/* Header dias */}
            {weekDays.map((d, i) => {
              const isHoje = formatDate(d) === hoje
              return (
                <div key={i} style={{
                  padding: '10px 6px', textAlign: 'center',
                  background: isHoje ? '#2563EB' : '#1E3A5F',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  borderRadius: i === 0 ? '8px 0 0 0' : i === 6 ? '0 8px 0 0' : undefined,
                }}>
                  <div>{DIAS_SEMANA[i]}</div>
                  <div style={{ fontSize: 18, marginTop: 2 }}>{d.getDate()}</div>
                </div>
              )
            })}

            {/* Células dos dias */}
            {weekDays.map((d, dayIdx) => {
              const dateStr = formatDate(d)
              const isHoje = dateStr === hoje
              const isPast = d < new Date(hoje)
              const ordensNoDia = ordensSemana.filter(o => o.Previsao_Execucao === dateStr)
              const caminhosNoDia = caminhos.filter(c => c.data_saida.split('T')[0] === dateStr)

              return (
                <div key={dayIdx} style={{
                  padding: 6, background: isHoje ? '#EFF6FF' : isPast ? '#FAFAFA' : '#fff',
                  border: `1px solid ${isHoje ? '#BFDBFE' : '#E5E7EB'}`,
                  minHeight: 100, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {ordensNoDia.map(o => {
                    const cidade = o.Cidade_Cliente?.trim() || ''
                    const isConcluida = o.Status === 'Concluída'
                    const isCancelada = o.Status === 'Cancelada'
                    const isExecucao = o.Status.includes('Execução') || o.Status.includes('Aguardando ordem')
                    const bgColor = isConcluida ? '#F0FDF4' : isCancelada ? '#F5F5F5' : isExecucao ? '#EFF6FF' : '#FFFBEB'
                    const borderColor = isConcluida ? '#10B981' : isCancelada ? '#9CA3AF' : isExecucao ? '#3B82F6' : '#F59E0B'
                    const clienteNome = o.Os_Cliente ? o.Os_Cliente.split(' ').slice(0, 2).join(' ') : ''
                    let solicitacao = ''
                    if (o.Serv_Solicitado) {
                      const match = o.Serv_Solicitado.match(/Solicitação do cliente:\s*([\s\S]*?)(?:\nServiço Realizado:|$)/i)
                      solicitacao = match ? match[1].trim() : o.Serv_Solicitado.substring(0, 80)
                    }
                    return (
                      <div key={o.Id_Ordem} style={{
                        background: bgColor, borderRadius: 6, padding: '6px 8px',
                        borderLeft: `3px solid ${borderColor}`,
                        opacity: isCancelada ? 0.5 : 1,
                      }}>
                        <div style={{ fontWeight: 700, color: '#1E3A5F', fontSize: 12, marginBottom: 2 }}>
                          {clienteNome}{cidade ? ` - ${cidade}` : ''}
                          {isConcluida && (
                            <span style={{ fontSize: 8, fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '1px 4px', borderRadius: 3, marginLeft: 4 }}>OK</span>
                          )}
                        </div>
                        {solicitacao && (
                          <div style={{ color: '#374151', fontSize: 10, lineHeight: 1.3 }}>
                            {solicitacao.substring(0, 100)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {caminhosNoDia.map(cam => (
                    <div key={cam.id} style={{
                      background: '#EDE9FE', borderRadius: 6, padding: '5px 8px',
                      borderLeft: '3px solid #8B5CF6',
                    }}>
                      <div style={{ fontWeight: 700, color: '#7C3AED', fontSize: 11, marginBottom: 2 }}>
                        <Navigation size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        {cam.destino}
                      </div>
                      <div style={{ fontSize: 10, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <MapPin size={8} /> {cam.cidade}
                      </div>
                    </div>
                  ))}
                  {ordensNoDia.length === 0 && caminhosNoDia.length === 0 && (
                    <div style={{ color: '#E5E7EB', fontSize: 10, textAlign: 'center', paddingTop: 30 }}>—</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Caminho Ativo ── */}
      {caminhoAtivo && (
        <div style={{
          ...STAT_CARD, padding: 16, borderLeft: '4px solid #8B5CF6', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Navigation size={16} color="#8B5CF6" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#7C3AED' }}>Em trânsito</span>
            </div>
            <button onClick={() => finalizarCaminho(caminhoAtivo.id)} style={{
              background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              Cheguei
            </button>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{caminhoAtivo.destino}</div>
          <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <MapPin size={12} /> {caminhoAtivo.cidade}
          </div>
          {caminhoAtivo.motivo && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>{caminhoAtivo.motivo}</div>}
        </div>
      )}

      {/* ── Botão Novo Caminho ── */}
      {!showCaminhoForm ? (
        <button onClick={() => setShowCaminhoForm(true)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '14px 0', borderRadius: 12, border: '2px dashed #C4B5FD',
          background: '#F5F3FF', color: '#7C3AED', fontSize: 14, fontWeight: 700,
          cursor: 'pointer', marginBottom: 20,
        }}>
          <Navigation size={18} /> {caminhoAtivo ? 'Novo Destino' : 'Registrar Caminho'}
        </button>
      ) : (
        <div style={{ ...STAT_CARD, padding: 16, marginBottom: 20, border: '2px solid #C4B5FD' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#7C3AED' }}>Novo Caminho</span>
            <button onClick={() => setShowCaminhoForm(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF',
            }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text" placeholder="Destino (ex: Fazenda São João)"
              value={novoCaminho.destino}
              onChange={e => setNovoCaminho({ ...novoCaminho, destino: e.target.value })}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <input
              type="text" placeholder="Cidade"
              value={novoCaminho.cidade}
              onChange={e => setNovoCaminho({ ...novoCaminho, cidade: e.target.value })}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <input
              type="text" placeholder="Motivo (opcional)"
              value={novoCaminho.motivo}
              onChange={e => setNovoCaminho({ ...novoCaminho, motivo: e.target.value })}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <button onClick={salvarCaminho} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
              background: '#7C3AED', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>
              <Send size={16} /> Registrar
            </button>
          </div>
        </div>
      )}

      {/* ── Botões de Ação ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        <button onClick={() => window.location.href = '/pos'} style={{
          ...STAT_CARD, padding: 16, border: 'none', cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: '#EFF6FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wrench size={22} color="#3B82F6" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Ordens de Serviço</span>
        </button>
        <button onClick={() => window.location.href = '/requisicoes'} style={{
          ...STAT_CARD, padding: 16, border: 'none', cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: '#FEF3C7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ClipboardList size={22} color="#D97706" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Requisições</span>
        </button>
        <button onClick={() => window.location.href = '/agenda-tecnicos'} style={{
          ...STAT_CARD, padding: 16, border: 'none', cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: '#D1FAE5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Calendar size={22} color="#065F46" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Minha Agenda</span>
        </button>
        <button onClick={() => window.location.href = '/painel-mecanicos'} style={{
          ...STAT_CARD, padding: 16, border: 'none', cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: '#EDE9FE',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={22} color="#7C3AED" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Painel Geral</span>
        </button>
      </div>

      {/* ── Pendências ── */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1F2937', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={16} color="#F59E0B" /> Pendências
      </h2>

      {/* Requisições pendentes de confirmação */}
      {reqPendentes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#D97706', marginBottom: 6 }}>
            Requisições aprovadas - confirme o recebimento:
          </div>
          {reqPendentes.map(req => (
            <div key={req.id} style={{
              ...STAT_CARD, padding: 12, marginBottom: 8, borderLeft: '4px solid #F59E0B',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{req.material_solicitado}</div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                {req.quantidade && `Qtd: ${req.quantidade} • `}
                {req.id_ordem && `OS: ${req.id_ordem}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ocorrências sem justificativa */}
      {ocorrenciasSemJust.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', marginBottom: 6 }}>
            Ocorrências pendentes de justificativa:
          </div>
          {ocorrenciasSemJust.map(oc => {
            const tipoInfo = TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros
            const isFormOpen = showJustForm === oc.id
            return (
              <div key={oc.id} style={{
                ...STAT_CARD, padding: 12, marginBottom: 8, borderLeft: `4px solid ${tipoInfo.color}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: `${tipoInfo.color}20`, color: tipoInfo.color,
                    }}>
                      {tipoInfo.label}
                    </span>
                    {oc.id_ordem && <span style={{ fontSize: 11, color: '#6B7280' }}>OS: {oc.id_ordem}</span>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>-{oc.pontos_descontados} pts</span>
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>{oc.descricao}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>
                  {new Date(oc.data).toLocaleDateString('pt-BR')}
                </div>

                {!isFormOpen ? (
                  <button onClick={() => setShowJustForm(oc.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: '#EFF6FF', color: '#1E3A5F', border: 'none', borderRadius: 6,
                    padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%',
                    justifyContent: 'center',
                  }}>
                    <FileText size={14} /> Enviar Justificativa
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                      value={justTexto}
                      onChange={e => setJustTexto(e.target.value)}
                      placeholder="Explique o que aconteceu..."
                      rows={3}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                        fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => enviarJustificativa(oc.id)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: '#1E3A5F', color: '#fff', border: 'none', borderRadius: 8,
                        padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}>
                        <Send size={14} /> Enviar
                      </button>
                      <button onClick={() => { setShowJustForm(null); setJustTexto('') }} style={{
                        padding: '10px 14px', background: '#F3F4F6', color: '#6B7280', border: 'none',
                        borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Sem pendências */}
      {reqPendentes.length === 0 && ocorrenciasSemJust.length === 0 && (
        <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 24 }}>
          Nenhuma pendência no momento
        </div>
      )}
    </div>
  )
}
