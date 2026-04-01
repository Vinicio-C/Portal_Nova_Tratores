'use client'
import { useState, useMemo, useRef } from 'react'
import {
  AlertTriangle, Plus, X, Camera, Download, ChevronDown, ChevronUp,
  MessageSquare, Check, Clock, Calendar, Filter, FileText
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import jsPDF from 'jspdf'

// ─── Types ───────────────────────────────────────────────────────
export interface Alerta {
  id: number
  tecnico_nome: string
  tipo: string // 'ordem_pendente' | 'requisicao_pendente' | 'manual'
  descricao: string
  referencia_id: string | null
  data_inicio: string
  data_fim: string | null
  mes_referencia: string // '2026-03'
  status: string // 'aberto' | 'fechado' | 'contestado'
  contestacao_motivo: string | null
  contestado_por: string | null
  foto_url: string | null
  alvo: string // 'todos' | nome do técnico
  created_at: string
  updated_at: string | null
}

interface Tecnico {
  user_id: string
  tecnico_nome: string
  tecnico_email: string
  mecanico_role: 'tecnico' | 'observador'
}

// ─── Helpers ─────────────────────────────────────────────────────
function getMesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMes(mes: string) {
  const [y, m] = mes.split('-')
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${meses[parseInt(m) - 1]} ${y}`
}

function calcDias(inicio: string, fim: string | null): number {
  const d1 = new Date(inicio + 'T00:00:00')
  const d2 = fim ? new Date(fim + 'T00:00:00') : new Date()
  return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / 86400000))
}

const TIPO_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ordem_pendente: { label: 'Ordem Pendente', color: '#1E40AF', bg: '#DBEAFE' },
  requisicao_pendente: { label: 'Requisição Pendente', color: '#92400E', bg: '#FEF3C7' },
  manual: { label: 'Manual', color: '#7C3AED', bg: '#EDE9FE' },
}

// ─── Component ───────────────────────────────────────────────────
export default function BlocoAlertas({
  tecnicos, alertas, onRecarregar, userName
}: {
  tecnicos: Tecnico[]
  alertas: Alerta[]
  onRecarregar: () => void
  userName: string
}) {
  const [mesAtivo, setMesAtivo] = useState(getMesAtual())
  const [expandido, setExpandido] = useState<string | null>(null)
  const [showNovoModal, setShowNovoModal] = useState(false)
  const [showContestarModal, setShowContestarModal] = useState<number | null>(null)
  const [contestacaoMotivo, setContestacaoMotivo] = useState('')
  const [filtroTecnico, setFiltroTecnico] = useState<string>('todos')

  // Novo alerta manual
  const [novoAlerta, setNovoAlerta] = useState({
    tecnico_nome: '', descricao: '', alvo: 'individual' as 'individual' | 'todos',
  })
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const tecAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')

  // Meses disponíveis (extraídos dos alertas)
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>()
    set.add(getMesAtual())
    alertas.forEach(a => set.add(a.mes_referencia))
    return Array.from(set).sort().reverse()
  }, [alertas])

  // Filtra alertas do mês ativo
  const alertasDoMes = useMemo(() => {
    let filtered = alertas.filter(a => a.mes_referencia === mesAtivo)
    if (filtroTecnico !== 'todos') {
      filtered = filtered.filter(a => a.tecnico_nome === filtroTecnico || a.alvo === 'todos')
    }
    return filtered
  }, [alertas, mesAtivo, filtroTecnico])

  // Agrupa por técnico
  const alertasPorTecnico = useMemo(() => {
    const map: Record<string, Alerta[]> = {}
    tecAtivos.forEach(tec => {
      map[tec.tecnico_nome] = alertasDoMes.filter(a =>
        a.tecnico_nome === tec.tecnico_nome || a.alvo === 'todos'
      )
    })
    return map
  }, [tecAtivos, alertasDoMes])

  // ─── Actions ─────────────────────────────────────────────────
  const criarAlertaManual = async () => {
    if (!novoAlerta.descricao) return
    setUploading(true)

    let foto_url: string | null = null
    if (fotoFile) {
      const ext = fotoFile.name.split('.').pop()
      const path = `alertas/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('anexos').upload(path, fotoFile)
      if (!error) {
        const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(path)
        foto_url = urlData.publicUrl
      }
    }

    const hoje = new Date().toISOString().split('T')[0]
    const mesRef = getMesAtual()

    if (novoAlerta.alvo === 'todos') {
      // Cria um alerta para cada técnico
      const inserts = tecAtivos.map(tec => ({
        tecnico_nome: tec.tecnico_nome,
        tipo: 'manual',
        descricao: novoAlerta.descricao,
        referencia_id: null,
        data_inicio: hoje,
        data_fim: null,
        mes_referencia: mesRef,
        status: 'aberto',
        foto_url,
        alvo: 'todos',
      }))
      await supabase.from('painel_alertas').insert(inserts)
    } else {
      if (!novoAlerta.tecnico_nome) { setUploading(false); return }
      await supabase.from('painel_alertas').insert({
        tecnico_nome: novoAlerta.tecnico_nome,
        tipo: 'manual',
        descricao: novoAlerta.descricao,
        referencia_id: null,
        data_inicio: hoje,
        data_fim: null,
        mes_referencia: mesRef,
        status: 'aberto',
        foto_url,
        alvo: 'individual',
      })
    }

    setNovoAlerta({ tecnico_nome: '', descricao: '', alvo: 'individual' })
    setFotoFile(null)
    setShowNovoModal(false)
    setUploading(false)
    onRecarregar()
  }

  const contestarAlerta = async (alertaId: number) => {
    if (!contestacaoMotivo.trim()) return
    await supabase.from('painel_alertas').update({
      status: 'contestado',
      contestacao_motivo: contestacaoMotivo,
      contestado_por: userName,
      updated_at: new Date().toISOString(),
    }).eq('id', alertaId)
    setContestacaoMotivo('')
    setShowContestarModal(null)
    onRecarregar()
  }

  const fecharAlerta = async (alertaId: number) => {
    const hoje = new Date().toISOString().split('T')[0]
    await supabase.from('painel_alertas').update({
      status: 'fechado',
      data_fim: hoje,
      updated_at: new Date().toISOString(),
    }).eq('id', alertaId)
    onRecarregar()
  }

  const finalizarMes = async () => {
    if (!confirm(`Finalizar o mês ${formatMes(mesAtivo)}? Alertas abertos serão transferidos para o próximo mês.`)) return

    // Busca alertas abertos do mês
    const abertos = alertasDoMes.filter(a => a.status === 'aberto')
    if (abertos.length === 0) return

    // Calcula próximo mês
    const [y, m] = mesAtivo.split('-').map(Number)
    const proxMes = m === 12
      ? `${y + 1}-01`
      : `${y}-${String(m + 1).padStart(2, '0')}`

    // Cria cópias no próximo mês (mantém data_inicio original, cascata)
    const inserts = abertos.map(a => ({
      tecnico_nome: a.tecnico_nome,
      tipo: a.tipo,
      descricao: a.descricao,
      referencia_id: a.referencia_id,
      data_inicio: a.data_inicio, // mantém a data original
      data_fim: null,
      mes_referencia: proxMes,
      status: 'aberto',
      contestacao_motivo: null,
      contestado_por: null,
      foto_url: a.foto_url,
      alvo: a.alvo,
    }))

    // Fecha os originais no mês atual com data_fim = último dia do mês
    const ultimoDia = new Date(y, m, 0).toISOString().split('T')[0]
    const ids = abertos.map(a => a.id)

    await Promise.all([
      supabase.from('painel_alertas').insert(inserts),
      supabase.from('painel_alertas').update({
        status: 'fechado',
        data_fim: ultimoDia,
        updated_at: new Date().toISOString(),
      }).in('id', ids),
    ])

    onRecarregar()
  }

  // ─── PDF ─────────────────────────────────────────────────────
  const gerarPDF = (tecnicoNome?: string) => {
    const doc = new jsPDF()
    const alertasParaPDF = tecnicoNome
      ? alertasDoMes.filter(a => a.tecnico_nome === tecnicoNome)
      : alertasDoMes

    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(`Relatório de Alertas - ${formatMes(mesAtivo)}`, 14, 20)

    if (tecnicoNome) {
      doc.setFontSize(14)
      doc.text(`Técnico: ${tecnicoNome}`, 14, 30)
    }

    doc.setFontSize(10)
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, tecnicoNome ? 38 : 30)

    let y = tecnicoNome ? 48 : 40

    // Agrupa por técnico se não filtrado
    const tecnicosNoRelatorio = tecnicoNome
      ? [tecnicoNome]
      : [...new Set(alertasParaPDF.map(a => a.tecnico_nome))].sort()

    tecnicosNoRelatorio.forEach(nome => {
      if (y > 260) { doc.addPage(); y = 20 }

      const alertasTec = alertasParaPDF.filter(a => a.tecnico_nome === nome)
      if (alertasTec.length === 0) return

      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(nome, 14, y)
      y += 8

      // Header da tabela
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.text('Tipo', 14, y)
      doc.text('Descrição', 44, y)
      doc.text('Início', 120, y)
      doc.text('Fim', 145, y)
      doc.text('Dias', 168, y)
      doc.text('Status', 182, y)
      y += 2
      doc.line(14, y, 196, y)
      y += 5

      doc.setFont('helvetica', 'normal')
      alertasTec.forEach(a => {
        if (y > 275) { doc.addPage(); y = 20 }
        const dias = calcDias(a.data_inicio, a.data_fim)
        const tipoInfo = TIPO_LABELS[a.tipo] || TIPO_LABELS.manual
        const descCurta = a.descricao.length > 40 ? a.descricao.substring(0, 40) + '...' : a.descricao

        doc.text(tipoInfo.label, 14, y)
        doc.text(descCurta, 44, y)
        doc.text(new Date(a.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR'), 120, y)
        doc.text(a.data_fim ? new Date(a.data_fim + 'T12:00:00').toLocaleDateString('pt-BR') : 'Em aberto', 145, y)
        doc.text(String(dias), 168, y)
        doc.text(a.status === 'aberto' ? 'Aberto' : a.status === 'fechado' ? 'Fechado' : 'Contestado', 182, y)
        y += 6
      })

      // Resumo
      const totalDias = alertasTec.reduce((acc, a) => acc + calcDias(a.data_inicio, a.data_fim), 0)
      y += 3
      doc.setFont('helvetica', 'bold')
      doc.text(`Total: ${alertasTec.length} alerta(s) | ${totalDias} dia(s) acumulados`, 14, y)
      y += 12
    })

    const nomeArquivo = tecnicoNome
      ? `alertas_${tecnicoNome.replace(/\s/g, '_')}_${mesAtivo}.pdf`
      : `alertas_geral_${mesAtivo}.pdf`
    doc.save(nomeArquivo)
  }

  // ─── Render ──────────────────────────────────────────────────
  const totalAbertos = alertasDoMes.filter(a => a.status === 'aberto').length
  const totalContestados = alertasDoMes.filter(a => a.status === 'contestado').length

  return (
    <div>
      {/* Toolbar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20,
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Seletor de mês */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={16} color="#6B7280" />
            <select
              value={mesAtivo}
              onChange={e => setMesAtivo(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                fontSize: 13, fontWeight: 600, background: '#fff',
              }}
            >
              {mesesDisponiveis.map(m => (
                <option key={m} value={m}>{formatMes(m)}</option>
              ))}
            </select>
          </div>

          {/* Filtro por técnico */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={16} color="#6B7280" />
            <select
              value={filtroTecnico}
              onChange={e => setFiltroTecnico(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
                fontSize: 13, fontWeight: 600, background: '#fff',
              }}
            >
              <option value="todos">Todos os técnicos</option>
              {tecAtivos.map(t => (
                <option key={t.user_id} value={t.tecnico_nome}>
                  {t.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 12, marginLeft: 8 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
              background: totalAbertos > 0 ? '#FEE2E2' : '#D1FAE5',
              color: totalAbertos > 0 ? '#DC2626' : '#065F46',
            }}>
              {totalAbertos} aberto(s)
            </span>
            {totalContestados > 0 && (
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
                background: '#FEF3C7', color: '#92400E',
              }}>
                {totalContestados} contestado(s)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => gerarPDF()} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#EFF6FF', color: '#1E3A5F', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <Download size={14} /> PDF Geral
          </button>
          <button onClick={finalizarMes} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <Check size={14} /> Finalizar Mês
          </button>
          <button onClick={() => setShowNovoModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <Plus size={14} /> Novo Alerta
          </button>
        </div>
      </div>

      {/* Grid por técnico */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
        {tecAtivos.map(tec => {
          const alertasTec = alertasPorTecnico[tec.tecnico_nome] || []
          const abertos = alertasTec.filter(a => a.status === 'aberto')
          const isExpanded = expandido === tec.tecnico_nome
          const totalDias = abertos.reduce((acc, a) => acc + calcDias(a.data_inicio, a.data_fim), 0)

          return (
            <div key={tec.user_id} style={{
              background: '#fff', borderRadius: 14,
              boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
              borderLeft: `5px solid ${abertos.length === 0 ? '#10B981' : abertos.length >= 3 ? '#EF4444' : '#F59E0B'}`,
              overflow: 'hidden',
            }}>
              {/* Header */}
              <div
                onClick={() => setExpandido(isExpanded ? null : tec.tecnico_nome)}
                style={{
                  padding: '16px 18px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: abertos.length === 0 ? '#F0FDF4' : abertos.length >= 3 ? '#FEF2F2' : '#FFFBEB',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%',
                    background: abertos.length === 0 ? '#10B981' : abertos.length >= 3 ? '#EF4444' : '#F59E0B',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 800,
                  }}>
                    {tec.tecnico_nome.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#1E3A5F' }}>
                      {tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600 }}>
                      {abertos.length === 0
                        ? 'Sem pendências'
                        : `${abertos.length} pendência(s) | ${totalDias}d acumulados`
                      }
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={e => { e.stopPropagation(); gerarPDF(tec.tecnico_nome) }}
                    title="PDF deste técnico"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    }}
                  >
                    <FileText size={18} color="#6B7280" />
                  </button>
                  <span style={{
                    fontSize: 26, fontWeight: 900,
                    color: abertos.length === 0 ? '#10B981' : abertos.length >= 3 ? '#EF4444' : '#D97706',
                  }}>
                    {abertos.length}
                  </span>
                  {isExpanded ? <ChevronUp size={18} color="#6B7280" /> : <ChevronDown size={18} color="#6B7280" />}
                </div>
              </div>

              {/* Lista expandida */}
              {isExpanded && alertasTec.length > 0 && (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {alertasTec.map(a => {
                    const dias = calcDias(a.data_inicio, a.data_fim)
                    const tipoInfo = TIPO_LABELS[a.tipo] || TIPO_LABELS.manual
                    const isFechado = a.status === 'fechado'
                    const isContestado = a.status === 'contestado'

                    return (
                      <div key={a.id} style={{
                        background: isFechado ? '#F9FAFB' : isContestado ? '#FFFBEB' : '#FEF2F2',
                        borderRadius: 10, padding: '12px 14px',
                        borderLeft: `3px solid ${isFechado ? '#D1D5DB' : isContestado ? '#F59E0B' : '#EF4444'}`,
                        opacity: isFechado ? 0.7 : 1,
                      }}>
                        {/* Header do alerta */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                              background: tipoInfo.bg, color: tipoInfo.color,
                            }}>
                              {tipoInfo.label}
                            </span>
                            {isContestado && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                background: '#FEF3C7', color: '#92400E',
                              }}>
                                Contestado
                              </span>
                            )}
                            {isFechado && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                background: '#D1FAE5', color: '#065F46',
                              }}>
                                Fechado
                              </span>
                            )}
                          </div>
                          <span style={{
                            fontSize: 20, fontWeight: 900,
                            color: isFechado ? '#9CA3AF' : dias >= 7 ? '#DC2626' : dias >= 3 ? '#D97706' : '#374151',
                          }}>
                            {dias}d
                          </span>
                        </div>

                        {/* Descrição */}
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                          {a.descricao}
                        </div>
                        {a.referencia_id && (
                          <div style={{ fontSize: 12, color: '#6B7280' }}>
                            Ref: {a.referencia_id}
                          </div>
                        )}

                        {/* Foto */}
                        {a.foto_url && (
                          <div style={{ marginTop: 6 }}>
                            <img
                              src={a.foto_url} alt="Anexo"
                              style={{ maxWidth: 200, maxHeight: 120, borderRadius: 8, objectFit: 'cover', cursor: 'pointer' }}
                              onClick={() => window.open(a.foto_url!, '_blank')}
                            />
                          </div>
                        )}

                        {/* Datas */}
                        <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: '#9CA3AF' }}>
                          <span><Clock size={11} style={{ verticalAlign: 'middle' }} /> Início: {new Date(a.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                          <span>Fim: {a.data_fim ? new Date(a.data_fim + 'T12:00:00').toLocaleDateString('pt-BR') : 'Em aberto'}</span>
                        </div>

                        {/* Contestação existente */}
                        {isContestado && a.contestacao_motivo && (
                          <div style={{
                            marginTop: 8, padding: '8px 10px', background: '#FEF3C7',
                            borderRadius: 8, fontSize: 12, color: '#92400E',
                          }}>
                            <strong>Contestação:</strong> {a.contestacao_motivo}
                            {a.contestado_por && <span style={{ fontSize: 10, color: '#B45309' }}> — por {a.contestado_por}</span>}
                          </div>
                        )}

                        {/* Ações */}
                        {!isFechado && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            {!isContestado && (
                              <button
                                onClick={() => setShowContestarModal(a.id)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  background: '#FEF3C7', color: '#92400E', border: 'none', borderRadius: 6,
                                  padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                }}
                              >
                                <MessageSquare size={12} /> Contestar
                              </button>
                            )}
                            <button
                              onClick={() => fecharAlerta(a.id)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 6,
                                padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              <Check size={12} /> Fechar
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {isExpanded && alertasTec.length === 0 && (
                <div style={{ padding: '16px', fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
                  Nenhum alerta neste mês
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ═══ Modal Novo Alerta Manual ═══ */}
      {showNovoModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480,
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
                Novo Alerta Manual
              </h3>
              <button onClick={() => setShowNovoModal(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
              }}>
                <X size={20} color="#6B7280" />
              </button>
            </div>

            {/* Alvo */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                Destino
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setNovoAlerta(p => ({ ...p, alvo: 'individual' }))}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    border: `2px solid ${novoAlerta.alvo === 'individual' ? '#7C3AED' : '#D1D5DB'}`,
                    background: novoAlerta.alvo === 'individual' ? '#EDE9FE' : '#fff',
                    color: novoAlerta.alvo === 'individual' ? '#7C3AED' : '#6B7280',
                    cursor: 'pointer',
                  }}
                >
                  Técnico específico
                </button>
                <button
                  onClick={() => setNovoAlerta(p => ({ ...p, alvo: 'todos' }))}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    border: `2px solid ${novoAlerta.alvo === 'todos' ? '#7C3AED' : '#D1D5DB'}`,
                    background: novoAlerta.alvo === 'todos' ? '#EDE9FE' : '#fff',
                    color: novoAlerta.alvo === 'todos' ? '#7C3AED' : '#6B7280',
                    cursor: 'pointer',
                  }}
                >
                  Todos os técnicos
                </button>
              </div>
            </div>

            {/* Técnico (se individual) */}
            {novoAlerta.alvo === 'individual' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                  Técnico
                </label>
                <select
                  value={novoAlerta.tecnico_nome}
                  onChange={e => setNovoAlerta(p => ({ ...p, tecnico_nome: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: '1px solid #D1D5DB', fontSize: 13,
                  }}
                >
                  <option value="">Selecione...</option>
                  {tecAtivos.map(t => (
                    <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Descrição */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                Descrição
              </label>
              <textarea
                value={novoAlerta.descricao}
                onChange={e => setNovoAlerta(p => ({ ...p, descricao: e.target.value }))}
                placeholder="Descreva o alerta..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #D1D5DB', fontSize: 13, resize: 'vertical',
                }}
              />
            </div>

            {/* Foto */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                Foto (opcional)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={e => setFotoFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#F3F4F6', color: '#374151', border: '1px dashed #D1D5DB',
                  borderRadius: 8, padding: '10px 14px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', width: '100%', justifyContent: 'center',
                }}
              >
                <Camera size={16} />
                {fotoFile ? fotoFile.name : 'Anexar foto'}
              </button>
            </div>

            {/* Botões */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowNovoModal(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: '#F3F4F6', color: '#374151', border: 'none', cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={criarAlertaManual}
                disabled={uploading}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: '#7C3AED', color: '#fff', border: 'none', cursor: 'pointer',
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                {uploading ? 'Salvando...' : 'Criar Alerta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal Contestar ═══ */}
      {showContestarModal !== null && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420,
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F', margin: '0 0 16px' }}>
              Contestar Alerta
            </h3>
            <textarea
              value={contestacaoMotivo}
              onChange={e => setContestacaoMotivo(e.target.value)}
              placeholder="Motivo da contestação..."
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid #D1D5DB', fontSize: 13, resize: 'vertical',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setShowContestarModal(null); setContestacaoMotivo('') }}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: '#F3F4F6', color: '#374151', border: 'none', cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => contestarAlerta(showContestarModal)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: '#F59E0B', color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                Contestar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
