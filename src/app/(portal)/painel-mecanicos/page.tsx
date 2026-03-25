'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Users, Calendar, Wrench, Package, AlertTriangle, Check,
  Clock, ChevronDown, ChevronUp, Eye, RefreshCw, UserPlus, UserX
} from 'lucide-react'

interface Tecnico {
  id: string
  tecnico_nome: string
  tecnico_email: string
  telefone: string | null
  ativo: boolean
}

interface AgendaItem {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  data_agendada: string
  status: string
  cliente: string | null
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

interface Requisicao {
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

const STAT_CARD = {
  background: '#fff', borderRadius: 14, padding: 20,
  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
}

export default function PainelMecanicosPage() {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [agendaHoje, setAgendaHoje] = useState<AgendaItem[]>([])
  const [execucoesRecentes, setExecucoesRecentes] = useState<Execucao[]>([])
  const [requisicoes, setRequisicoes] = useState<Requisicao[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'visao-geral' | 'tecnicos' | 'requisicoes' | 'execucoes'>('visao-geral')
  const [expandedTec, setExpandedTec] = useState<string | null>(null)

  const carregar = async () => {
    setLoading(true)
    const hoje = new Date().toISOString().split('T')[0]

    const [{ data: tecs }, { data: agenda }, { data: execs }, { data: reqs }] = await Promise.all([
      supabase.from('mecanico_usuarios').select('*').order('tecnico_nome'),
      supabase.from('agenda_tecnico').select('*').eq('data_agendada', hoje).order('hora_inicio'),
      supabase.from('os_tecnico_execucao').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('mecanico_requisicoes').select('*').order('created_at', { ascending: false }).limit(100),
    ])

    setTecnicos((tecs as Tecnico[]) || [])
    setAgendaHoje((agenda as AgendaItem[]) || [])
    setExecucoesRecentes((execs as Execucao[]) || [])
    setRequisicoes((reqs as Requisicao[]) || [])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  // Subscribe to realtime changes
  useEffect(() => {
    const ch1 = supabase.channel('painel_exec')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'os_tecnico_execucao' }, () => carregar())
      .subscribe()
    const ch2 = supabase.channel('painel_req')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_requisicoes' }, () => carregar())
      .subscribe()

    return () => {
      supabase.removeChannel(ch1)
      supabase.removeChannel(ch2)
    }
  }, [])

  const tecnicosAtivos = tecnicos.filter((t) => t.ativo)
  const reqPendentes = requisicoes.filter((r) => r.status === 'pendente')
  const reqAprovadas = requisicoes.filter((r) => r.status === 'aprovada' && !r.atualizada_pelo_tecnico)
  const execsEnviadas = execucoesRecentes.filter((e) => e.status === 'enviado')

  const toggleTecnicoAtivo = async (tec: Tecnico) => {
    const novoStatus = !tec.ativo
    await supabase.from('mecanico_usuarios').update({ ativo: novoStatus }).eq('id', tec.id)
    setTecnicos((prev) => prev.map((t) => t.id === tec.id ? { ...t, ativo: novoStatus } : t))
  }

  const aprovarRequisicao = async (reqId: number) => {
    await supabase.from('mecanico_requisicoes').update({
      status: 'aprovada',
      data_aprovacao: new Date().toISOString(),
    }).eq('id', reqId)
    // Notify technician
    const req = requisicoes.find((r) => r.id === reqId)
    if (req) {
      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome,
        tipo: 'requisicao',
        titulo: 'Requisição aprovada',
        descricao: `Sua requisição "${req.material_solicitado}" foi aprovada. Atualize quando receber o material.`,
        link: `/requisicoes/${req.id}`,
        lida: false,
      })
    }
    carregar()
  }

  const recusarRequisicao = async (reqId: number) => {
    if (!confirm('Recusar esta requisição?')) return
    await supabase.from('mecanico_requisicoes').update({ status: 'recusada' }).eq('id', reqId)
    carregar()
  }

  const TABS = [
    { id: 'visao-geral', label: 'Visão Geral' },
    { id: 'tecnicos', label: 'Técnicos' },
    { id: 'requisicoes', label: `Requisições${reqPendentes.length ? ` (${reqPendentes.length})` : ''}` },
    { id: 'execucoes', label: 'Execuções' },
  ] as const

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Carregando painel...</div>

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
          <Users size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Painel Mecânicos
        </h1>
        <button onClick={carregar} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#EFF6FF', color: '#1E3A5F', border: 'none', borderRadius: 8,
          padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: tab === t.id ? '#1E3A5F' : '#F3F4F6',
              color: tab === t.id ? '#fff' : '#6B7280',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Visão Geral */}
      {tab === 'visao-geral' && (
        <div>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={STAT_CARD}>
              <Users size={20} color="#1E3A5F" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{tecnicosAtivos.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Técnicos ativos</div>
            </div>
            <div style={STAT_CARD}>
              <Calendar size={20} color="#3B82F6" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{agendaHoje.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Agendamentos hoje</div>
            </div>
            <div style={STAT_CARD}>
              <Wrench size={20} color="#10B981" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{execsEnviadas.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Execuções enviadas</div>
            </div>
            <div style={{ ...STAT_CARD, border: reqPendentes.length > 0 ? '2px solid #F59E0B' : undefined }}>
              <Package size={20} color="#F59E0B" />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1F2937', marginTop: 8 }}>{reqPendentes.length}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Requisições pendentes</div>
            </div>
          </div>

          {/* Alerts */}
          {reqAprovadas.length > 0 && (
            <div style={{
              background: '#FEF3C7', borderRadius: 12, padding: 16, marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #F59E0B',
            }}>
              <AlertTriangle size={22} color="#D97706" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>
                  {reqAprovadas.length} requisição(ões) aprovada(s) sem confirmação do técnico
                </div>
                <div style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>
                  {reqAprovadas.map((r) => r.tecnico_nome).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                </div>
              </div>
            </div>
          )}

          {/* Agenda hoje */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12 }}>
            <Clock size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Agenda de Hoje
          </h2>
          {agendaHoje.length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 32 }}>
              Nenhum agendamento para hoje
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
              {agendaHoje.map((item) => (
                <div key={item.id} style={{
                  ...STAT_CARD, padding: 14,
                  borderLeft: `4px solid ${item.status === 'concluido' ? '#10B981' : item.status === 'em_andamento' ? '#F59E0B' : '#3B82F6'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{item.id_ordem || 'Serviço'}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'capitalize' }}>{item.status.replace('_', ' ')}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{item.tecnico_nome}</div>
                  {item.cliente && <div style={{ fontSize: 11, color: '#6B7280' }}>{item.cliente}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Técnicos */}
      {tab === 'tecnicos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tecnicos.map((tec) => {
            const isExpanded = expandedTec === tec.id
            const tecAgendaHoje = agendaHoje.filter((a) => a.tecnico_nome === tec.tecnico_nome)
            const tecExecs = execucoesRecentes.filter((e) => e.tecnico_nome === tec.tecnico_nome)
            const tecReqs = requisicoes.filter((r) => r.tecnico_nome === tec.tecnico_nome)
            const reqsPendUpdate = tecReqs.filter((r) => r.status === 'aprovada' && !r.atualizada_pelo_tecnico)

            return (
              <div key={tec.id} style={{ ...STAT_CARD, padding: 0, overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px', cursor: 'pointer',
                  }}
                  onClick={() => setExpandedTec(isExpanded ? null : tec.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: tec.ativo ? '#1E3A5F' : '#D1D5DB',
                      color: '#fff', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 14, fontWeight: 700,
                    }}>
                      {tec.tecnico_nome.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937' }}>{tec.tecnico_nome}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>
                        {tec.tecnico_email}
                        {!tec.ativo && <span style={{ color: '#EF4444', marginLeft: 8 }}>INATIVO</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {reqsPendUpdate.length > 0 && (
                      <span style={{
                        background: '#FEF3C7', color: '#D97706', fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10,
                      }}>
                        {reqsPendUpdate.length} pend.
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {tecAgendaHoje.length} hoje
                    </span>
                    {isExpanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid #F3F4F6' }}>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1, background: '#EFF6FF', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F' }}>{tecAgendaHoje.length}</div>
                        <div style={{ fontSize: 10, color: '#6B7280' }}>Hoje</div>
                      </div>
                      <div style={{ flex: 1, background: '#D1FAE5', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#065F46' }}>{tecExecs.length}</div>
                        <div style={{ fontSize: 10, color: '#6B7280' }}>Execuções</div>
                      </div>
                      <div style={{ flex: 1, background: '#FEF3C7', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#92400E' }}>{tecReqs.length}</div>
                        <div style={{ fontSize: 10, color: '#6B7280' }}>Requisições</div>
                      </div>
                    </div>

                    {/* Recent executions */}
                    {tecExecs.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Últimas execuções:</div>
                        {tecExecs.slice(0, 3).map((ex) => (
                          <div key={ex.id} style={{
                            fontSize: 12, padding: '6px 0', borderBottom: '1px solid #F3F4F6',
                            display: 'flex', justifyContent: 'space-between',
                          }}>
                            <span style={{ fontWeight: 600 }}>{ex.id_ordem}</span>
                            <span>
                              <span style={{ color: ex.status === 'enviado' ? '#10B981' : '#F59E0B', fontWeight: 600 }}>
                                {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                              </span>
                              {' '}{new Date(ex.created_at).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => toggleTecnicoAtivo(tec)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        border: '1px solid #E5E7EB', cursor: 'pointer',
                        background: tec.ativo ? '#FEE2E2' : '#D1FAE5',
                        color: tec.ativo ? '#DC2626' : '#065F46',
                      }}
                    >
                      {tec.ativo ? <><UserX size={14} /> Desativar</> : <><UserPlus size={14} /> Ativar</>}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Requisições */}
      {tab === 'requisicoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requisicoes.length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 40 }}>
              Nenhuma requisição registrada
            </div>
          ) : (
            requisicoes.map((req) => {
              const isPendente = req.status === 'pendente'
              const statusColors: Record<string, { bg: string; color: string }> = {
                pendente: { bg: '#FEF3C7', color: '#D97706' },
                aprovada: { bg: '#EFF6FF', color: '#2563EB' },
                recusada: { bg: '#FEE2E2', color: '#DC2626' },
                atualizada: { bg: '#D1FAE5', color: '#065F46' },
              }
              const sc = statusColors[req.status] || statusColors.pendente
              return (
                <div key={req.id} style={{
                  ...STAT_CARD, padding: 14,
                  borderLeft: `4px solid ${sc.color}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{req.tecnico_nome}</span>
                      {req.id_ordem && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>OS: {req.id_ordem}</span>}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                      background: sc.bg, color: sc.color, textTransform: 'capitalize',
                    }}>
                      {req.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{req.material_solicitado}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {req.quantidade && `Qtd: ${req.quantidade} • `}
                      {req.urgencia === 'urgente' ? '🔴 Urgente' : 'Normal'}
                      {' • '}{new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    {isPendente && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => aprovarRequisicao(req.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            background: '#10B981', color: '#fff', border: 'none',
                            borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Check size={12} /> Aprovar
                        </button>
                        <button
                          onClick={() => recusarRequisicao(req.id)}
                          style={{
                            background: '#FEE2E2', color: '#DC2626', border: 'none',
                            borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Recusar
                        </button>
                      </div>
                    )}
                  </div>
                  {req.status === 'aprovada' && !req.atualizada_pelo_tecnico && (
                    <div style={{ fontSize: 11, color: '#D97706', marginTop: 6, fontWeight: 600 }}>
                      <AlertTriangle size={12} style={{ verticalAlign: 'middle' }} /> Técnico ainda não confirmou recebimento
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Execuções */}
      {tab === 'execucoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {execucoesRecentes.length === 0 ? (
            <div style={{ ...STAT_CARD, textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 40 }}>
              Nenhuma execução registrada
            </div>
          ) : (
            execucoesRecentes.map((ex) => (
              <div key={ex.id} style={{
                ...STAT_CARD, padding: 14,
                borderLeft: `4px solid ${ex.status === 'enviado' ? '#10B981' : '#F59E0B'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{ex.id_ordem}</span>
                    <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 8 }}>{ex.tecnico_nome}</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: ex.status === 'enviado' ? '#D1FAE5' : '#FEF3C7',
                    color: ex.status === 'enviado' ? '#065F46' : '#92400E',
                  }}>
                    {ex.status === 'enviado' ? 'Enviado' : 'Rascunho'}
                  </span>
                </div>
                {ex.servico_realizado && (
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                    {ex.servico_realizado.length > 150
                      ? ex.servico_realizado.substring(0, 150) + '...'
                      : ex.servico_realizado}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                  Execução: {new Date(ex.data_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                  {' • '}Enviado: {new Date(ex.created_at).toLocaleDateString('pt-BR')}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
