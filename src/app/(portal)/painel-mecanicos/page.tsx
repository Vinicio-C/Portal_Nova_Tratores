'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissoes } from '@/hooks/usePermissoes'
import SemPermissao from '@/components/SemPermissao'
import { supabase } from '@/lib/supabase'
import BlocoOrdens from '@/components/painel-mecanicos/BlocoOrdens'
import BlocoRequisicoes from '@/components/painel-mecanicos/BlocoRequisicoes'
import BlocoAlertas, { type Alerta } from '@/components/painel-mecanicos/BlocoAlertas'
import {
  Users, FileText, Package, AlertTriangle, RefreshCw, Shield,
  ChevronDown, ChevronUp, Star, Clock, Wrench, AlertOctagon,
  ThumbsUp, ThumbsDown, X, Send, Navigation, Plus
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────
interface Tecnico {
  user_id: string
  tecnico_nome: string
  tecnico_email: string
  mecanico_role: 'tecnico' | 'observador'
}

interface OrdemServico {
  Id_Ordem: string
  Status: string
  Os_Cliente: string
  Cnpj_Cliente: string
  Os_Tecnico: string
  Os_Tecnico2: string
  Previsao_Execucao: string | null
  Serv_Solicitado: string
  Endereco_Cliente: string
  Cidade_Cliente: string
  Tipo_Servico: string
}

interface RequisicaoGeral {
  id: number
  titulo: string
  tipo: string
  solicitante: string
  setor: string
  status: string
  ordem_servico: string | null
  created_at: string
  updated_at: string | null
}

interface UsuarioBanco {
  id: string
  nome: string
  email: string
}

interface Execucao {
  id: number
  id_ordem: string
  tecnico_nome: string
  data_execucao: string
  status: string
  servico_realizado: string | null
  created_at: string
}

interface RequisicaoMecanico {
  id: number
  id_ordem: string | null
  tecnico_nome: string
  material_solicitado: string
  quantidade: string | null
  urgencia: string
  status: string
  atualizada_pelo_tecnico: boolean
  created_at: string
}

interface Ocorrencia {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  tipo: string
  descricao: string
  data: string
  pontos_descontados: number
  created_at: string
}

interface Justificativa {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  id_ocorrencia: number | null
  justificativa: string
  status: string
  descontar_comissao: boolean | null
  avaliado_por: string | null
  data_avaliacao: string | null
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────
const STAT_CARD = {
  background: '#fff', borderRadius: 14, padding: 20,
  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
}

function normalizarNome(nome: string): string[] {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(p => p.length > 2)
}

function nomesBatem(nomeA: string, nomeB: string): boolean {
  if (!nomeA || !nomeB) return false
  const partesA = normalizarNome(nomeA)
  const partesB = normalizarNome(nomeB)
  if (partesA.length === 0 || partesB.length === 0) return false
  if (partesA[0] !== partesB[0]) return false
  if (partesA.length === 1 || partesB.length === 1) return true
  const sobrenomesA = new Set(partesA.slice(1))
  return partesB.slice(1).some(p => sobrenomesA.has(p))
}

const TIPO_OCORRENCIA: Record<string, { label: string; color: string }> = {
  atraso: { label: 'Atraso', color: '#F59E0B' },
  erro: { label: 'Erro', color: '#EF4444' },
  retrabalho: { label: 'Retrabalho', color: '#DC2626' },
  falta_material: { label: 'Falta Material', color: '#8B5CF6' },
  outros: { label: 'Outros', color: '#6B7280' },
}

type Bloco = 'ordens' | 'requisicoes' | 'alertas' | 'tecnicos'

// ─── Component ───────────────────────────────────────────────────
export default function PainelMecanicosWrapper() {
  const { userProfile } = useAuth()
  const { temAcesso, loading: loadingPerm } = usePermissoes(userProfile?.id)
  if (!loadingPerm && userProfile && !temAcesso('painel-mecanicos')) return <SemPermissao />
  return <PainelMecanicosPage />
}

function PainelMecanicosPage() {
  const { userProfile } = useAuth()
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [requisicoes, setRequisicoes] = useState<RequisicaoGeral[]>([])
  const [usuariosBanco, setUsuariosBanco] = useState<UsuarioBanco[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [execucoesRecentes, setExecucoesRecentes] = useState<Execucao[]>([])
  const [reqsMecanico, setReqsMecanico] = useState<RequisicaoMecanico[]>([])
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [justificativas, setJustificativas] = useState<Justificativa[]>([])
  const [loading, setLoading] = useState(true)
  const [blocoAtivo, setBlocoAtivo] = useState<Bloco>('ordens')

  // Técnicos expandidos
  const [expandedTec, setExpandedTec] = useState<string | null>(null)
  const [tecSubTab, setTecSubTab] = useState<'atrasos' | 'ocorrencias' | 'execucoes'>('atrasos')

  // Modal nova ocorrência
  const [showOcorrenciaModal, setShowOcorrenciaModal] = useState(false)
  const [novaOcorrencia, setNovaOcorrencia] = useState({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })

  const carregar = useCallback(async () => {
    setLoading(true)

    const [
      { data: tecs },
      { data: usus },
      { data: ords },
      { data: reqs },
      { data: alerts },
      { data: execs },
      { data: reqsMec },
      { data: ocors },
      { data: justs },
    ] = await Promise.all([
      supabase.from('portal_permissoes')
        .select('user_id, mecanico_role, mecanico_tecnico_nome')
        .not('mecanico_role', 'is', null)
        .not('mecanico_tecnico_nome', 'is', null),
      supabase.from('financeiro_usu').select('id, nome, email'),
      supabase.from('Ordem_Servico').select('*')
        .order('Previsao_Execucao', { ascending: true }),
      supabase.from('Requisicao').select('*')
        .order('id', { ascending: false })
        .limit(500),
      supabase.from('painel_alertas').select('*')
        .order('created_at', { ascending: false }),
      supabase.from('os_tecnico_execucao').select('*')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('mecanico_requisicoes').select('*')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('tecnico_ocorrencias').select('*')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('tecnico_justificativas').select('*')
        .order('created_at', { ascending: false }).limit(200),
    ])

    const emailMap: Record<string, string> = {}
    const usuList: UsuarioBanco[] = []
    ;((usus || []) as any[]).forEach(u => {
      emailMap[u.id] = u.email || ''
      usuList.push({ id: u.id, nome: u.nome || '', email: u.email || '' })
    })
    setUsuariosBanco(usuList)

    setTecnicos(
      ((tecs || []) as any[]).map(t => ({
        user_id: t.user_id,
        tecnico_nome: t.mecanico_tecnico_nome,
        tecnico_email: emailMap[t.user_id] || '',
        mecanico_role: t.mecanico_role,
      })).sort((a: Tecnico, b: Tecnico) => a.tecnico_nome.localeCompare(b.tecnico_nome))
    )

    setOrdens((ords as OrdemServico[]) || [])

    // Normaliza requisições (campos legados)
    setRequisicoes(
      ((reqs || []) as any[]).map(r => ({
        id: r.id,
        titulo: r.titulo || r.Material_Serv_Solicitado || '',
        tipo: r.tipo || r.ReqTipo || 'Peça',
        solicitante: r.solicitante || r.ReqSolicitante || '',
        setor: r.setor || r.ReqQuem || '',
        status: r.status || 'pedido',
        ordem_servico: r.ordem_servico || r.Os_Vinculada || null,
        created_at: r.created_at || '',
        updated_at: r.updated_at || null,
      }))
    )

    setAlertas((alerts as Alerta[]) || [])
    setExecucoesRecentes((execs as Execucao[]) || [])
    setReqsMecanico((reqsMec as RequisicaoMecanico[]) || [])
    setOcorrencias((ocors as Ocorrencia[]) || [])
    setJustificativas((justs as Justificativa[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Realtime
  useEffect(() => {
    const channels = [
      supabase.channel('painel_os').on('postgres_changes', { event: '*', schema: 'public', table: 'Ordem_Servico' }, () => carregar()).subscribe(),
      supabase.channel('painel_req2').on('postgres_changes', { event: '*', schema: 'public', table: 'Requisicao' }, () => carregar()).subscribe(),
      supabase.channel('painel_alertas').on('postgres_changes', { event: '*', schema: 'public', table: 'painel_alertas' }, () => carregar()).subscribe(),
      supabase.channel('painel_exec').on('postgres_changes', { event: '*', schema: 'public', table: 'os_tecnico_execucao' }, () => carregar()).subscribe(),
      supabase.channel('painel_req_m').on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_requisicoes' }, () => carregar()).subscribe(),
      supabase.channel('painel_just').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar()).subscribe(),
    ]
    return () => { channels.forEach(c => supabase.removeChannel(c)) }
  }, [carregar])

  // ─── Computed ────────────────────────────────────────────────
  const tecnicosAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')
  const reqPendentes = reqsMecanico.filter(r => r.status === 'pendente')
  const justPendentes = justificativas.filter(j => j.status === 'pendente')

  // Pontuação por técnico
  const pontuacaoTecnico = useMemo(() => {
    const map: Record<string, number> = {}
    tecnicos.forEach(t => { map[t.tecnico_nome] = 100 })
    ocorrencias.forEach(o => {
      if (map[o.tecnico_nome] !== undefined) {
        const justAprovada = justificativas.find(j => j.id_ocorrencia === o.id && j.status === 'aprovada' && j.descontar_comissao === false)
        if (!justAprovada) {
          map[o.tecnico_nome] = Math.max(0, (map[o.tecnico_nome] || 100) - o.pontos_descontados)
        }
      }
    })
    return map
  }, [tecnicos, ocorrencias, justificativas])

  // Ordens em atraso por técnico
  const ordensAtrasoPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    const hoje = new Date()
    tecnicos.forEach(tec => {
      const ordsTec = ordens.filter(o =>
        o.Status !== 'Concluída' && o.Status !== 'Cancelada' &&
        (nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2))
      )
      const atrasadas = ordsTec.filter(o =>
        o.Previsao_Execucao && new Date(o.Previsao_Execucao + 'T23:59:59') < hoje
      )
      if (atrasadas.length > 0) map[tec.tecnico_nome] = atrasadas
    })
    return map
  }, [tecnicos, ordens])

  // Contagens para badges dos blocos
  const ordensAtivasCount = useMemo(() =>
    ordens.filter(o => o.Status !== 'Concluída' && o.Status !== 'Cancelada').length,
    [ordens]
  )
  const reqsPedidoCount = useMemo(() =>
    requisicoes.filter(r => r.status === 'pedido').length,
    [requisicoes]
  )
  const alertasAbertosCount = useMemo(() =>
    alertas.filter(a => a.status === 'aberto').length,
    [alertas]
  )

  // ─── Actions ─────────────────────────────────────────────────
  const notificarAdmins = async (tipo: string, titulo: string, descricao?: string, link?: string) => {
    try {
      const { data: admins } = await supabase
        .from('portal_permissoes').select('user_id').eq('is_admin', true)
      if (!admins || admins.length === 0) return
      await supabase.from('portal_notificacoes').insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id, tipo, titulo,
          descricao: descricao || null,
          link: link || '/painel-mecanicos',
        }))
      )
    } catch (err) { console.error('[Painel] Erro ao notificar:', err) }
  }

  const aprovarRequisicao = async (reqId: number) => {
    await supabase.from('mecanico_requisicoes').update({ status: 'aprovada', data_aprovacao: new Date().toISOString() }).eq('id', reqId)
    const req = reqsMecanico.find(r => r.id === reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição aprovada',
        descricao: `Sua requisição "${req.material_solicitado}" foi aprovada.`, link: '', lida: false,
      })
      await notificarAdmins('pos', `Requisição aprovada - ${req.tecnico_nome}`, `Material: ${req.material_solicitado}`)
    }
    carregar()
  }

  const recusarRequisicao = async (reqId: number) => {
    if (!confirm('Recusar esta requisição?')) return
    const req = reqsMecanico.find(r => r.id === reqId)
    await supabase.from('mecanico_requisicoes').update({ status: 'recusada' }).eq('id', reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome, tipo: 'requisicao', titulo: 'Requisição recusada',
        descricao: `Sua requisição "${req.material_solicitado}" foi recusada.`, link: '', lida: false,
      })
    }
    carregar()
  }

  const salvarOcorrencia = async () => {
    if (!novaOcorrencia.tecnico_nome || !novaOcorrencia.descricao) return
    await supabase.from('tecnico_ocorrencias').insert({
      tecnico_nome: novaOcorrencia.tecnico_nome,
      id_ordem: novaOcorrencia.id_ordem || null,
      tipo: novaOcorrencia.tipo,
      descricao: novaOcorrencia.descricao,
      pontos_descontados: novaOcorrencia.pontos_descontados,
    })
    const tipoLabel = (TIPO_OCORRENCIA[novaOcorrencia.tipo] || TIPO_OCORRENCIA.outros).label
    await notificarAdmins('pos', `Nova ocorrência - ${novaOcorrencia.tecnico_nome}`,
      `${tipoLabel}: ${novaOcorrencia.descricao}${novaOcorrencia.id_ordem ? ` (OS: ${novaOcorrencia.id_ordem})` : ''} | -${novaOcorrencia.pontos_descontados} pts`)
    await supabase.from('mecanico_notificacoes').insert({
      tecnico_nome: novaOcorrencia.tecnico_nome, tipo: 'execucao',
      titulo: `Ocorrência registrada: ${tipoLabel}`,
      descricao: `${novaOcorrencia.descricao} (-${novaOcorrencia.pontos_descontados} pts)`,
      link: '', lida: false,
    })
    setNovaOcorrencia({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })
    setShowOcorrenciaModal(false)
    carregar()
  }

  const avaliarJustificativa = async (id: number, aprovada: boolean) => {
    const just = justificativas.find(j => j.id === id)
    await supabase.from('tecnico_justificativas').update({
      status: aprovada ? 'aprovada' : 'recusada',
      descontar_comissao: !aprovada,
      data_avaliacao: new Date().toISOString(),
    }).eq('id', id)
    if (just) {
      await notificarAdmins('pos',
        `Justificativa ${aprovada ? 'aceita' : 'recusada'} - ${just.tecnico_nome}`,
        `${just.justificativa.substring(0, 100)}${aprovada ? ' (sem desconto)' : ' (desconta comissão)'}`)
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: just.tecnico_nome, tipo: 'execucao',
        titulo: `Justificativa ${aprovada ? 'aceita' : 'recusada'}`,
        descricao: aprovada ? 'Sua justificativa foi aceita, sem desconto na comissão.' : 'Sua justificativa foi recusada, haverá desconto na comissão.',
        link: '', lida: false,
      })
    }
    carregar()
  }

  // ─── Render ──────────────────────────────────────────────────
  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Carregando painel...</div>

  const BLOCOS: { id: Bloco; label: string; icon: React.ReactNode; color: string; badge?: number }[] = [
    { id: 'ordens', label: 'Ordens', icon: <FileText size={20} />, color: '#1E3A5F', badge: ordensAtivasCount },
    { id: 'requisicoes', label: 'Requisições', icon: <Package size={20} />, color: '#F59E0B', badge: reqsPedidoCount },
    { id: 'alertas', label: 'Alertas', icon: <AlertTriangle size={20} />, color: '#EF4444', badge: alertasAbertosCount },
    { id: 'tecnicos', label: 'Técnicos', icon: <Users size={20} />, color: '#7C3AED', badge: tecnicosAtivos.length },
  ]

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
          <Shield size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Painel Mecânicos
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowOcorrenciaModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <AlertOctagon size={14} /> Nova Ocorrência
          </button>
          <button onClick={carregar} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#EFF6FF', color: '#1E3A5F', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* ═══ Seletor de Blocos ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {BLOCOS.map(b => {
          const isActive = blocoAtivo === b.id
          return (
            <button
              key={b.id}
              onClick={() => setBlocoAtivo(b.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '18px 16px', borderRadius: 14,
                border: isActive ? `3px solid ${b.color}` : '3px solid transparent',
                background: isActive ? '#fff' : '#F9FAFB',
                boxShadow: isActive ? `0 4px 16px ${b.color}25` : '0 1px 4px rgba(0,0,0,0.04)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ color: isActive ? b.color : '#9CA3AF' }}>{b.icon}</div>
              <span style={{
                fontSize: 16, fontWeight: 800,
                color: isActive ? b.color : '#6B7280',
              }}>
                {b.label}
              </span>
              {(b.badge !== undefined && b.badge > 0) && (
                <span style={{
                  fontSize: 13, fontWeight: 800, minWidth: 28, textAlign: 'center',
                  padding: '2px 8px', borderRadius: 10,
                  background: isActive ? b.color : '#E5E7EB',
                  color: isActive ? '#fff' : '#6B7280',
                }}>
                  {b.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ═══ BLOCO: ORDENS ═══ */}
      {blocoAtivo === 'ordens' && (
        <BlocoOrdens tecnicos={tecnicos} ordens={ordens} />
      )}

      {/* ═══ BLOCO: REQUISIÇÕES ═══ */}
      {blocoAtivo === 'requisicoes' && (
        <BlocoRequisicoes
          tecnicos={tecnicos}
          requisicoes={requisicoes}
          usuariosBanco={usuariosBanco}
        />
      )}

      {/* ═══ BLOCO: ALERTAS ═══ */}
      {blocoAtivo === 'alertas' && (
        <BlocoAlertas
          tecnicos={tecnicos}
          alertas={alertas}
          onRecarregar={carregar}
          userName={userProfile?.nome || ''}
        />
      )}

      {/* ═══ BLOCO: TÉCNICOS ═══ */}
      {blocoAtivo === 'tecnicos' && (
        <div>
          {/* Justificativas pendentes no topo */}
          {justPendentes.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#D97706', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} /> Justificativas Pendentes ({justPendentes.length})
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 10 }}>
                {justPendentes.map(j => {
                  const oc = ocorrencias.find(o => o.id === j.id_ocorrencia)
                  return (
                    <div key={j.id} style={{
                      ...STAT_CARD, padding: 16, borderLeft: '4px solid #F59E0B',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{j.tecnico_nome}</span>
                          {j.id_ordem && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>OS: {j.id_ordem}</span>}
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#FEF3C7', color: '#D97706' }}>
                          Pendente
                        </span>
                      </div>
                      {oc && (
                        <div style={{
                          background: '#F9FAFB', borderRadius: 6, padding: 10, marginBottom: 8,
                          border: '1px solid #E5E7EB',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Ocorrência:</div>
                          <div style={{ fontSize: 12, color: '#374151' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                              background: `${(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color}20`,
                              color: (TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).color,
                              marginRight: 6,
                            }}>
                              {(TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros).label}
                            </span>
                            {oc.descricao}
                            <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 8 }}>-{oc.pontos_descontados} pts</span>
                          </div>
                        </div>
                      )}
                      <div style={{
                        fontSize: 13, color: '#374151', marginBottom: 12, background: '#FFFBEB',
                        padding: 10, borderRadius: 6, border: '1px solid #FDE68A',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Justificativa:</div>
                        {j.justificativa}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => avaliarJustificativa(j.id, true)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#10B981', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}>
                          <ThumbsUp size={16} /> Aceitar
                        </button>
                        <button onClick={() => avaliarJustificativa(j.id, false)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}>
                          <ThumbsDown size={16} /> Recusar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Requisições pendentes do mecânico */}
          {reqPendentes.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package size={16} /> Requisições de Material Pendentes ({reqPendentes.length})
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                {reqPendentes.map(req => (
                  <div key={req.id} style={{
                    ...STAT_CARD, padding: 14, borderLeft: '4px solid #F59E0B',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{req.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: req.urgencia === 'alta' ? '#FEE2E2' : '#FEF3C7',
                        color: req.urgencia === 'alta' ? '#DC2626' : '#D97706',
                      }}>
                        {req.urgencia === 'alta' ? 'Urgente' : 'Normal'}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{req.material_solicitado}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      {req.quantidade && `Qtd: ${req.quantidade} • `}
                      {req.id_ordem && `OS: ${req.id_ordem} • `}
                      {new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => aprovarRequisicao(req.id)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 6,
                        padding: '6px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                        Aprovar
                      </button>
                      <button onClick={() => recusarRequisicao(req.id)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: 6,
                        padding: '6px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lista de técnicos */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} /> Técnicos ({tecnicosAtivos.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tecnicos.map(tec => {
              const isExpanded = expandedTec === tec.user_id
              const pontos = pontuacaoTecnico[tec.tecnico_nome] ?? 100
              const atrasosDoTec = ordensAtrasoPorTecnico[tec.tecnico_nome] || []
              const ocorrDoTec = ocorrencias.filter(o => o.tecnico_nome === tec.tecnico_nome)
              const execsDoTec = execucoesRecentes.filter(e => e.tecnico_nome === tec.tecnico_nome)
              const pontosColor = pontos >= 80 ? '#10B981' : pontos >= 50 ? '#F59E0B' : '#EF4444'
              const roleLabel = tec.mecanico_role === 'tecnico' ? 'TÉCNICO' : 'OBSERVADOR'
              const roleColor = tec.mecanico_role === 'tecnico' ? '#1E3A5F' : '#7C3AED'

              return (
                <div key={tec.user_id} style={{ ...STAT_CARD, padding: 0, overflow: 'hidden' }}>
                  <div
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '14px 16px', cursor: 'pointer',
                    }}
                    onClick={() => { setExpandedTec(isExpanded ? null : tec.user_id); setTecSubTab('atrasos') }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', background: '#1E3A5F',
                        color: '#fff', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 14, fontWeight: 700,
                      }}>
                        {tec.tecnico_nome.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937' }}>{tec.tecnico_nome}</div>
                        <div style={{ fontSize: 11, color: '#6B7280' }}>
                          {tec.tecnico_email}
                          <span style={{ color: roleColor, marginLeft: 8, fontWeight: 700 }}>{roleLabel}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: `${pontosColor}15`, padding: '4px 10px', borderRadius: 8,
                      }}>
                        <Star size={14} color={pontosColor} />
                        <span style={{ fontSize: 16, fontWeight: 800, color: pontosColor }}>{pontos}</span>
                      </div>
                      {atrasosDoTec.length > 0 && (
                        <span style={{
                          background: '#FEE2E2', color: '#DC2626', fontSize: 10, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 10,
                        }}>
                          {atrasosDoTec.length} atraso(s)
                        </span>
                      )}
                      {isExpanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #F3F4F6' }}>
                      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #F3F4F6' }}>
                        {([
                          { id: 'atrasos', label: `Atrasos (${atrasosDoTec.length})`, icon: <Clock size={13} /> },
                          { id: 'ocorrencias', label: `Ocorrências (${ocorrDoTec.length})`, icon: <AlertOctagon size={13} /> },
                          { id: 'execucoes', label: `Execuções (${execsDoTec.length})`, icon: <Wrench size={13} /> },
                        ] as const).map(st => (
                          <button key={st.id} onClick={() => setTecSubTab(st.id)} style={{
                            padding: '10px 16px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 4,
                            background: tecSubTab === st.id ? '#EFF6FF' : 'transparent',
                            color: tecSubTab === st.id ? '#1E3A5F' : '#6B7280',
                            borderBottom: tecSubTab === st.id ? '2px solid #1E3A5F' : '2px solid transparent',
                          }}>
                            {st.icon} {st.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ padding: 16 }}>
                        {tecSubTab === 'atrasos' && (
                          atrasosDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                              Nenhum serviço em atraso
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {atrasosDoTec.map(o => {
                                const diasAtraso = Math.ceil((Date.now() - new Date(o.Previsao_Execucao + 'T23:59:59').getTime()) / (1000 * 60 * 60 * 24))
                                return (
                                  <div key={o.Id_Ordem} style={{
                                    padding: 12, background: '#FEF2F2', borderRadius: 8,
                                    borderLeft: '4px solid #EF4444',
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                      <span style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>{o.Id_Ordem}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>
                                        {diasAtraso} dia(s) de atraso
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{o.Os_Cliente}</div>
                                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                                      {o.Tipo_Servico} • Previsão: {o.Previsao_Execucao ? new Date(o.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        )}

                        {tecSubTab === 'ocorrencias' && (
                          ocorrDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                              Nenhuma ocorrência registrada
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {ocorrDoTec.map(oc => {
                                const tipoInfo = TIPO_OCORRENCIA[oc.tipo] || TIPO_OCORRENCIA.outros
                                const justDoOc = justificativas.find(j => j.id_ocorrencia === oc.id)
                                return (
                                  <div key={oc.id} style={{
                                    padding: 12, background: '#fff', borderRadius: 8,
                                    border: '1px solid #E5E7EB', borderLeft: `4px solid ${tipoInfo.color}`,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{
                                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                          background: `${tipoInfo.color}20`, color: tipoInfo.color,
                                        }}>
                                          {tipoInfo.label}
                                        </span>
                                        {oc.id_ordem && <span style={{ fontSize: 12, color: '#6B7280' }}>OS: {oc.id_ordem}</span>}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>-{oc.pontos_descontados} pts</span>
                                        {justDoOc && (
                                          <span style={{
                                            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                            background: justDoOc.status === 'aprovada' ? '#D1FAE5' : justDoOc.status === 'recusada' ? '#FEE2E2' : '#FEF3C7',
                                            color: justDoOc.status === 'aprovada' ? '#065F46' : justDoOc.status === 'recusada' ? '#DC2626' : '#D97706',
                                          }}>
                                            Just. {justDoOc.status}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#374151' }}>{oc.descricao}</div>
                                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                                      {new Date(oc.data).toLocaleDateString('pt-BR')}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        )}

                        {tecSubTab === 'execucoes' && (
                          execsDoTec.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 20 }}>
                              Nenhuma execução registrada
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {execsDoTec.slice(0, 10).map(ex => (
                                <div key={ex.id} style={{
                                  padding: 10, background: '#fff', borderRadius: 8,
                                  border: '1px solid #E5E7EB',
                                  borderLeft: `4px solid ${ex.status === 'enviado' ? '#10B981' : '#F59E0B'}`,
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{ex.id_ordem}</span>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                      background: ex.status === 'enviado' ? '#D1FAE5' : '#FEF3C7',
                                      color: ex.status === 'enviado' ? '#065F46' : '#92400E',
                                    }}>
                                      {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                                    </span>
                                  </div>
                                  {ex.servico_realizado && (
                                    <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                                      {ex.servico_realizado.length > 120 ? ex.servico_realizado.substring(0, 120) + '...' : ex.servico_realizado}
                                    </div>
                                  )}
                                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                                    {new Date(ex.data_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ MODAL NOVA OCORRÊNCIA ═══ */}
      {showOcorrenciaModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowOcorrenciaModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%',
            maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', margin: 0 }}>
                <AlertOctagon size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                Nova Ocorrência
              </h2>
              <button onClick={() => setShowOcorrenciaModal(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280',
              }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Técnico</label>
                <select
                  value={novaOcorrencia.tecnico_nome}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tecnico_nome: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, background: '#fff' }}
                >
                  <option value="">Selecione...</option>
                  {tecnicos.map(t => (
                    <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>OS (opcional)</label>
                <input
                  type="text" value={novaOcorrencia.id_ordem}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, id_ordem: e.target.value })}
                  placeholder="Ex: OS-001"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Tipo</label>
                <select
                  value={novaOcorrencia.tipo}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tipo: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, background: '#fff' }}
                >
                  {Object.entries(TIPO_OCORRENCIA).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Descrição</label>
                <textarea
                  value={novaOcorrencia.descricao}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, descricao: e.target.value })}
                  placeholder="Descreva a ocorrência..."
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Pontos a descontar</label>
                <input
                  type="number" min={0} max={100}
                  value={novaOcorrencia.pontos_descontados}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, pontos_descontados: Number(e.target.value) })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <button onClick={salvarOcorrencia} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: '#DC2626', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                <AlertOctagon size={16} /> Registrar Ocorrência
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
