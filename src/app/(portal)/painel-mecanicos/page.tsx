'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissoes } from '@/hooks/usePermissoes'
import SemPermissao from '@/components/SemPermissao'
import { supabase } from '@/lib/supabase'
import BlocoVisaoGeral from '@/components/painel-mecanicos/BlocoVisaoGeral'
import BlocoAgenda from '@/components/painel-mecanicos/BlocoAgenda'
import BlocoAlertas, { type Alerta } from '@/components/painel-mecanicos/BlocoAlertas'
import BlocoTecnicos from '@/components/painel-mecanicos/BlocoTecnicos'
import {
  Users, AlertTriangle, RefreshCw,
  AlertOctagon, X, LayoutDashboard, Calendar
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
  Previsao_Faturamento: string | null
  Serv_Solicitado: string
  Endereco_Cliente: string
  Cidade_Cliente: string
  Tipo_Servico: string
  Qtd_HR: string | number | null
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
  tecnico_nome: string
  id_ordem: string
  servico_realizado: string
  data_execucao: string
  status: string
}

interface RequisicaoMecanico {
  id: number
  tecnico_nome: string
  material_solicitado: string
  quantidade: string
  urgencia: string
  id_ordem: string | null
  status: string
  created_at: string
}

interface Ocorrencia {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  tipo: string
  descricao: string
  pontos_descontados: number
  data: string
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
  atraso: { label: 'Atraso', color: '#D97706' },
  erro: { label: 'Erro', color: '#DC2626' },
  retrabalho: { label: 'Retrabalho', color: '#B91C1C' },
  falta_material: { label: 'Falta Material', color: '#7C3AED' },
  outros: { label: 'Outros', color: '#71717A' },
}

type Bloco = 'visao' | 'ordens' | 'alertas' | 'tecnicos'

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
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [caminhos, setCaminhos] = useState<Caminho[]>([])
  const [execucoesRecentes, setExecucoesRecentes] = useState<Execucao[]>([])
  const [reqsMecanico, setReqsMecanico] = useState<RequisicaoMecanico[]>([])
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [justificativas, setJustificativas] = useState<Justificativa[]>([])
  const [loading, setLoading] = useState(true)
  const [blocoAtivo, setBlocoAtivo] = useState<Bloco>('visao')

  // Modal nova ocorrência
  const [showOcorrenciaModal, setShowOcorrenciaModal] = useState(false)
  const [novaOcorrencia, setNovaOcorrencia] = useState({ tecnico_nome: '', id_ordem: '', tipo: 'atraso', descricao: '', pontos_descontados: 0 })

  const carregar = useCallback(async () => {
    setLoading(true)

    const [
      { data: tecs },
      { data: usus },
      { data: ords },
      { data: alerts },
      { data: cams },
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
      supabase.from('painel_alertas').select('*')
        .order('created_at', { ascending: false }),
      supabase.from('tecnico_caminhos').select('*')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('os_tecnico_execucao').select('*')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('mecanico_requisicoes').select('*')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('tecnico_ocorrencias').select('*')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('tecnico_justificativas').select('*')
        .order('created_at', { ascending: false }).limit(200),
    ])

    const emailMap: Record<string, string> = {}
    ;((usus || []) as any[]).forEach(u => {
      emailMap[u.id] = u.email || ''
    })

    setTecnicos(
      ((tecs || []) as any[]).map(t => ({
        user_id: t.user_id,
        tecnico_nome: t.mecanico_tecnico_nome,
        tecnico_email: emailMap[t.user_id] || '',
        mecanico_role: t.mecanico_role,
      })).sort((a: Tecnico, b: Tecnico) => a.tecnico_nome.localeCompare(b.tecnico_nome))
    )

    setOrdens((ords as OrdemServico[]) || [])
    setAlertas((alerts as Alerta[]) || [])
    setCaminhos((cams as Caminho[]) || [])
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
      supabase.channel('painel_alertas').on('postgres_changes', { event: '*', schema: 'public', table: 'painel_alertas' }, () => carregar()).subscribe(),
      supabase.channel('painel_exec').on('postgres_changes', { event: '*', schema: 'public', table: 'os_tecnico_execucao' }, () => carregar()).subscribe(),
      supabase.channel('painel_req_m').on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_requisicoes' }, () => carregar()).subscribe(),
      supabase.channel('painel_just').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_justificativas' }, () => carregar()).subscribe(),
      supabase.channel('painel_cam').on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_caminhos' }, () => carregar()).subscribe(),
      supabase.channel('painel_agenda_visao').on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_visao' }, () => carregar()).subscribe(),
    ]
    return () => { channels.forEach(c => supabase.removeChannel(c)) }
  }, [carregar])

  // ─── Computed ────────────────────────────────────────────────
  const tecnicosAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')
  const reqPendentes = reqsMecanico.filter(r => r.status === 'pendente')
  const justPendentes = justificativas.filter(j => j.status === 'pendente')

  // Ordens ativas por técnico
  const ordensPorTecnico = useMemo(() => {
    const map: Record<string, OrdemServico[]> = {}
    tecnicos.forEach(tec => {
      map[tec.tecnico_nome] = ordens.filter(o =>
        o.Status !== 'Concluída' && o.Status !== 'Cancelada' &&
        (nomesBatem(tec.tecnico_nome, o.Os_Tecnico) || nomesBatem(tec.tecnico_nome, o.Os_Tecnico2))
      )
    })
    return map
  }, [tecnicos, ordens])

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
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, color: '#A1A1AA', gap: 10 }}>
      <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Carregando...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const TABS: { id: Bloco; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'visao', label: 'Visão Geral', icon: <LayoutDashboard size={15} /> },
    { id: 'ordens', label: 'Agenda', icon: <Calendar size={15} />, count: ordensAtivasCount },
    { id: 'alertas', label: 'Alertas', icon: <AlertTriangle size={15} />, count: alertasAbertosCount },
    { id: 'tecnicos', label: 'Técnicos', icon: <Users size={15} />, count: tecnicosAtivos.length },
  ]

  const INP: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid #E4E4E7', fontSize: 13, boxSizing: 'border-box',
    background: '#FAFAFA', outline: 'none', color: '#18181B',
  }
  const MLBL: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#71717A', display: 'block', marginBottom: 5 }

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* ─── Header ─── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 32,
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#18181B', margin: 0, letterSpacing: '-0.025em' }}>
            Painel Mecânicos
          </h1>
          <p style={{ fontSize: 13, color: '#A1A1AA', margin: '4px 0 0', fontWeight: 400 }}>
            {tecnicosAtivos.length} técnicos · {ordensAtivasCount} ordens ativas · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowOcorrenciaModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#18181B', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            <AlertOctagon size={14} /> Nova Ocorrência
          </button>
          <button onClick={carregar} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', color: '#71717A', border: '1px solid #E4E4E7', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E4E4E7', marginBottom: 28 }}>
        {TABS.map(t => {
          const active = blocoAtivo === t.id
          return (
            <button
              key={t.id}
              onClick={() => setBlocoAtivo(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 20px', border: 'none',
                background: 'transparent', cursor: 'pointer',
                borderBottom: active ? '2px solid #18181B' : '2px solid transparent',
                marginBottom: -1, transition: 'all 0.15s',
              }}
            >
              <span style={{ color: active ? '#18181B' : '#A1A1AA', display: 'flex' }}>{t.icon}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#18181B' : '#71717A' }}>
                {t.label}
              </span>
              {(t.count !== undefined && t.count > 0) && (
                <span style={{
                  fontSize: 11, fontWeight: 500, minWidth: 18, textAlign: 'center',
                  padding: '1px 6px', borderRadius: 10,
                  background: active ? '#18181B' : '#F4F4F5',
                  color: active ? '#fff' : '#71717A',
                }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ═══ VISÃO GERAL ═══ */}
      {blocoAtivo === 'visao' && (
        <BlocoVisaoGeral tecnicos={tecnicos} ordens={ordens} caminhos={caminhos} />
      )}

      {/* ═══ AGENDA ═══ */}
      {blocoAtivo === 'ordens' && (
        <BlocoAgenda tecnicos={tecnicos} ordens={ordens} />
      )}

      {/* ═══ ALERTAS ═══ */}
      {blocoAtivo === 'alertas' && (
        <BlocoAlertas tecnicos={tecnicos} alertas={alertas} onRecarregar={carregar} userName={userProfile?.nome || ''} />
      )}

      {/* ═══ TÉCNICOS ═══ */}
      {blocoAtivo === 'tecnicos' && (
        <BlocoTecnicos
          tecnicos={tecnicos}
          ordens={ordens}
          execucoes={execucoesRecentes}
          ocorrencias={ocorrencias}
          justificativas={justificativas}
          reqsMecanico={reqsMecanico}
          pontuacaoTecnico={pontuacaoTecnico}
          ordensAtrasoPorTecnico={ordensAtrasoPorTecnico}
          ordensPorTecnico={ordensPorTecnico}
          onAprovarRequisicao={aprovarRequisicao}
          onRecusarRequisicao={recusarRequisicao}
          onAvaliarJustificativa={avaliarJustificativa}
          tipoOcorrencia={TIPO_OCORRENCIA}
        />
      )}

      {/* ═══ MODAL NOVA OCORRÊNCIA ═══ */}
      {showOcorrenciaModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowOcorrenciaModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, width: '100%',
            maxWidth: 440, border: '1px solid #E4E4E7',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#18181B', margin: 0 }}>Nova Ocorrência</h2>
              <button onClick={() => setShowOcorrenciaModal(false)} style={{
                background: '#F4F4F5', border: 'none', cursor: 'pointer', color: '#A1A1AA',
                width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={MLBL}>Técnico</label>
                <select value={novaOcorrencia.tecnico_nome}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tecnico_nome: e.target.value })}
                  style={{ ...INP, background: '#fff' }}>
                  <option value="">Selecione...</option>
                  {tecnicos.map(t => <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>)}
                </select>
              </div>
              <div>
                <label style={MLBL}>OS (opcional)</label>
                <input type="text" value={novaOcorrencia.id_ordem}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, id_ordem: e.target.value })}
                  placeholder="Ex: OS-001" style={INP} />
              </div>
              <div>
                <label style={MLBL}>Tipo</label>
                <select value={novaOcorrencia.tipo}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, tipo: e.target.value })}
                  style={{ ...INP, background: '#fff' }}>
                  {Object.entries(TIPO_OCORRENCIA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={MLBL}>Descrição</label>
                <textarea value={novaOcorrencia.descricao}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, descricao: e.target.value })}
                  placeholder="Descreva a ocorrência..." rows={3}
                  style={{ ...INP, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={MLBL}>Pontos a descontar</label>
                <input type="number" min={0} max={100} value={novaOcorrencia.pontos_descontados}
                  onChange={e => setNovaOcorrencia({ ...novaOcorrencia, pontos_descontados: Number(e.target.value) })}
                  style={INP} />
              </div>
              <button onClick={salvarOcorrencia} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                background: '#18181B', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                marginTop: 4,
              }}>
                Registrar Ocorrência
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
